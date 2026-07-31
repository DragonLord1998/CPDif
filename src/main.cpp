#include "cpdif/config.hpp"
#include "engine.hpp"

#include <charconv>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#ifndef CPDIF_VERSION
#define CPDIF_VERSION "unknown"
#endif

namespace {

class UsageError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

void print_help() {
    std::cout
        << "CPDif " << CPDIF_VERSION << " - native FLUX.2 Klein 9B C++/CUDA runtime\n\n"
        << "Usage:\n"
        << "  cpdif backend\n"
        << "  cpdif validate [generation options]\n"
        << "  cpdif generate [generation options]\n"
        << "  cpdif edit --reference-image PATH [generation options]\n\n"
        << "Required generation options:\n"
        << "  --transformer PATH     FLUX.2-klein-9B transformer (.safetensors or .gguf)\n"
        << "  --text-encoder PATH    Qwen3-8B text encoder\n"
        << "  --vae PATH             FLUX.2 VAE\n"
        << "  --prompt TEXT          Prompt to render\n\n"
        << "Required for edit:\n"
        << "  --reference-image PATH Source image to preserve and edit\n\n"
        << "Optional:\n"
        << "  --output PATH          PNG output (default: output.png)\n"
        << "  --telemetry PATH       JSON timing/backend output\n"
        << "  --width N              Width, divisible by 64 (default: 1024)\n"
        << "  --height N             Height, divisible by 64 (default: 1024)\n"
        << "  --steps N              Denoising steps (default: 4)\n"
        << "  --qwen-image-layers N  Qwen visual conditioning layers (default: 3)\n"
        << "  --cfg-scale F          Guidance scale (default: 1.0)\n"
        << "  --seed N               Seed (default: 42)\n"
        << "  --threads N            CPU worker threads\n"
        << "  --max-vram SPEC        Graph-cut VRAM budget in GiB (default: 0)\n"
        << "  --stream-layers        Stream layer residency; requires --max-vram\n"
        << "  --no-offload-to-cpu    Keep parameters on the compute backend\n"
        << "  --rng cpu|cuda         Noise RNG (default: cpu for reproducibility)\n";
}

std::string json_escape(std::string_view value) {
    std::string result;
    result.reserve(value.size());
    for (const char character : value) {
        switch (character) {
            case '\\':
                result += "\\\\";
                break;
            case '"':
                result += "\\\"";
                break;
            case '\n':
                result += "\\n";
                break;
            case '\r':
                result += "\\r";
                break;
            case '\t':
                result += "\\t";
                break;
            default:
                result += character;
        }
    }
    return result;
}

template <typename Integer>
Integer parse_integer(const std::string& option, std::string_view value) {
    Integer result{};
    const auto parsed = std::from_chars(value.data(), value.data() + value.size(), result);
    if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size()) {
        throw UsageError(option + " expects an integer, got: " + std::string(value));
    }
    return result;
}

float parse_float(const std::string& option, const std::string& value) {
    std::size_t consumed = 0;
    try {
        const float result = std::stof(value, &consumed);
        if (consumed != value.size()) {
            throw UsageError(option + " expects a number, got: " + value);
        }
        return result;
    } catch (const std::invalid_argument&) {
        throw UsageError(option + " expects a number, got: " + value);
    } catch (const std::out_of_range&) {
        throw UsageError(option + " is out of range: " + value);
    }
}

cpdif::RuntimeConfig parse_config(
    int argc,
    char** argv,
    int start_index,
    cpdif::GenerationMode mode) {
    cpdif::RuntimeConfig config;
    config.mode = mode;
    for (int index = start_index; index < argc; ++index) {
        const std::string option = argv[index];
        const auto value = [&]() -> std::string {
            if (index + 1 >= argc) {
                throw UsageError("missing value for " + option);
            }
            return argv[++index];
        };

        if (option == "--transformer") {
            config.transformer_path = value();
        } else if (option == "--text-encoder") {
            config.text_encoder_path = value();
        } else if (option == "--vae") {
            config.vae_path = value();
        } else if (option == "--reference-image") {
            config.reference_image_path = value();
        } else if (option == "--prompt") {
            config.prompt = value();
        } else if (option == "--output") {
            config.output_path = value();
        } else if (option == "--telemetry") {
            config.telemetry_path = value();
        } else if (option == "--max-vram") {
            config.max_vram = value();
        } else if (option == "--width") {
            config.width = parse_integer<int>(option, value());
        } else if (option == "--height") {
            config.height = parse_integer<int>(option, value());
        } else if (option == "--steps") {
            config.steps = parse_integer<int>(option, value());
        } else if (option == "--qwen-image-layers") {
            config.qwen_image_layers = parse_integer<int>(option, value());
        } else if (option == "--threads") {
            config.threads = parse_integer<int>(option, value());
        } else if (option == "--seed") {
            config.seed = parse_integer<std::int64_t>(option, value());
        } else if (option == "--cfg-scale") {
            config.cfg_scale = parse_float(option, value());
        } else if (option == "--rng") {
            const std::string kind = value();
            if (kind == "cpu") {
                config.rng = cpdif::RngKind::cpu;
            } else if (kind == "cuda") {
                config.rng = cpdif::RngKind::cuda;
            } else {
                throw UsageError("--rng must be cpu or cuda");
            }
        } else if (option == "--stream-layers") {
            config.stream_layers = true;
        } else if (option == "--no-offload-to-cpu") {
            config.offload_to_cpu = false;
        } else if (option == "--help" || option == "-h") {
            print_help();
            std::exit(0);
        } else {
            throw UsageError("unknown option: " + option);
        }
    }
    return config;
}

void print_validation_errors(const std::vector<std::string>& errors) {
    for (const auto& error : errors) {
        std::cerr << "error: " << error << '\n';
    }
}

void write_telemetry(
    const cpdif::RuntimeConfig& config,
    const cpdif::GenerationMetrics& metrics) {
    if (config.telemetry_path.empty()) {
        return;
    }
    const std::filesystem::path path(config.telemetry_path);
    if (path.has_parent_path()) {
        std::filesystem::create_directories(path.parent_path());
    }
    std::ofstream output(path);
    if (!output) {
        throw std::runtime_error("cannot write telemetry: " + config.telemetry_path);
    }
    output << "{\n"
           << "  \"schema_version\": 1,\n"
           << "  \"engine\": \"cpdif-sdcpp\",\n"
           << "  \"mode\": \"" << cpdif::generation_mode_name(config.mode) << "\",\n"
           << "  \"backend\": \"" << json_escape(metrics.backend_info) << "\",\n"
           << "  \"width\": " << config.width << ",\n"
           << "  \"height\": " << config.height << ",\n"
           << "  \"steps\": " << config.steps << ",\n"
           << "  \"seed\": " << config.seed << ",\n"
           << "  \"rng\": \"" << cpdif::rng_name(config.rng) << "\",\n"
           << "  \"load_ms\": " << metrics.load_ms << ",\n"
           << "  \"generation_ms\": " << metrics.generation_ms << ",\n"
           << "  \"output\": \"" << json_escape(config.output_path) << "\"\n"
           << "}\n";
}

}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc < 2 || std::string_view(argv[1]) == "--help" || std::string_view(argv[1]) == "-h") {
            print_help();
            return 0;
        }
        if (std::string_view(argv[1]) == "--version") {
            std::cout << CPDIF_VERSION << '\n';
            return 0;
        }

        const std::string command = argv[1];
        if (command == "backend") {
            std::cout << (cpdif::native_backend_available() ? "native backend available" : "native backend unavailable") << '\n';
            return cpdif::native_backend_available() ? 0 : 0;
        }
        if (command != "validate" && command != "generate" && command != "edit") {
            throw UsageError("unknown command: " + command);
        }

        const auto mode = command == "edit"
                              ? cpdif::GenerationMode::image_edit
                              : cpdif::GenerationMode::text_to_image;
        const cpdif::RuntimeConfig config = parse_config(argc, argv, 2, mode);
        const auto errors = cpdif::validate(config, true);
        if (!errors.empty()) {
            print_validation_errors(errors);
            return 2;
        }
        if (command == "validate") {
            std::cout << "configuration valid\n";
            return 0;
        }
        if (!cpdif::native_backend_available()) {
            std::cerr << "error: native backend unavailable in this build\n";
            return 3;
        }

        cpdif::KleinEngine engine(config);
        const auto metrics = engine.generate(config);
        write_telemetry(config, metrics);
        std::cout << "wrote " << config.output_path << " (load=" << metrics.load_ms
                  << "ms, generate=" << metrics.generation_ms << "ms)\n";
        return 0;
    } catch (const UsageError& error) {
        std::cerr << "usage error: " << error.what() << "\nRun cpdif --help for usage.\n";
        return 2;
    } catch (const std::exception& error) {
        std::cerr << "fatal: " << error.what() << '\n';
        return 1;
    }
}
