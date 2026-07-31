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
    if (!(config.cfg_scale > 0.0F)) {
        errors.emplace_back("cfg scale must be positive");
    }
    if (config.stream_layers && config.max_vram == "0") {
        errors.emplace_back("stream layers requires a non-zero max VRAM budget");
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

}  // namespace cpdif
