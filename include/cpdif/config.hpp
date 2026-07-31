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
    RngKind rng = RngKind::cpu;
};

std::vector<std::string> validate(const RuntimeConfig& config, bool require_files = true);
const char* rng_name(RngKind rng) noexcept;
const char* generation_mode_name(GenerationMode mode) noexcept;

}  // namespace cpdif
