# CPDif

CPDif is a ComfyUI-free C++/CUDA command-line runtime for
`black-forest-labs/FLUX.2-klein-9B`. It uses the stable C API from a pinned
`stable-diffusion.cpp` revision and keeps the application boundary independent
from notebooks, Python inference frameworks, web servers, and future UI code.

The first hardware gate is one Google Colab NVIDIA A100 40GB runtime. RTX PRO
6000 validation and optimization begin only after the A100 path is proven.

## Current milestone

- Native C++ CLI with text-to-image and FLUX.2 reference-image editing,
  deterministic generation options, PNG input/output, progress logs, and JSON
  timing telemetry.
- CUDA build pinned to A100 compute capability 8.0 (`sm_80`).
- Colab CLI entrypoint that validates the exact GPU/VRAM target.
- Pinned and checksum-verified FLUX.2 Klein 9B transformer, Qwen3-8B text
  encoder, and FLUX.2 VAE downloads.
- Offline CPU build mode for repository/CLI tests without model weights.

This is the integration baseline, not yet a clean-room implementation of every
FLUX.2 kernel. The pinned native backend supplies the first correct C++/CUDA
execution path; differential tensor tests and purpose-built kernels can replace
backend pieces incrementally without changing the CLI contract.

## A100 build

From a Colab A100 40GB session:

```bash
bash scripts/colab/00_install_build_deps.sh
bash scripts/colab/01_prepare_upstream.sh
bash scripts/colab/02_build_cuda.sh
```

The executable is `/content/cpdif-work/build-a100/bin/cpdif` by default.

After a successful build, export a versioned A100 build cache:

```bash
bash scripts/colab/04_save_cache.sh
```

The archive contains the exact Ninja build directory, compressed `ccache`, and
a toolchain manifest. Keep it locally and restore it only through
`scripts/colab/05_restore_cache.sh`; incompatible CUDA, compiler, upstream, GPU,
or source ancestry is rejected.

Run the model download and smoke test after accepting the gated model license,
adding a read-only `HF_TOKEN` Colab secret, and loading it into kernel memory
once from the trusted Colab UI with `scripts/colab/ui_export_hf_token.py`:

```bash
bash scripts/model/download_model.sh
bash scripts/colab/06_cat_and_suit.sh
```

For the A100 low-VRAM/low-transfer optimization lane, the upstream maintainer
also publishes a checksum-pinned Q8 transformer. It follows the original 9B
license and is always evaluated against the BF16 fidelity baseline:

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
  --max-vram 36 --stream-layers \
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
  --max-vram 36 --stream-layers \
  --output edited.png --telemetry edited.json
```

`scripts/colab/06_cat_and_suit.sh` runs the required two-image acceptance path:
it generates one cat, then passes that exact PNG back as the edit reference.

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
