#pragma once

#include <cstdint>
#include <string>

namespace cpdif {

void write_png(
    const std::string& path,
    int width,
    int height,
    int channels,
    const std::uint8_t* pixels);

}  // namespace cpdif
