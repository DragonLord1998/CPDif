# FLUX.2 Klein 9B-KV reference cache

Black Forest Labs publishes a dedicated `FLUX.2-klein-9B-KV` checkpoint whose
reference-image attention can be reused after the first denoising step. CPDif
implements that graph in its pinned stable-diffusion.cpp dependency because
the corresponding upstream feature request is still open.

## Runtime behavior

On the first denoising step, each double and single transformer block:

1. orders the image stream as reference tokens followed by current-image
   tokens;
2. applies the reference timestep-zero modulation specified by the KV model;
3. uses causal attention so reference tokens attend only to the reference;
4. stores the RoPE-transformed reference keys and reference values in the
   persistent GGML runner cache.

Later steps omit the reference latent from the graph and concatenate the cached
reference K/V tensors into attention for the text and current-image streams.
Both pending and persisted cache tensors are cleared at the first step of every
new edit, including recovery after an interrupted graph. This is reference
attention reuse, not denoiser-step skipping and not CPDif's approximate
Cache-DiT mode.

The implementation is distributed as
`patches/stable-diffusion-klein-kv-cache.patch`. CMake checks and applies it
idempotently to both a local `CPDIF_SDCXX_SOURCE_DIR` checkout and the pinned
FetchContent source. GPU build-cache manifest schema 3 includes the patch
SHA-256 so older or differently patched binaries are rejected.

## Model and command contract

Use only the dedicated KV checkpoint. The helper downloads QuantStack's direct
Q8 GGUF conversion and verifies its fixed SHA-256:

```bash
bash scripts/model/download_kv_q8_transformer.sh
```

Enable the graph with `--klein-kv-cache`. CPDif currently requires CFG 1.0 for
this mode because multiple condition passes would overwrite one shared
reference cache. Layer streaming is rejected because the segmented graph
runner releases its intermediate cache between segments. Approximate diffusion
caches are also rejected so their step-skipping state cannot interfere with
the reference K/V lifecycle.

```bash
cpdif generate-edit \
  --transformer /models/flux-2-klein-9b-kv-Q8_0.gguf \
  --text-encoder /models/qwen_3_8b.safetensors \
  --vae /models/flux2-vae.safetensors \
  --klein-kv-cache --cfg-scale 1.0 --steps 4 \
  --prompt "a realistic orange tabby cat in a gray studio" \
  --edit-prompt "Keep the same cat and dress it in a fitted black suit" \
  --output cat.png --telemetry cat.json \
  --edited-output cat-in-suit.png --edited-telemetry cat-in-suit.json
```

Do not use `--klein-kv-cache` with the standard Klein 9B checkpoint. The flag
selects a graph contract; it cannot turn standard weights into the KV model.

## Validation

The local integration gate is a full native build, CTest, and Python regression
suite. The performance gate must run on a supported Colab GPU:

```bash
bash scripts/colab/09_klein_kv_validation.sh
```

It runs both the standard Q8 checkpoint and dedicated KV Q8 checkpoint for
three persistent 1024x1024 four-step requests, validates every PNG and
telemetry file, records model/output/patch hashes and peak VRAM, and discards
the warm request from each profile. The candidate runs first, giving the
standard baseline any GPU-ordering advantage. The script fails unless the
standard checkpoint still reproduces its previously recorded output hashes and
the KV checkpoint has lower steady-state image-edit latency on the identical
GPU. It also reports the combined generate-plus-edit pair separately so serving
tradeoffs remain clear.

Until that evaluator finishes, CPDif claims only that the native integration
compiles and passes local regression tests. It does not claim a new measured
speedup or completed GPU visual validation.

## Licensing

The model weights remain covered by the FLUX Non-Commercial License and are not
distributed by CPDif. The downloader obtains the Q8 file from its publisher;
users remain responsible for reviewing and following the model license and
acceptable-use requirements.
