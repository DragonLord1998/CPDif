#include "engine.hpp"

#include <stdexcept>
#include <utility>

namespace cpdif {

class KleinEngine::Impl {};

KleinEngine::KleinEngine(const RuntimeConfig&) {
    throw std::runtime_error(
        "this cpdif binary was built without the stable-diffusion.cpp backend; "
        "configure with CPDIF_OFFLINE=OFF and CPDIF_ENABLE_CUDA=ON");
}

KleinEngine::~KleinEngine() = default;
KleinEngine::KleinEngine(KleinEngine&&) noexcept = default;
KleinEngine& KleinEngine::operator=(KleinEngine&&) noexcept = default;

GenerationMetrics KleinEngine::generate(const RuntimeConfig&) {
    throw std::runtime_error("native backend is unavailable");
}

bool native_backend_available() noexcept {
    return false;
}

}  // namespace cpdif
