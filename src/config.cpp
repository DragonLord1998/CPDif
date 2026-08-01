#include "cpdif/config.hpp"

#include <filesystem>
#include <sstream>

namespace cpdif {
namespace {

void validate_model_file(
    const std::string& label,
    const std::string& path,
    bool require_files,
    std::vector<std::string>& errors) {
    if (path.empty()) {
        errors.push_back(label + " path is required");
        return;
    }
    if (!require_files) {
        return;
    }

    std::error_code error;
    const std::filesystem::path model_path(path);
    if (!std::filesystem::is_regular_file(model_path, error)) {
        errors.push_back(label + " is not a readable file: " + path);
        return;
    }
    const auto size = std::filesystem::file_size(model_path, error);
    if (error || size == 0) {
        errors.push_back(label + " is empty or unreadable: " + path);
    }
}

}  // namespace

std::vector<std::string> validate(const RuntimeConfig& config, bool require_files) {
    std::vector<std::string> errors;
    validate_model_file("transformer", config.transformer_path, require_files, errors);
    validate_model_file("text encoder", config.text_encoder_path, require_files, errors);
    validate_model_file("VAE", config.vae_path, require_files, errors);

    if (config.mode == GenerationMode::image_edit) {
        validate_model_file(
            "reference image", config.reference_image_path, require_files, errors);
    } else if (!config.reference_image_path.empty()) {
        errors.emplace_back("reference image is only valid in edit mode");
    }

    if (config.prompt.empty()) {
        errors.emplace_back("prompt must not be empty");
    }
    if (config.output_path.empty()) {
        errors.emplace_back("output path must not be empty");
    }
    if (config.width < 64 || config.width % 64 != 0) {
        errors.emplace_back("width must be at least 64 and divisible by 64");
    }
    if (config.height < 64 || config.height % 64 != 0) {
        errors.emplace_back("height must be at least 64 and divisible by 64");
    }
    if (config.steps < 1 || config.steps > 1000) {
        errors.emplace_back("steps must be between 1 and 1000");
    }
    if (config.qwen_image_layers < 0 || config.qwen_image_layers > 64) {
        errors.emplace_back("Qwen image layers must be between 0 and 64");
    }
    if (!(config.cfg_scale > 0.0F)) {
        errors.emplace_back("cfg scale must be positive");
    }
    if (config.klein_kv_cache && config.cfg_scale != 1.0F) {
        errors.emplace_back("FLUX.2 klein KV cache requires cfg scale 1.0");
    }
    if (config.klein_kv_cache && config.stream_layers) {
        errors.emplace_back("FLUX.2 klein KV cache is incompatible with layer streaming");
    }
    if (config.klein_kv_cache && config.cache.mode != CacheMode::disabled) {
        errors.emplace_back("FLUX.2 klein KV cache cannot be combined with a diffusion cache");
    }
    if (config.stream_layers && config.max_vram == "0") {
        errors.emplace_back("stream layers requires a non-zero max VRAM budget");
    }
    if (config.cache.reuse_threshold < -1.0F) {
        errors.emplace_back("cache threshold must be non-negative or -1 for the backend default");
    }
    if (config.cache.start_percent < 0.0F || config.cache.start_percent >= 1.0F ||
        config.cache.end_percent <= 0.0F || config.cache.end_percent > 1.0F ||
        config.cache.start_percent >= config.cache.end_percent) {
        errors.emplace_back("cache range must satisfy 0 <= start < end <= 1");
    }
    if (config.cache.fn_compute_blocks < 0 || config.cache.bn_compute_blocks < 0) {
        errors.emplace_back("cache block counts must be non-negative");
    }
    if (config.cache.residual_diff_threshold < 0.0F) {
        errors.emplace_back("cache residual threshold must be non-negative");
    }
    if (config.cache.max_warmup_steps < 0 || config.cache.max_cached_steps < -1 ||
        config.cache.max_continuous_cached_steps < -1) {
        errors.emplace_back("cache step limits must be -1 or non-negative");
    }
    if (config.cache.taylorseer_order < 1 || config.cache.taylorseer_order > 2) {
        errors.emplace_back("TaylorSeer order must be 1 or 2");
    }
    if (config.cache.taylorseer_skip_interval < 1) {
        errors.emplace_back("TaylorSeer skip interval must be positive");
    }
    if (config.cache.spectrum_w < 0.0F || config.cache.spectrum_w > 1.0F ||
        config.cache.spectrum_m < 1 || config.cache.spectrum_lambda < 0.0F ||
        config.cache.spectrum_window_size < 1 ||
        config.cache.spectrum_flex_window < 0.0F ||
        config.cache.spectrum_flex_window > 1.0F ||
        config.cache.spectrum_warmup_steps < 0 ||
        config.cache.spectrum_stop_percent <= 0.0F ||
        config.cache.spectrum_stop_percent > 1.0F) {
        errors.emplace_back("invalid Spectrum cache configuration");
    }
    return errors;
}

const char* rng_name(RngKind rng) noexcept {
    switch (rng) {
        case RngKind::cpu:
            return "cpu";
        case RngKind::cuda:
            return "cuda";
    }
    return "unknown";
}

const char* generation_mode_name(GenerationMode mode) noexcept {
    switch (mode) {
        case GenerationMode::text_to_image:
            return "text-to-image";
        case GenerationMode::image_edit:
            return "image-edit";
    }
    return "unknown";
}

const char* cache_mode_name(CacheMode mode) noexcept {
    switch (mode) {
        case CacheMode::disabled:
            return "disabled";
        case CacheMode::easycache:
            return "easycache";
        case CacheMode::dbcache:
            return "dbcache";
        case CacheMode::taylorseer:
            return "taylorseer";
        case CacheMode::cache_dit:
            return "cache-dit";
        case CacheMode::spectrum:
            return "spectrum";
    }
    return "unknown";
}

}  // namespace cpdif
