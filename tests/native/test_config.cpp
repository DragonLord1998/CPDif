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

    valid.stream_layers = false;
    valid.mode = cpdif::GenerationMode::image_edit;
    if (!contains(cpdif::validate(valid, false), "reference image")) {
        std::cerr << "expected edit mode without a reference image to be rejected\n";
        return 1;
    }

    valid.reference_image_path = "cat.png";
    if (!cpdif::validate(valid, false).empty()) {
        std::cerr << "expected edit configuration to pass structural validation\n";
        return 1;
    }

    valid.mode = cpdif::GenerationMode::text_to_image;
    if (!contains(cpdif::validate(valid, false), "only valid in edit mode")) {
        std::cerr << "expected text-to-image mode with a reference image to be rejected\n";
        return 1;
    }

    valid.reference_image_path.clear();
    valid.qwen_image_layers = 65;
    if (!contains(cpdif::validate(valid, false), "Qwen image layers")) {
        std::cerr << "expected invalid Qwen image layer count to be rejected\n";
        return 1;
    }

    valid.qwen_image_layers = 3;
    valid.cache.mode = cpdif::CacheMode::cache_dit;
    valid.cache.max_warmup_steps = -1;
    if (!contains(cpdif::validate(valid, false), "cache step limits")) {
        std::cerr << "expected invalid cache warmup to be rejected\n";
        return 1;
    }
    valid.cache.max_warmup_steps = 1;
    valid.cache.residual_diff_threshold = 0.24F;
    if (!cpdif::validate(valid, false).empty()) {
        std::cerr << "expected Cache-DiT configuration to pass validation\n";
        return 1;
    }

    valid.cache.mode = cpdif::CacheMode::disabled;
    valid.klein_kv_cache = true;
    valid.cfg_scale = 2.0F;
    if (!contains(cpdif::validate(valid, false), "KV cache requires cfg scale 1.0")) {
        std::cerr << "expected KV cache with CFG to be rejected\n";
        return 1;
    }
    valid.cfg_scale = 1.0F;
    if (!cpdif::validate(valid, false).empty()) {
        std::cerr << "expected FLUX.2 klein KV-cache configuration to pass\n";
        return 1;
    }
    valid.stream_layers = true;
    valid.max_vram = "24";
    if (!contains(cpdif::validate(valid, false), "incompatible with layer streaming")) {
        std::cerr << "expected KV cache with layer streaming to be rejected\n";
        return 1;
    }
    valid.stream_layers = false;
    valid.cache.mode = cpdif::CacheMode::dbcache;
    if (!contains(cpdif::validate(valid, false), "cannot be combined with a diffusion cache")) {
        std::cerr << "expected KV cache with a diffusion cache to be rejected\n";
        return 1;
    }
    valid.cache.mode = cpdif::CacheMode::disabled;

    if (std::string(cpdif::rng_name(cpdif::RngKind::cpu)) != "cpu") {
        std::cerr << "unexpected RNG name\n";
        return 1;
    }
    if (std::string(cpdif::generation_mode_name(cpdif::GenerationMode::image_edit)) !=
        "image-edit") {
        std::cerr << "unexpected generation mode name\n";
        return 1;
    }
    if (std::string(cpdif::cache_mode_name(cpdif::CacheMode::cache_dit)) !=
        "cache-dit") {
        std::cerr << "unexpected cache mode name\n";
        return 1;
    }
    return 0;
}
