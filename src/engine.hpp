#pragma once

#include "cpdif/config.hpp"

#include <cstdint>
#include <memory>
#include <string>

namespace cpdif {

struct GenerationMetrics {
    std::int64_t load_ms = 0;
    std::int64_t generation_ms = 0;
    std::int64_t image_write_ms = 0;
    std::string backend_info;
};

class KleinEngine {
public:
    explicit KleinEngine(const RuntimeConfig& config);
    ~KleinEngine();

    KleinEngine(const KleinEngine&) = delete;
    KleinEngine& operator=(const KleinEngine&) = delete;
    KleinEngine(KleinEngine&&) noexcept;
    KleinEngine& operator=(KleinEngine&&) noexcept;

    GenerationMetrics generate(const RuntimeConfig& config);

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

bool native_backend_available() noexcept;

}  // namespace cpdif
