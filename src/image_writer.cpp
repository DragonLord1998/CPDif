#include "image_writer.hpp"

#include <filesystem>
#include <stdexcept>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

namespace cpdif {

void write_png(
    const std::string& path,
    int width,
    int height,
    int channels,
    const std::uint8_t* pixels) {
    if (pixels == nullptr || width <= 0 || height <= 0 || channels <= 0) {
        throw std::invalid_argument("cannot write an empty image");
    }

    const std::filesystem::path output(path);
    if (output.has_parent_path()) {
        std::filesystem::create_directories(output.parent_path());
    }
    if (stbi_write_png(path.c_str(), width, height, channels, pixels, width * channels) == 0) {
        throw std::runtime_error("failed to write PNG: " + path);
    }
}

}  // namespace cpdif
