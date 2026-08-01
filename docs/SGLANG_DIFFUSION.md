# SGLang Diffusion and stable-diffusion.cpp mapping

This optimization pass compared CPDif with SGLang Diffusion at upstream commit
`e1964da451ef9fbec04b326c729916281f90809b` and with CPDif's pinned
stable-diffusion.cpp commit
`e31a86ce9110b11a98bd5990c329093244c2d1e3`.

Primary references:

- [SGLang Diffusion architecture](https://www.lmsys.org/blog/2025-11-07-sglang-diffusion/)
- [SGLang Diffusion performance work](https://www.lmsys.org/blog/2026-01-16-sglang-diffusion/)
- [SGLang Cache-DiT integration at the inspected commit](https://github.com/sgl-project/sglang/blob/e1964da451ef9fbec04b326c729916281f90809b/python/sglang/multimodal_gen/runtime/cache/cache_dit_integration.py)
- [stable-diffusion.cpp sample-cache runtime at CPDif's pin](https://github.com/leejet/stable-diffusion.cpp/blob/e31a86ce9110b11a98bd5990c329093244c2d1e3/src/runtime/sample-cache.cpp)

## What was implemented

| Technique | CPDif implementation |
| --- | --- |
| Persistent pipeline/model residency | `KleinEngine` stays alive for repeated `generate-edit` requests through `--repeat`; only the first request reports model load time. |
| In-memory stage handoff | The generated RGB buffer is passed directly to visual conditioning. The lossless PNG is still written, but is no longer decoded before editing. |
| Cache-DiT | CPDif exposes DBCache, TaylorSeer, their combined Cache-DiT mode, SCM masks, block counts, warmup, residual threshold, and cache-step limits. |
| Other native diffusion caches | EasyCache and Spectrum are exposed with their native thresholds and scheduling controls. |
| Warmup-aware four-step tuning | The reproducible benchmark uses one warmup step for Klein's four-step distilled schedule. SGLang's default of four warmup steps is aimed at longer schedules and would leave no step to cache here. |
| Flash Attention and native CUDA kernels | CPDif continues to enable diffusion Flash Attention and compiles the pinned GGML CUDA backend for the attached GPU's real architecture (`sm80` or `sm120`). |
| Layer/offload policy | Existing CUDA residency and layer streaming remain available. The exact Q8 profile fits both validated GPUs and is faster fully resident. |
| Peak-memory and stage observability | Telemetry schema 3 records cache mode/configuration, context reuse, reference-load time, model load, generation, PNG write, residency, and streaming state. |

The exact default remains cache-disabled. Persistent context reuse changes no
pixels and is safe as the default serving architecture. Denoiser caches are
approximate and remain explicit opt-ins.

## What was not copied

- SGLang's tensor, sequence, ring, and CFG parallelism target multiple GPUs.
  CPDif currently validates one GPU per Colab runtime, so those paths would add
  complexity without helping this deployment.
- SGLang dynamic batching currently excludes image-conditioned requests in the
  inspected scheduler. CPDif's key workflow is reference-image editing, so the
  first serving milestone keeps a persistent context and sequential request
  semantics. A future UI server can add queueing without changing the engine.
- SGLang's PyTorch/Triton operator fusions and `torch.compile` graphs do not map
  directly onto a pure C++ GGML graph. Equivalent gains must land in
  stable-diffusion.cpp/GGML CUDA kernels and be verified there.
- ModelOpt FP8/NVFP4 was not substituted for the checksum-pinned Q8 GGUF model.
  It is a separate numerical profile and requires its own conversion, quality,
  license, and benchmark gate.
- SGLang's Spectral Progressive Diffusion is not the same algorithm as
  stable-diffusion.cpp's Spectrum cache. CPDif exposes the pinned native
  Spectrum implementation but does not label it as progressive resolution.
- FLUX.2 Klein 9B-KV reference-image KV caching is still an open
  [stable-diffusion.cpp feature request](https://github.com/leejet/stable-diffusion.cpp/issues/1341),
  so CPDif does not claim that capability.

## Reproduce the gate

On exactly one supported Colab GPU:

```bash
bash scripts/colab/08_sglang_diffusion_validation.sh
```

The script builds for the detected architecture, verifies models, runs CTest
and Python tests, then benchmarks three exact default runs, a three-request
persistent session, and all five cache modes. The evaluator is:

```bash
python3 scripts/perf/evaluate_sglang_diffusion.py \
  --baseline docs/benchmarks/2026-07-31-colab-gpus.json \
  --candidate docs/benchmarks/2026-08-01-sglang-diffusion.json
```
