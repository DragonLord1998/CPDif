#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace cpdif {

enum class RngKind {
    cpu,
    cuda,
};

enum class GenerationMode {
    text_to_image,
    image_edit,
};

enum class CacheMode {
    disabled,
    easycache,
    dbcache,
    taylorseer,
    cache_dit,
    spectrum,
};

struct CacheConfig {
    CacheMode mode = CacheMode::disabled;
    float reuse_threshold = -1.0F;
    float start_percent = 0.15F;
    float end_percent = 0.95F;
    int fn_compute_blocks = 1;
    int bn_compute_blocks = 0;
    float residual_diff_threshold = 0.24F;
    int max_warmup_steps = 4;
    int max_cached_steps = -1;
    int max_continuous_cached_steps = 3;
    int taylorseer_order = 1;
    int taylorseer_skip_interval = 1;
    std::string scm_mask;
    bool scm_policy_dynamic = true;
    float spectrum_w = 0.40F;
    int spectrum_m = 3;
    float spectrum_lambda = 1.0F;
    int spectrum_window_size = 2;
    float spectrum_flex_window = 0.50F;
    int spectrum_warmup_steps = 4;
    float spectrum_stop_percent = 0.90F;
};

struct RuntimeConfig {
    GenerationMode mode = GenerationMode::text_to_image;
    std::string transformer_path;
    std::string text_encoder_path;
    std::string vae_path;
    std::string reference_image_path;
    std::string prompt;
    std::string output_path = "output.png";
    std::string telemetry_path;
    std::string max_vram = "0";
    int width = 1024;
    int height = 1024;
    int steps = 4;
    int qwen_image_layers = 3;
    int threads = -1;
    std::int64_t seed = 42;
    float cfg_scale = 1.0F;
    bool offload_to_cpu = true;
    bool stream_layers = false;
    bool verbose_logging = false;
    RngKind rng = RngKind::cpu;
    CacheConfig cache;
};

std::vector<std::string> validate(const RuntimeConfig& config, bool require_files = true);
const char* rng_name(RngKind rng) noexcept;
const char* generation_mode_name(GenerationMode mode) noexcept;
const char* cache_mode_name(CacheMode mode) noexcept;

}  // namespace cpdif
