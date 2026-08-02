# CPDif Node UI

This is a dependency-free Node 20+ UI for native `cpdif generate`, `edit`, and
`generate-edit` workflows, with optional NVIDIA PiD 4× output upscaling. It runs one GPU task at a time, uses the
dedicated Klein 9B-KV Q8 checkpoint, verifies KV-cache telemetry for every Edit
stage, and shows each stage output, timing, and native process log.

The UI does not proxy model weights to a browser and does not invoke a shell.
Prompts are passed as individual child-process arguments.

## Browser surface

The frontend uses a light visual node canvas inspired by the supplied design
reference. Add up to sixteen uploaded Image nodes, eight FLUX.2 Klein nodes,
and eight independent Output nodes. Each Klein node accepts up to four ordered
references from uploaded images or completed earlier Klein
output. PNG and JPEG uploads are streamed into the runtime, validated by type,
signature, dimensions, and a 32 MiB default limit, and never accept client
filesystem paths. Mode is inferred from image inputs: a node with no image
connections is Generate; a node with one to four connections is Edit. The input
area shows numbered thumbnails so prompts can refer to Image 1 through Image 4.
Disconnecting all images immediately returns that node to Generate. Nodes can be dragged and
resized, the canvas can be zoomed or reset, and the output panel switches among
all completed stage PNGs while retaining native telemetry, logs, and
cancellation. Generate/Edit buttons execute only their own Klein node and reuse
already-completed source images without automatically running upstream nodes.

Each Output node can connect to any Klein node. Its optional **4× NVIDIA PiD**
action runs NVIDIA's official FLUX.2 `from_clean` pixel-diffusion decoder,
preserves the original PNG, and caches the upscaled PNG beside the source job.
The 512px path uses PiD's 2K checkpoint; 768px and 1024px inputs use the v1.5
2K-to-4K checkpoint. PiD remains optional, is prepared in the background by the
Colab launcher, and is serialized with Klein and Qwen GPU work.

The server validates the same rule independently, rejects forward references
and cycles, and derives the native command instead of trusting a browser mode
flag. An adjacent Generate → Edit pair with matching dimensions is fused into
one native `generate-edit` command so the model context is loaded once. Other
roots run as `generate`; connected stages run as `edit --reference-image`.

Each Klein node also has an optional **Improve** action backed by a local Ollama
vision model. Generate prompts are rewritten from text. Edit prompts send the
connected uploaded image immediately, or the completed connected stage image
after a workflow finishes, so the rewrite can name visible subjects and
preservation constraints. The original prompt is retained behind **Undo**.
Prompt assistance is explicit, never runs during a native workflow, and never
blocks Generate or Edit when Ollama is unavailable.

The system prompt summarizes Black Forest Labs' official
[FLUX.2 prompting guide](https://docs.bfl.ai/guides/prompting_guide_flux2) and
[single-reference editing guide](https://docs.bfl.ai/guides/prompting_editing_single_reference):
important concepts come first, prompts describe what should appear instead of
negative clauses, and edit instructions state both the change and what must
stay fixed. The configured default is the community
[`lukey03/Qwen3.5-9B-abliterated`](https://huggingface.co/lukey03/Qwen3.5-9B-abliterated)
Ollama vision variant requested for this project. Abliteration removes refusal
behavior; it is not a vision-quality enhancement, so the model remains
configurable and the official `Qwen/Qwen3.5-9B` can be substituted.

The canvas includes a standalone LoRA asset node below the Klein chain with
adjacent Name and HTTPS URL fields. Downloads are streamed into `CPDIF_LORA_DIR` (default:
`$CPDIF_WORKDIR/loras`), validated as safetensors, limited to 4 GiB by default,
and listed in the UI. Private-network destinations and unsafe redirects are
rejected. The current native `cpdif` CLI does not expose LoRA application, so
the UI labels these files as stored assets and does not add them to inference.

The design system is dependency-free and lives in `public/styles.css`: color,
spacing, typography, radius, shadow, focus, motion, and responsive tokens are
plain CSS custom properties and component rules.

## Start on A100 or RTX PRO 6000

After restoring/building CPDif and downloading the three model components:

```bash
cd /content/cpdif-work/repo/ui
CPDIF_WORKDIR=/content/cpdif-work \
CPDIF_UI_HOST=0.0.0.0 \
npm start
```

Open `http://<gpu-host>:4173`. The server auto-detects the standard A100 and
`sm120` build directories. On A100 it also applies the validated 8 GiB graph
budget automatically.

The server intentionally has no account system. Keep the default loopback bind
for local use, or expose `0.0.0.0` only through a trusted Colab port proxy or
private tunnel.

Override paths when the runtime layout differs:

```bash
CPDIF_BIN=/path/to/cpdif \
CPDIF_TRANSFORMER=/path/to/flux-2-klein-9b-kv-Q8_0.gguf \
CPDIF_TEXT_ENCODER=/path/to/qwen_3_8b.safetensors \
CPDIF_VAE=/path/to/flux2-vae.safetensors \
CPDIF_UI_DATA_DIR=/path/to/job-output \
CPDIF_UI_IMAGE_DIR=/path/to/reference-images \
CPDIF_UI_MAX_IMAGE_BYTES=33554432 \
CPDIF_LORA_DIR=/path/to/loras \
CPDIF_UI_MAX_LORA_BYTES=4294967296 \
CPDIF_PROMPT_ASSISTANT_ENABLED=1 \
CPDIF_PROMPT_ASSISTANT_URL=http://127.0.0.1:11434 \
CPDIF_PROMPT_ASSISTANT_MODEL=lukey03/qwen3.5-9b-abliterated-vision \
CPDIF_PID_ROOT=/path/to/NVIDIA-PiD \
CPDIF_PID_PYTHON=python3 \
CPDIF_UI_PORT=4173 \
npm start
```

For a local Ollama installation, start `ollama serve` and pull the configured
model once:

```bash
ollama pull lukey03/qwen3.5-9b-abliterated-vision
```

Only loopback HTTP origins are accepted. Requests set `keep_alive: 0`, which
unloads Qwen immediately after the rewrite and frees GPU memory before CPDif
starts. The Colab launcher installs and downloads the assistant in the
background; the Qwen badge turns green when it is ready. The first uncached
Colab launch downloads roughly 6.1 GB for the vision quantization.

The Colab launcher also clones a pinned Apache-2.0 NVIDIA PiD revision and uses
Xet-accelerated `hf download` for only the FLUX.2 VAE plus the two required
distilled PiD checkpoints. It accepts either `HF_TOKEN` or the user's existing
`HF_Token` Colab secret and enables Output-node buttons only after setup is complete.

Set `CPDIF_UI_MAX_VRAM=8` explicitly for an A100 when `nvidia-smi` is not
available during Node startup. Set it to an empty value on RTX PRO 6000.

## Validate

No package installation is required:

```bash
npm test
```

The server serializes workflows to avoid overlapping model allocations. A
future native serving mode can preserve the already-loaded model across jobs
without changing this browser/API contract.
