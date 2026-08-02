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

The dedicated Klein 9B-KV Q8 checkpoint was measured against the standard Q8
checkpoint in the same session on each GPU. Both profiles used three persistent
1024x1024 four-step requests at CFG 1.0; the warm request was discarded.

| GPU | Standard edit | KV edit | Edit speedup | Standard pair | KV pair | Pair speedup | KV peak VRAM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A100-SXM4-40GB (`sm80`) | 12.497 s | 9.332 s | 1.339x (25.33%) | 19.022 s | 15.884 s | 1.198x (16.50%) | 33,760 MiB |
| RTX PRO 6000 Blackwell (`sm120`) | 5.370 s | 3.780 s | 1.421x (29.61%) | 7.758 s | 6.172 s | 1.257x (20.44%) | 34,547 MiB |

The A100 run uses an 8 GiB graph-allocation limit to segment the graph while
keeping the reference K/V tensors persistent on CUDA. The RTX has enough VRAM
for the normal full-graph path. Compared with the standard checkpoint, the KV
path added 4,096 MiB peak VRAM on A100 and 4,738 MiB on RTX.

Every standard and KV request produced a valid, distinct 1024x1024 PNG and
valid telemetry. The standard outputs matched the historical GPU-specific
hashes exactly. Manual review of representative outputs on both GPUs confirmed
a clean orange tabby and a real same-cat edit with a fitted black suit, white
shirt, and tie; no blank or repeated-output artifact passed the final gate.

```bash
bash scripts/colab/09_klein_kv_validation.sh
```

The result is written to
`/content/cpdif-work/outputs/klein-kv/<gpu>/gpu-result.json`. Exact samples,
hashes, cache checksums, hardware details, and visual acceptance are recorded
in `docs/benchmarks/2026-08-02-klein-kv.json`.
