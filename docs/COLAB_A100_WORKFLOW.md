# Colab A100 40GB workflow

This workflow builds CPDif through the Google Colab CLI on exactly one NVIDIA
A100 40GB runtime. It does not start a web server, tunnel, iframe, or GUI.

## Colab CLI control plane

Create one runtime:

```bash
colab new --session cpdif-a100 --gpu A100
```

Because the CLI does not expose a 40GB/80GB selector, CPDif checks the live GPU
name and VRAM and refuses any target other than one A100 with about 40GB.

Upload or clone this repository to `/content/CPDif`, then execute:

```bash
colab exec -s cpdif-a100 -f scripts/colab/cli_entrypoint.py --timeout 7200
```

Colab deliberately blocks `google.colab.userdata` when a cell is executed
remotely through the CLI. Before the gated model download, open the trusted
runtime UI once and run `scripts/colab/ui_export_hf_token.py`. It copies the
read-only `HF_TOKEN` secret into kernel memory without printing or persisting
the token. Subsequent CLI cells inherit that kernel environment. The CLI
entrypoint fails closed when `HF_TOKEN` is absent.

## Debuggable stages

Inside the runtime the entrypoint runs these stages in order:

```bash
bash scripts/colab/00_install_build_deps.sh
bash scripts/colab/01_prepare_upstream.sh
bash scripts/colab/02_build_cuda.sh
bash scripts/model/download_model.sh
bash scripts/colab/06_cat_and_suit.sh
```

Defaults:

| Item | Path/value |
| --- | --- |
| Work/cache root | `/content/cpdif-work` |
| Native executable | `/content/cpdif-work/build-a100/bin/cpdif` |
| CUDA architecture | `80` (`sm_80`) |
| Transformer | `models/flux-2-klein-9b.safetensors` |
| Text encoder | `models/qwen_3_8b.safetensors` |
| VAE | `models/flux2-vae.safetensors` |
| Output | `outputs/cpdif-klein-9b-a100.png` |
| Telemetry | `outputs/cpdif-klein-9b-a100.json` |
| Seed/steps/CFG | `12345` / `4` / `1.0` |

The three model files are not committed. The download script verifies pinned
SHA-256 checksums before generation.

Public auxiliary components can be hydrated before gated transformer access is
available:

```bash
MODEL_COMPONENTS=text_encoder,vae bash scripts/model/download_model.sh
```

The public upstream-maintainer Q8 transformer can be hydrated independently for
the optimized all-GPU candidate path:

```bash
bash scripts/model/download_q8_transformer.sh
```

Its exact 9.98 GB file hash and upstream commit are pinned. Q8 is an optimization
candidate, not an automatic fidelity substitute for the gated BF16 checkpoint.

The final A100 acceptance script writes `outputs/cat-suit/cat.png`, then uses
that exact file as the single FLUX.2 reference image for
`outputs/cat-suit/cat-in-suit.png`. Both PNGs and both telemetry files are
validated before their checksums are recorded.

## Build-only debug loop

The model bundle is about 35GB. Compile and run CTest first; model download is a
separate stage so C++/CUDA errors can be fixed without repeating the download.

```bash
bash scripts/colab/01_prepare_upstream.sh
bash scripts/colab/02_build_cuda.sh
```

On success, `cpdif backend` prints `native backend available` and CTest passes.

## Preserving the cold-build cache

Export the cache only after the build and CTest succeed:

```bash
bash scripts/colab/04_save_cache.sh
```

This produces a `.tar.zst` archive and `.sha256` under
`/content/cpdif-cache-exports`. Download both with the Colab CLI and keep them
outside Git. The archive contains the exact `build-a100` directory for the
fastest resume, a compressed `ccache` for incremental compiler reuse, and a
manifest recording project/upstream commits, GPU, compute capability, CUDA,
GCC, CMake, and expected paths.

On a later fresh A100 40GB runtime, first clone CPDif and prepare the pinned
upstream source, then upload the archive and restore it:

```bash
CPDIF_CACHE_ARCHIVE=/content/cpdif-cache.tar.zst \
CPDIF_CACHE_SHA256=<expected-sha256> \
bash scripts/colab/05_restore_cache.sh
```

Restore fails closed when the archive checksum, A100 target, CUDA/compiler,
upstream revision, fixed Colab paths, or project ancestry does not match.
