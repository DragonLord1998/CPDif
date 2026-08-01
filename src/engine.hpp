#pragma once

#include "cpdif/config.hpp"
#include "image_reader.hpp"

#include <cstdint>
#include <memory>
#include <string>

namespace cpdif {

struct GenerationMetrics {
    std::int64_t load_ms = 0;
    std::int64_t reference_load_ms = 0;
    std::int64_t generation_ms = 0;
    std::int64_t image_write_ms = 0;
    bool context_reused = false;
    std::string backend_info;
};

struct GenerationResult {
    GenerationMetrics metrics;
    LoadedImage image;
};

class KleinEngine {
public:
    explicit KleinEngine(const RuntimeConfig& config);
    ~KleinEngine();

    KleinEngine(const KleinEngine&) = delete;
    KleinEngine& operator=(const KleinEngine&) = delete;
    KleinEngine(KleinEngine&&) noexcept;
    KleinEngine& operator=(KleinEngine&&) noexcept;

    GenerationResult generate(
        const RuntimeConfig& config,
        const LoadedImage* in_memory_reference = nullptr);

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

bool native_backend_available() noexcept;

}  // namespace cpdif
