#include "engine.hpp"

#include "image_reader.hpp"
#include "image_writer.hpp"

#include <stable-diffusion.h>

#include <chrono>
#include <iostream>
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

    GenerationMetrics generate(const RuntimeConfig& config) {
        LoadedImage reference_image;
        sd_image_t reference_view{};
        if (config.mode == GenerationMode::image_edit) {
            reference_image = load_rgb_image(config.reference_image_path);
            reference_view.width = static_cast<std::uint32_t>(reference_image.width);
            reference_view.height = static_cast<std::uint32_t>(reference_image.height);
            reference_view.channel = static_cast<std::uint32_t>(reference_image.channels);
            reference_view.data = reference_image.pixels.data();
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

        sd_image_t* images = nullptr;
        int image_count = 0;
        const auto begin = Clock::now();
        const bool generated = generate_image(context_.get(), &params, &images, &image_count);
        const auto generation_ms = elapsed_ms(begin);

        std::unique_ptr<sd_image_t, ImagesDeleter> owner(images, ImagesDeleter{image_count});
        if (!generated || images == nullptr || image_count < 1 || images[0].data == nullptr) {
            throw std::runtime_error("FLUX.2 Klein generation failed");
        }

        const auto write_begin = Clock::now();
        write_png(
            config.output_path,
            static_cast<int>(images[0].width),
            static_cast<int>(images[0].height),
            static_cast<int>(images[0].channel),
            images[0].data);
        const auto image_write_ms = elapsed_ms(write_begin);

        GenerationMetrics metrics;
        metrics.load_ms = load_ms_;
        metrics.generation_ms = generation_ms;
        metrics.image_write_ms = image_write_ms;
        metrics.backend_info = sd_get_system_info();
        return metrics;
    }

private:
    bool verbose_logging_ = false;
    std::unique_ptr<sd_ctx_t, ContextDeleter> context_;
    std::int64_t load_ms_ = 0;
};

KleinEngine::KleinEngine(const RuntimeConfig& config)
    : impl_(std::make_unique<Impl>(config)) {}

KleinEngine::~KleinEngine() = default;
KleinEngine::KleinEngine(KleinEngine&&) noexcept = default;
KleinEngine& KleinEngine::operator=(KleinEngine&&) noexcept = default;

GenerationMetrics KleinEngine::generate(const RuntimeConfig& config) {
    return impl_->generate(config);
}

bool native_backend_available() noexcept {
    return true;
}

}  // namespace cpdif
