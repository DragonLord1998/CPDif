# CPDif

CPDif is a ComfyUI-free C++/CUDA command-line runtime for
`black-forest-labs/FLUX.2-klein-9B`. It uses the stable C API from a pinned
`stable-diffusion.cpp` revision and keeps the application boundary independent
from notebooks, Python inference frameworks, web servers, and future UI code.

The engine is built and visually validated through the Google Colab CLI on an
NVIDIA A100 40GB and an NVIDIA RTX PRO 6000 Blackwell Server Edition. It does
not depend on ComfyUI, a notebook UI, a tunnel, or a Python inference runtime.

## Current milestone

- Native C++ CLI with text-to-image, reference-image editing, and a
  single-context `generate-edit` workflow that avoids reloading the 9B model.
- Native CUDA builds for A100 `sm80` and RTX PRO 6000 Blackwell `sm120`.
- Automatic parameter residency: the checksum-pinned Q8 profile stays on CUDA
  when model size plus an 8 GiB safety reserve fits; otherwise it streams.
- Pinned and checksum-verified FLUX.2 Klein 9B transformer, Qwen3-8B text
  encoder, and FLUX.2 VAE downloads.
- Lossless low-latency PNG output and telemetry for load, generation, encoding,
  residency, and streaming state.
- Offline CPU build mode for repository/CLI tests without model weights.

This is the integration baseline, not yet a clean-room implementation of every
FLUX.2 kernel. The pinned native backend supplies the first correct C++/CUDA
execution path; differential tensor tests and purpose-built kernels can replace
backend pieces incrementally without changing the CLI contract.

## Colab GPU build and validation

On either supported Colab GPU, the complete public Q8 path is:

```bash
bash scripts/colab/07_run_gpu_validation.sh
```

The script detects the one attached GPU, compiles for its real compute
capability, runs CTest, downloads and verifies the public model components, and
then generates the required cat plus same-cat suit edit.

Measured native performance at 1024x1024 and four steps:

| GPU | Cat | Same-cat edit | End-to-end | Peak VRAM |
| --- | ---: | ---: | ---: | ---: |
| A100 40GB (`sm80`) | 12.457 s | 12.425 s | 26.630 s | 29,662 MiB |
| RTX PRO 6000 (`sm120`) | 4.348 s median | 5.502 s median | 10.730 s median | 29,809 MiB |

See [the benchmark methodology and evidence](docs/BENCHMARKS.md).

## A100 build stages

From a Colab A100 40GB session:

```bash
bash scripts/colab/00_install_build_deps.sh
bash scripts/colab/01_prepare_upstream.sh
bash scripts/colab/02_build_cuda.sh
```

The executable is `/content/cpdif-work/build-a100/bin/cpdif` by default.

After a successful build, export a versioned GPU build cache:

```bash
bash scripts/colab/04_save_cache.sh
```

The archive contains the exact Ninja build directory, compressed `ccache`, and
a toolchain manifest. Keep it outside Git and restore it only through
`scripts/colab/05_restore_cache.sh`; incompatible compute capability, CUDA,
compiler, upstream, paths, or source ancestry is rejected. Legacy A100 cache
manifests remain supported.

Run the model download and smoke test after accepting the gated model license,
adding a read-only `HF_TOKEN` Colab secret, and loading it into kernel memory
once from the trusted Colab UI with `scripts/colab/ui_export_hf_token.py`:

```bash
bash scripts/model/download_model.sh
bash scripts/colab/06_cat_and_suit.sh
```

For the low-latency path, the upstream maintainer publishes a checksum-pinned
Q8 transformer. It follows the original 9B license and remains distinct from
the gated BF16 fidelity profile:

```bash
bash scripts/model/download_q8_transformer.sh
TRANSFORMER_PATH=/content/cpdif-work/models/flux-2-klein-9b-Q8_0.gguf \
  bash scripts/colab/06_cat_and_suit.sh
```

The full Colab CLI entrypoint is:

```text
scripts/colab/cli_entrypoint.py
```

See [the A100 workflow](docs/COLAB_A100_WORKFLOW.md) and
[security notes](docs/SECURITY.md).

## Direct CLI

```bash
cpdif generate \
  --transformer /models/flux-2-klein-9b.safetensors \
  --text-encoder /models/qwen_3_8b.safetensors \
  --vae /models/flux2-vae.safetensors \
  --prompt "a small red cube on a plain white background" \
  --steps 4 --cfg-scale 1.0 --seed 12345 \
  --width 1024 --height 1024 \
  --offload-to-cpu --max-vram 36 --stream-layers \
  --output output.png --telemetry output.json
```

Edit that generated image through FLUX.2 visual conditioning:

```bash
cpdif edit \
  --transformer /models/flux-2-klein-9b.safetensors \
  --text-encoder /models/qwen_3_8b.safetensors \
  --vae /models/flux2-vae.safetensors \
  --reference-image output.png \
  --qwen-image-layers 3 \
  --prompt "Keep the same cat and dress it in a fitted black business suit" \
  --steps 4 --cfg-scale 1.0 --seed 12346 \
  --width 1024 --height 1024 \
  --offload-to-cpu --max-vram 36 --stream-layers \
  --output edited.png --telemetry edited.json
```

For the lowest two-stage latency, keep one native context alive:

```bash
cpdif generate-edit \
  --transformer /models/flux-2-klein-9b-Q8_0.gguf \
  --text-encoder /models/qwen_3_8b.safetensors \
  --vae /models/flux2-vae.safetensors \
  --prompt "a realistic orange tabby cat in a gray studio" \
  --edit-prompt "Keep the same cat and dress it in a fitted black suit" \
  --seed 20260731 --edit-seed 20260732 \
  --steps 4 --cfg-scale 1.0 --width 1024 --height 1024 \
  --no-offload-to-cpu \
  --output cat.png --telemetry cat.json \
  --edited-output cat-in-suit.png --edited-telemetry cat-in-suit.json
```

`scripts/colab/06_cat_and_suit.sh` runs the required two-image acceptance path:
it uses `cpdif generate-edit` to generate one cat and pass that exact PNG back
as the edit reference without destroying and recreating the inference context.

## Offline validation build

```bash
cmake -S . -B build -DCPDIF_OFFLINE=ON -DCPDIF_ENABLE_CUDA=OFF
cmake --build build
ctest --test-dir build --output-on-failure
```

## Licensing

CPDif source code is MIT licensed. The FLUX.2 Klein 9B weights are separate,
gated, and covered by the FLUX Non-Commercial License and Acceptable Use Policy.
No weights are distributed by this repository. Users must review and comply
with the model license, including its safety-filter requirements.

The pinned `stable-diffusion.cpp` dependency is fetched from its upstream
repository and remains subject to its own license and notices.
