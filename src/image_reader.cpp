#include "image_reader.hpp"

#include <limits>
#include <memory>
#include <stdexcept>

#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

namespace cpdif {

LoadedImage load_rgb_image(const std::string& path) {
    constexpr int requested_channels = 3;
    int width = 0;
    int height = 0;
    int source_channels = 0;
    std::unique_ptr<stbi_uc, decltype(&stbi_image_free)> pixels(
        stbi_load(path.c_str(), &width, &height, &source_channels, requested_channels),
        stbi_image_free);
    if (!pixels) {
        const char* reason = stbi_failure_reason();
        throw std::runtime_error(
            "failed to load reference image: " + path +
            (reason == nullptr ? std::string{} : " (" + std::string(reason) + ")"));
    }
    if (width <= 0 || height <= 0) {
        throw std::runtime_error("reference image has invalid dimensions: " + path);
    }

    const auto width_size = static_cast<std::size_t>(width);
    const auto height_size = static_cast<std::size_t>(height);
    const auto max_size = std::numeric_limits<std::size_t>::max();
    if (width_size > max_size / height_size / requested_channels) {
        throw std::runtime_error("reference image is too large: " + path);
    }
    const auto pixel_count = width_size * height_size * requested_channels;

    LoadedImage image;
    image.width = width;
    image.height = height;
    image.channels = requested_channels;
    image.pixels.assign(pixels.get(), pixels.get() + pixel_count);
    return image;
}

}  // namespace cpdif
