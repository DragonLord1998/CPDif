#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace cpdif {

struct LoadedImage {
    int width = 0;
    int height = 0;
    int channels = 0;
    std::vector<std::uint8_t> pixels;
};

LoadedImage load_rgb_image(const std::string& path);

}  // namespace cpdif
