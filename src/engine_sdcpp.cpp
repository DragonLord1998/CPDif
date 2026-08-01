#include "engine.hpp"

#include "image_reader.hpp"
#include "image_writer.hpp"

#include <stable-diffusion.h>

#include <chrono>
#include <cstring>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>

namespace cpdif {
namespace {

using Clock = std::chrono::steady_clock;

std::int64_t elapsed_ms(Clock::time_point begin) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - begin).count();
}

void log_callback(enum sd_log_level_t level, const char* message, void* user_data) {
    const auto* verbose = static_cast<const bool*>(user_data);
    if (level == SD_LOG_DEBUG && (verbose == nullptr || !*verbose)) {
        return;
    }
    const char* label = "INFO";
    if (level == SD_LOG_DEBUG) {
        label = "DEBUG";
    } else if (level == SD_LOG_WARN) {
        label = "WARN";
    } else if (level == SD_LOG_ERROR) {
        label = "ERROR";
    }
    std::cerr << "[sdcpp:" << label << "] " << (message == nullptr ? "" : message);
}

void progress_callback(int step, int steps, float seconds, void*) {
    std::cerr << "[cpdif] denoise " << step << '/' << steps << " (" << seconds << "s)\n";
}

struct ContextDeleter {
    void operator()(sd_ctx_t* context) const noexcept {
        if (context != nullptr) {
            free_sd_ctx(context);
        }
    }
};

struct ImagesDeleter {
    int count = 0;

    void operator()(sd_image_t* images) const noexcept {
        if (images != nullptr) {
            free_sd_images(images, count);
        }
    }
};

sd_cache_mode_t to_sd_cache_mode(CacheMode mode) {
    switch (mode) {
        case CacheMode::disabled:
            return SD_CACHE_DISABLED;
        case CacheMode::easycache:
            return SD_CACHE_EASYCACHE;
        case CacheMode::dbcache:
            return SD_CACHE_DBCACHE;
        case CacheMode::taylorseer:
            return SD_CACHE_TAYLORSEER;
        case CacheMode::cache_dit:
            return SD_CACHE_CACHE_DIT;
        case CacheMode::spectrum:
            return SD_CACHE_SPECTRUM;
    }
    return SD_CACHE_DISABLED;
}

void apply_cache_config(const CacheConfig& source, sd_cache_params_t& target) {
    target.mode = to_sd_cache_mode(source.mode);
    if (source.reuse_threshold >= 0.0F) {
        target.reuse_threshold = source.reuse_threshold;
    }
    target.start_percent = source.start_percent;
    target.end_percent = source.end_percent;
    target.Fn_compute_blocks = source.fn_compute_blocks;
    target.Bn_compute_blocks = source.bn_compute_blocks;
    target.residual_diff_threshold = source.residual_diff_threshold;
    target.max_warmup_steps = source.max_warmup_steps;
    target.max_cached_steps = source.max_cached_steps;
    target.max_continuous_cached_steps = source.max_continuous_cached_steps;
    target.taylorseer_n_derivatives = source.taylorseer_order;
    target.taylorseer_skip_interval = source.taylorseer_skip_interval;
    target.scm_mask = source.scm_mask.empty() ? nullptr : source.scm_mask.c_str();
    target.scm_policy_dynamic = source.scm_policy_dynamic;
    target.spectrum_w = source.spectrum_w;
    target.spectrum_m = source.spectrum_m;
    target.spectrum_lam = source.spectrum_lambda;
    target.spectrum_window_size = source.spectrum_window_size;
    target.spectrum_flex_window = source.spectrum_flex_window;
    target.spectrum_warmup_steps = source.spectrum_warmup_steps;
    target.spectrum_stop_percent = source.spectrum_stop_percent;
}

}  // namespace

class KleinEngine::Impl {
public:
    explicit Impl(const RuntimeConfig& config) {
        verbose_logging_ = config.verbose_logging;
        sd_set_log_callback(log_callback, &verbose_logging_);
        sd_set_progress_callback(progress_callback, nullptr);

        sd_ctx_params_t params;
        sd_ctx_params_init(&params);
        params.diffusion_model_path = config.transformer_path.c_str();
        params.llm_path = config.text_encoder_path.c_str();
        params.vae_path = config.vae_path.c_str();
        if (config.threads > 0) {
            params.n_threads = config.threads;
        }
        params.rng_type = config.rng == RngKind::cuda ? CUDA_RNG : CPU_RNG;
        params.sampler_rng_type = params.rng_type;
        params.diffusion_flash_attn = true;
        params.vae_format = SD_VAE_FORMAT_FLUX2;
        params.model_args = config.klein_kv_cache ? "klein_kv_cache=true" : nullptr;
        params.max_vram = config.max_vram.c_str();
        params.stream_layers = config.stream_layers;
        params.params_backend = config.offload_to_cpu ? "*=cpu" : nullptr;

        const auto begin = Clock::now();
        context_.reset(new_sd_ctx(&params));
        load_ms_ = elapsed_ms(begin);
        if (!context_) {
            throw std::runtime_error("failed to load FLUX.2 Klein model components");
        }
        if (!sd_ctx_supports_image_generation(context_.get())) {
            throw std::runtime_error("loaded model does not support image generation");
        }
    }

    GenerationResult generate(
        const RuntimeConfig& config,
        const LoadedImage* in_memory_reference) {
        LoadedImage reference_image;
        sd_image_t reference_view{};
        if (config.mode == GenerationMode::image_edit) {
            if (in_memory_reference != nullptr) {
                reference_view.width =
                    static_cast<std::uint32_t>(in_memory_reference->width);
                reference_view.height =
                    static_cast<std::uint32_t>(in_memory_reference->height);
                reference_view.channel =
                    static_cast<std::uint32_t>(in_memory_reference->channels);
                reference_view.data = const_cast<std::uint8_t*>(
                    in_memory_reference->pixels.data());
            } else {
                const auto reference_begin = Clock::now();
                reference_image = load_rgb_image(config.reference_image_path);
                reference_load_ms_ = elapsed_ms(reference_begin);
                reference_view.width = static_cast<std::uint32_t>(reference_image.width);
                reference_view.height = static_cast<std::uint32_t>(reference_image.height);
                reference_view.channel =
                    static_cast<std::uint32_t>(reference_image.channels);
                reference_view.data = reference_image.pixels.data();
            }
        }

        sd_img_gen_params_t params;
        sd_img_gen_params_init(&params);
        params.prompt = config.prompt.c_str();
        params.negative_prompt = "";
        params.width = config.width;
        params.height = config.height;
        params.seed = config.seed;
        params.batch_count = 1;
        params.qwen_image_layers = config.mode == GenerationMode::image_edit
                                      ? config.qwen_image_layers
                                      : 0;
        if (config.mode == GenerationMode::image_edit) {
            params.ref_images = &reference_view;
            params.ref_images_count = 1;
        }
        params.sample_params.sample_steps = config.steps;
        params.sample_params.guidance.txt_cfg = config.cfg_scale;
        params.sample_params.sample_method = sd_get_default_sample_method(context_.get());
        params.sample_params.scheduler = sd_get_default_scheduler(
            context_.get(), params.sample_params.sample_method);
        apply_cache_config(config.cache, params.cache);

        sd_image_t* images = nullptr;
        int image_count = 0;
        const auto begin = Clock::now();
        const bool generated = generate_image(context_.get(), &params, &images, &image_count);
        const auto generation_ms = elapsed_ms(begin);

        std::unique_ptr<sd_image_t, ImagesDeleter> owner(images, ImagesDeleter{image_count});
        if (!generated || images == nullptr || image_count < 1 || images[0].data == nullptr) {
            throw std::runtime_error("FLUX.2 Klein generation failed");
        }

        const std::size_t pixel_count =
            static_cast<std::size_t>(images[0].width) *
            static_cast<std::size_t>(images[0].height) *
            static_cast<std::size_t>(images[0].channel);
        LoadedImage generated_image;
        generated_image.width = static_cast<int>(images[0].width);
        generated_image.height = static_cast<int>(images[0].height);
        generated_image.channels = static_cast<int>(images[0].channel);
        generated_image.pixels.resize(pixel_count);
        std::memcpy(
            generated_image.pixels.data(), images[0].data, generated_image.pixels.size());

        const auto write_begin = Clock::now();
        write_png(
            config.output_path,
            static_cast<int>(images[0].width),
            static_cast<int>(images[0].height),
            static_cast<int>(images[0].channel),
            images[0].data);
        const auto image_write_ms = elapsed_ms(write_begin);

        GenerationResult result;
        result.metrics.load_ms = generation_count_ == 0 ? load_ms_ : 0;
        result.metrics.reference_load_ms = reference_load_ms_;
        result.metrics.generation_ms = generation_ms;
        result.metrics.image_write_ms = image_write_ms;
        result.metrics.context_reused = generation_count_ > 0;
        result.metrics.backend_info = sd_get_system_info();
        result.image = std::move(generated_image);
        reference_load_ms_ = 0;
        ++generation_count_;
        return result;
    }

private:
    bool verbose_logging_ = false;
    std::unique_ptr<sd_ctx_t, ContextDeleter> context_;
    std::int64_t load_ms_ = 0;
    std::int64_t reference_load_ms_ = 0;
    std::uint64_t generation_count_ = 0;
};

KleinEngine::KleinEngine(const RuntimeConfig& config)
    : impl_(std::make_unique<Impl>(config)) {}

KleinEngine::~KleinEngine() = default;
KleinEngine::KleinEngine(KleinEngine&&) noexcept = default;
KleinEngine& KleinEngine::operator=(KleinEngine&&) noexcept = default;

GenerationResult KleinEngine::generate(
    const RuntimeConfig& config,
    const LoadedImage* in_memory_reference) {
    return impl_->generate(config, in_memory_reference);
}

bool native_backend_available() noexcept {
    return true;
}

}  // namespace cpdif
