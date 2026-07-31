#include "cpdif/config.hpp"

#include <iostream>
#include <string>

namespace {

bool contains(const std::vector<std::string>& values, const std::string& needle) {
    for (const auto& value : values) {
        if (value.find(needle) != std::string::npos) {
            return true;
        }
    }
    return false;
}

}  // namespace

int main() {
    cpdif::RuntimeConfig valid;
    valid.transformer_path = "transformer.safetensors";
    valid.text_encoder_path = "qwen.safetensors";
    valid.vae_path = "vae.safetensors";
    valid.prompt = "a test prompt";

    if (!cpdif::validate(valid, false).empty()) {
        std::cerr << "expected nominal configuration to pass structural validation\n";
        return 1;
    }

    valid.width = 1000;
    if (!contains(cpdif::validate(valid, false), "width")) {
        std::cerr << "expected invalid width to be rejected\n";
        return 1;
    }

    valid.width = 1024;
    valid.stream_layers = true;
    if (!contains(cpdif::validate(valid, false), "max VRAM")) {
        std::cerr << "expected streaming without max VRAM to be rejected\n";
        return 1;
    }

    if (std::string(cpdif::rng_name(cpdif::RngKind::cpu)) != "cpu") {
        std::cerr << "unexpected RNG name\n";
        return 1;
    }
    return 0;
}
