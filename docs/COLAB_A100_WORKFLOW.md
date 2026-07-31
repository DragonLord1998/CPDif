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

The entrypoint reads `HF_TOKEN` (or legacy `HF_Token`) from Colab userdata only
when it is not already present in the process environment. It never prints the
token or writes it into this repository.

## Debuggable stages

Inside the runtime the entrypoint runs these stages in order:

```bash
bash scripts/colab/00_install_build_deps.sh
bash scripts/colab/01_prepare_upstream.sh
bash scripts/colab/02_build_cuda.sh
bash scripts/model/download_model.sh
bash scripts/colab/03_smoke_prompt.sh
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

## Build-only debug loop

The model bundle is about 35GB. Compile and run CTest first; model download is a
separate stage so C++/CUDA errors can be fixed without repeating the download.

```bash
bash scripts/colab/01_prepare_upstream.sh
bash scripts/colab/02_build_cuda.sh
```

On success, `cpdif backend` prints `native backend available` and CTest passes.
