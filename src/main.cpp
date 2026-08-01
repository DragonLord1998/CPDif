#include "cpdif/config.hpp"
#include "engine.hpp"

#include <charconv>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
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

struct GenerateEditOptions {
    std::string prompt;
    std::string output_path;
    std::string telemetry_path;
    std::int64_t seed = 0;
    bool seed_is_set = false;
    int repeat = 1;
};

void print_help() {
    std::cout
        << "CPDif " << CPDIF_VERSION << " - native FLUX.2 Klein 9B C++/CUDA runtime\n\n"
        << "Usage:\n"
        << "  cpdif backend\n"
        << "  cpdif validate [generation options]\n"
        << "  cpdif generate [generation options]\n"
        << "  cpdif edit --reference-image PATH [generation options]\n"
        << "  cpdif generate-edit --edit-prompt TEXT --edited-output PATH "
           "[generation options]\n\n"
        << "Required generation options:\n"
        << "  --transformer PATH     FLUX.2-klein-9B transformer (.safetensors or .gguf)\n"
        << "  --text-encoder PATH    Qwen3-8B text encoder\n"
        << "  --vae PATH             FLUX.2 VAE\n"
        << "  --prompt TEXT          Prompt to render\n\n"
        << "Required for edit:\n"
        << "  --reference-image PATH Source image to preserve and edit\n\n"
        << "Required for generate-edit:\n"
        << "  --edit-prompt TEXT     Prompt for the reference-image edit\n"
        << "  --edited-output PATH   PNG output for the edited image\n\n"
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
        << "  --offload-to-cpu       Keep parameters in RAM until their compute stage\n"
        << "  --no-offload-to-cpu    Keep parameters on the compute backend\n"
        << "  --rng cpu|cuda         Noise RNG (default: cpu for reproducibility)\n"
        << "  --cache MODE           disabled|easycache|dbcache|taylorseer|cache-dit|spectrum\n"
        << "  --cache-threshold F    EasyCache reuse threshold (-1: backend default)\n"
        << "  --cache-start F        First cache-eligible denoise fraction (default: 0.15)\n"
        << "  --cache-end F          Last cache-eligible denoise fraction (default: 0.95)\n"
        << "  --cache-fn N           First DiT blocks always computed (default: 1)\n"
        << "  --cache-bn N           Last DiT blocks always computed (default: 0)\n"
        << "  --cache-rdt F          Cache-DiT residual threshold (default: 0.24)\n"
        << "  --cache-warmup N       Cache-DiT warmup steps (default: 4)\n"
        << "  --cache-max-steps N    Total cached-step limit (-1: unlimited)\n"
        << "  --cache-max-continuous N  Consecutive cached-step limit (default: 3)\n"
        << "  --cache-scm-mask TEXT  Cache-DiT step computation mask\n"
        << "  --cache-scm-static     Use the SCM mask without dynamic overrides\n"
        << "  --taylorseer-order N   Taylor expansion order, 1 or 2\n"
        << "  --taylorseer-skip N    TaylorSeer skip interval (default: 1)\n"
        << "  --spectrum-w F         Spectrum frequency cutoff ratio (default: 0.40)\n"
        << "  --spectrum-m N         Spectrum history order (default: 3)\n"
        << "  --spectrum-lambda F    Spectrum regularization (default: 1.0)\n"
        << "  --spectrum-window N    Spectrum history window (default: 2)\n"
        << "  --spectrum-flex F      Spectrum flexible-window ratio (default: 0.50)\n"
        << "  --spectrum-warmup N    Spectrum warmup steps (default: 4)\n"
        << "  --spectrum-stop F      Spectrum stop fraction (default: 0.90)\n"
        << "  --edit-seed N          Seed for generate-edit (default: seed + 1)\n"
        << "  --edited-telemetry P   JSON telemetry for generate-edit's edited image\n"
        << "  --repeat N             Reuse one loaded context for N generate-edit jobs\n"
        << "                         (output paths must contain {index} when N > 1)\n"
        << "  --verbose              Include upstream debug-level logging\n";
}

std::string expand_indexed_path(
    const std::string& option,
    const std::string& path,
    int request_index,
    int repeat) {
    if (path.empty()) {
        return {};
    }
    if (repeat == 1) {
        return path;
    }
    constexpr std::string_view token = "{index}";
    const auto position = path.find(token);
    if (position == std::string::npos) {
        throw UsageError(option + " must contain {index} when --repeat is greater than 1");
    }
    std::string expanded = path;
    expanded.replace(position, token.size(), std::to_string(request_index + 1));
    return expanded;
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
    cpdif::GenerationMode mode,
    GenerateEditOptions* generate_edit_options = nullptr) {
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
        } else if (option == "--cache") {
            const std::string mode_name = value();
            if (mode_name == "disabled") {
                config.cache.mode = cpdif::CacheMode::disabled;
            } else if (mode_name == "easycache") {
                config.cache.mode = cpdif::CacheMode::easycache;
            } else if (mode_name == "dbcache") {
                config.cache.mode = cpdif::CacheMode::dbcache;
            } else if (mode_name == "taylorseer") {
                config.cache.mode = cpdif::CacheMode::taylorseer;
            } else if (mode_name == "cache-dit") {
                config.cache.mode = cpdif::CacheMode::cache_dit;
            } else if (mode_name == "spectrum") {
                config.cache.mode = cpdif::CacheMode::spectrum;
            } else {
                throw UsageError(
                    "--cache must be disabled, easycache, dbcache, taylorseer, "
                    "cache-dit, or spectrum");
            }
        } else if (option == "--cache-threshold") {
            config.cache.reuse_threshold = parse_float(option, value());
        } else if (option == "--cache-start") {
            config.cache.start_percent = parse_float(option, value());
        } else if (option == "--cache-end") {
            config.cache.end_percent = parse_float(option, value());
        } else if (option == "--cache-fn") {
            config.cache.fn_compute_blocks = parse_integer<int>(option, value());
        } else if (option == "--cache-bn") {
            config.cache.bn_compute_blocks = parse_integer<int>(option, value());
        } else if (option == "--cache-rdt") {
            config.cache.residual_diff_threshold = parse_float(option, value());
        } else if (option == "--cache-warmup") {
            config.cache.max_warmup_steps = parse_integer<int>(option, value());
        } else if (option == "--cache-max-steps") {
            config.cache.max_cached_steps = parse_integer<int>(option, value());
        } else if (option == "--cache-max-continuous") {
            config.cache.max_continuous_cached_steps =
                parse_integer<int>(option, value());
        } else if (option == "--cache-scm-mask") {
            config.cache.scm_mask = value();
        } else if (option == "--cache-scm-static") {
            config.cache.scm_policy_dynamic = false;
        } else if (option == "--taylorseer-order") {
            config.cache.taylorseer_order = parse_integer<int>(option, value());
        } else if (option == "--taylorseer-skip") {
            config.cache.taylorseer_skip_interval = parse_integer<int>(option, value());
        } else if (option == "--spectrum-w") {
            config.cache.spectrum_w = parse_float(option, value());
        } else if (option == "--spectrum-m") {
            config.cache.spectrum_m = parse_integer<int>(option, value());
        } else if (option == "--spectrum-lambda") {
            config.cache.spectrum_lambda = parse_float(option, value());
        } else if (option == "--spectrum-window") {
            config.cache.spectrum_window_size = parse_integer<int>(option, value());
        } else if (option == "--spectrum-flex") {
            config.cache.spectrum_flex_window = parse_float(option, value());
        } else if (option == "--spectrum-warmup") {
            config.cache.spectrum_warmup_steps = parse_integer<int>(option, value());
        } else if (option == "--spectrum-stop") {
            config.cache.spectrum_stop_percent = parse_float(option, value());
        } else if (option == "--stream-layers") {
            config.stream_layers = true;
        } else if (option == "--offload-to-cpu") {
            config.offload_to_cpu = true;
        } else if (option == "--no-offload-to-cpu") {
            config.offload_to_cpu = false;
        } else if (option == "--edit-prompt" && generate_edit_options != nullptr) {
            generate_edit_options->prompt = value();
        } else if (option == "--edited-output" && generate_edit_options != nullptr) {
            generate_edit_options->output_path = value();
        } else if (option == "--edited-telemetry" && generate_edit_options != nullptr) {
            generate_edit_options->telemetry_path = value();
        } else if (option == "--edit-seed" && generate_edit_options != nullptr) {
            generate_edit_options->seed = parse_integer<std::int64_t>(option, value());
            generate_edit_options->seed_is_set = true;
        } else if (option == "--repeat" && generate_edit_options != nullptr) {
            generate_edit_options->repeat = parse_integer<int>(option, value());
        } else if (option == "--verbose") {
            config.verbose_logging = true;
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
    const cpdif::GenerationMetrics& metrics,
    int session_request_index = 0) {
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
           << "  \"schema_version\": 3,\n"
           << "  \"engine\": \"cpdif-sdcpp\",\n"
           << "  \"session_request_index\": " << session_request_index << ",\n"
           << "  \"mode\": \"" << cpdif::generation_mode_name(config.mode) << "\",\n"
           << "  \"backend\": \"" << json_escape(metrics.backend_info) << "\",\n"
           << "  \"width\": " << config.width << ",\n"
           << "  \"height\": " << config.height << ",\n"
           << "  \"steps\": " << config.steps << ",\n"
           << "  \"seed\": " << config.seed << ",\n"
           << "  \"rng\": \"" << cpdif::rng_name(config.rng) << "\",\n"
           << "  \"cache_mode\": \"" << cpdif::cache_mode_name(config.cache.mode)
           << "\",\n"
           << "  \"cache\": {\n"
           << "    \"reuse_threshold\": " << config.cache.reuse_threshold << ",\n"
           << "    \"start_percent\": " << config.cache.start_percent << ",\n"
           << "    \"end_percent\": " << config.cache.end_percent << ",\n"
           << "    \"fn_compute_blocks\": " << config.cache.fn_compute_blocks << ",\n"
           << "    \"bn_compute_blocks\": " << config.cache.bn_compute_blocks << ",\n"
           << "    \"residual_diff_threshold\": "
           << config.cache.residual_diff_threshold << ",\n"
           << "    \"max_warmup_steps\": " << config.cache.max_warmup_steps << ",\n"
           << "    \"max_cached_steps\": " << config.cache.max_cached_steps << ",\n"
           << "    \"max_continuous_cached_steps\": "
           << config.cache.max_continuous_cached_steps << ",\n"
           << "    \"scm_mask\": \"" << json_escape(config.cache.scm_mask) << "\",\n"
           << "    \"scm_policy\": \""
           << (config.cache.scm_policy_dynamic ? "dynamic" : "static") << "\"\n"
           << "  },\n"
           << "  \"parameter_residency\": \""
           << (config.offload_to_cpu ? "cpu" : "cuda") << "\",\n"
           << "  \"stream_layers\": " << (config.stream_layers ? "true" : "false") << ",\n"
           << "  \"max_vram\": \"" << json_escape(config.max_vram) << "\",\n"
           << "  \"load_ms\": " << metrics.load_ms << ",\n"
           << "  \"context_reused\": "
           << (metrics.context_reused ? "true" : "false") << ",\n"
           << "  \"reference_load_ms\": " << metrics.reference_load_ms << ",\n"
           << "  \"generation_ms\": " << metrics.generation_ms << ",\n"
           << "  \"image_write_ms\": " << metrics.image_write_ms << ",\n"
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
        if (command != "validate" && command != "generate" && command != "edit" &&
            command != "generate-edit") {
            throw UsageError("unknown command: " + command);
        }

        const auto mode = command == "edit"
                              ? cpdif::GenerationMode::image_edit
                              : cpdif::GenerationMode::text_to_image;
        GenerateEditOptions generate_edit_options;
        const bool generate_edit = command == "generate-edit";
        const cpdif::RuntimeConfig config = parse_config(
            argc,
            argv,
            2,
            mode,
            generate_edit ? &generate_edit_options : nullptr);
        const auto errors = cpdif::validate(config, true);
        if (!errors.empty()) {
            print_validation_errors(errors);
            return 2;
        }
        if (command == "validate") {
            std::cout << "configuration valid\n";
            return 0;
        }
        if (generate_edit) {
            if (generate_edit_options.prompt.empty()) {
                throw UsageError("--edit-prompt is required for generate-edit");
            }
            if (generate_edit_options.output_path.empty()) {
                throw UsageError("--edited-output is required for generate-edit");
            }
            if (std::filesystem::path(generate_edit_options.output_path) ==
                std::filesystem::path(config.output_path)) {
                throw UsageError("--edited-output must differ from --output");
            }
            if (!generate_edit_options.seed_is_set) {
                if (config.seed == std::numeric_limits<std::int64_t>::max()) {
                    throw UsageError("--edit-seed is required when --seed is INT64_MAX");
                }
                generate_edit_options.seed = config.seed + 1;
            }
            if (generate_edit_options.repeat < 1 || generate_edit_options.repeat > 1000) {
                throw UsageError("--repeat must be between 1 and 1000");
            }
            const auto repeat_offset =
                static_cast<std::int64_t>(generate_edit_options.repeat - 1) * 2;
            if (config.seed > std::numeric_limits<std::int64_t>::max() - repeat_offset ||
                generate_edit_options.seed >
                    std::numeric_limits<std::int64_t>::max() - repeat_offset) {
                throw UsageError("seed range overflows across repeated requests");
            }
            (void)expand_indexed_path(
                "--output", config.output_path, 0, generate_edit_options.repeat);
            (void)expand_indexed_path(
                "--edited-output",
                generate_edit_options.output_path,
                0,
                generate_edit_options.repeat);
            if (!config.telemetry_path.empty()) {
                (void)expand_indexed_path(
                    "--telemetry", config.telemetry_path, 0, generate_edit_options.repeat);
            }
            if (!generate_edit_options.telemetry_path.empty()) {
                (void)expand_indexed_path(
                    "--edited-telemetry",
                    generate_edit_options.telemetry_path,
                    0,
                    generate_edit_options.repeat);
            }
        }
        if (!cpdif::native_backend_available()) {
            std::cerr << "error: native backend unavailable in this build\n";
            return 3;
        }

        cpdif::KleinEngine engine(config);
        const int request_count = generate_edit ? generate_edit_options.repeat : 1;
        for (int request_index = 0; request_index < request_count; ++request_index) {
            cpdif::RuntimeConfig run_config = config;
            if (generate_edit) {
                run_config.output_path = expand_indexed_path(
                    "--output", config.output_path, request_index, request_count);
                run_config.telemetry_path = expand_indexed_path(
                    "--telemetry", config.telemetry_path, request_index, request_count);
                run_config.seed = config.seed + static_cast<std::int64_t>(request_index) * 2;
            }

            const auto result = engine.generate(run_config);
            const auto& metrics = result.metrics;
            write_telemetry(run_config, metrics, request_index);
            std::cout << "wrote " << run_config.output_path << " (load="
                      << metrics.load_ms << "ms, generate=" << metrics.generation_ms
                      << "ms, encode=" << metrics.image_write_ms << "ms)\n";
            if (!generate_edit) {
                continue;
            }

            cpdif::RuntimeConfig edit_config = run_config;
            edit_config.mode = cpdif::GenerationMode::image_edit;
            edit_config.reference_image_path = run_config.output_path;
            edit_config.prompt = generate_edit_options.prompt;
            edit_config.output_path = expand_indexed_path(
                "--edited-output",
                generate_edit_options.output_path,
                request_index,
                request_count);
            edit_config.telemetry_path = expand_indexed_path(
                "--edited-telemetry",
                generate_edit_options.telemetry_path,
                request_index,
                request_count);
            edit_config.seed = generate_edit_options.seed +
                               static_cast<std::int64_t>(request_index) * 2;

            const auto edit_errors = cpdif::validate(edit_config, true);
            if (!edit_errors.empty()) {
                print_validation_errors(edit_errors);
                return 2;
            }
            const auto edit_result = engine.generate(edit_config, &result.image);
            const auto& edit_metrics = edit_result.metrics;
            write_telemetry(edit_config, edit_metrics, request_index);
            std::cout << "wrote " << edit_config.output_path << " (load="
                      << edit_metrics.load_ms << "ms, generate="
                      << edit_metrics.generation_ms << "ms, encode="
                      << edit_metrics.image_write_ms << "ms)\n";
        }
        return 0;
    } catch (const UsageError& error) {
        std::cerr << "usage error: " << error.what() << "\nRun cpdif --help for usage.\n";
        return 2;
    } catch (const std::exception& error) {
        std::cerr << "fatal: " << error.what() << '\n';
        return 1;
    }
}
