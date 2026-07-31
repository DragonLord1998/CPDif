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
