# Colab GPU benchmarks

These measurements use CPDif's native `generate-edit` command with one shared
FLUX.2 context, the checksum-pinned Q8 9B transformer, Qwen3-8B encoder, and
FLUX.2 VAE. Both images are 1024x1024, use four steps, CFG 1.0, CPU RNG, and
the same fixed prompts and seeds.

| Colab GPU | Native target | Cat | Same-cat edit | End-to-end | Peak VRAM |
| --- | --- | ---: | ---: | ---: | ---: |
| A100-SXM4-40GB | `sm80` | 12.457 s | 12.425 s | 26.630 s | 29,662 MiB |
| RTX PRO 6000 Blackwell | `sm120` | 4.348 s median | 5.502 s median | 10.730 s median | 29,809 MiB |

The RTX result is the median of three warm runs: 10.825, 10.730, and 10.615
seconds. GPU utilization reached 100%. Compared with the final A100 run, the
RTX workflow is 2.48x faster end-to-end and reduces latency by 59.7%.

The A100 residency experiment measured 39.304 seconds and 13,616 MiB with
CPU parameter offload plus layer streaming. Keeping the same Q8 weights on CUDA
reduced the comparable workflow to 26.941 seconds at 29,662 MiB, a 31.5%
latency reduction. Fast lossless PNG encoding subsequently reduced the final
A100 run to 26.630 seconds without changing decoded RGB pixels.

## Visual gate

Both GPUs produced a clean, centered orange tabby. Their edit results preserved
the cat's face, green eyes, fur markings, pose, camera framing, and gray studio
background while adding a fitted black suit, white shirt, and black tie. The
RTX output was inspected independently because GPU numerics changed the encoded
PNG hash.

## Method

- `scripts/colab/benchmark_runtime.py` sampled `nvidia-smi` every 100 ms.
- Stage timings come from telemetry schema 2 and exclude lossless PNG encoding;
  encoding time is reported separately.
- End-to-end time wraps `scripts/colab/06_cat_and_suit.sh`, including both
  inference stages, PNG writes, validation, and hashing.
- Model files are verified before inference with the SHA-256 values recorded in
  `docs/benchmarks/2026-07-31-colab-gpus.json`.
- These are Colab runtime measurements, not vendor peak-throughput claims.

Q8 is the validated low-latency profile. The gated BF16 transformer is not
silently substituted and requires its own fidelity/performance comparison when
the user explicitly makes a read-only Hugging Face token available in the
trusted Colab UI.

## Persistent and diffusion-cache pass (2026-08-01)

The SGLang/diffusion.cpp pass retains the same model hashes, prompts, seeds,
1024x1024 resolution, four steps, CPU RNG, CUDA residency, and pinned backend.

| GPU | Exact default median | Exact persistent steady median | Cache-DiT | Spectrum |
| --- | ---: | ---: | ---: | ---: |
| A100-SXM4-40GB | 26.246 s | 18.858 s | 18.409 s | 22.418 s |
| RTX PRO 6000 Blackwell | 10.485 s | 7.774 s | 7.192 s | 8.858 s |

Persistent execution improved steady-state latency by 28.1% on A100 and 25.9%
on RTX while preserving the exact default PNG hashes for the matching request.
It is the recommended serving profile.

Cache-DiT improved the measured pair by 29.9% on A100 and 31.4% on RTX. It
skipped denoiser computation and changed pixels, as expected for an approximate
cache. The generated cat and same-cat suit edit were reviewed on both GPUs and
passed the same identity/composition gate. It remains opt-in.

EasyCache produced bit-exact images for this workload but did not trigger a
meaningful speedup. DBCache, TaylorSeer, and combined Cache-DiT produced the
same output hashes and nearly identical latency with the tested four-step
profile. Spectrum skipped one of four steps and reported an estimated 1.33x
sampling speedup in the native runtime log.

Peak VRAM remained 29,662 MiB on A100 and 29,809 MiB on RTX. All cache modes
completed with valid 1024x1024 PNGs, 100% peak GPU utilization, and successful
telemetry validation. Raw results and hashes are recorded in
`docs/benchmarks/2026-08-01-sglang-diffusion.json`.

Telemetry is schema 3 for this pass. The benchmark's persistent steady-state
measurement sums generation, in-memory reference handling, and lossless PNG
write stages after the first request; model load is excluded because the
context remains resident.

## Klein 9B-KV reference cache

CPDif now includes the dedicated Klein 9B-KV execution path, but no result is
added to the measured table until the GPU evaluator passes. The gate uses the
checksum-pinned standard and KV Q8 checkpoints, 1024x1024 images, four steps,
CFG 1.0, full residency, and three persistent requests per profile. It requires
valid PNG and telemetry artifacts and a KV steady-state image-edit median below
the standard checkpoint measured in the same GPU session. The combined
generate-plus-edit latency remains a separate reported metric. The standard
profile must also reproduce the previously recorded GPU-specific PNG hashes,
guarding the existing exact path while the new model path is evaluated.

```bash
bash scripts/colab/09_klein_kv_validation.sh
```

The result is written to
`/content/cpdif-work/outputs/klein-kv/<gpu>/gpu-result.json`. Local compilation
and regression tests prove integration, not GPU speed or visual quality; those
remain open until this command finishes on a supported A100 40GB or RTX PRO
6000 runtime.
