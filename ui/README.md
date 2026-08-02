# CPDif Node UI

This is a dependency-free Node 20+ UI for native `cpdif generate`, `edit`, and
`generate-edit` workflows. It runs one GPU workflow at a time, uses the
dedicated Klein 9B-KV Q8 checkpoint, verifies KV-cache telemetry for every Edit
stage, and shows each stage output, timing, and native process log.

The UI does not proxy model weights to a browser and does not invoke a shell.
Prompts are passed as individual child-process arguments.

## Browser surface

The frontend uses a light visual node canvas inspired by the supplied design
reference. Add up to eight FLUX.2 Klein nodes and connect any node to an earlier
Klein output. Mode is inferred from the image input: a node with no image
connection is Generate; a node with an image connection is Edit. Disconnecting
the image immediately returns that node to Generate. Nodes can be dragged and
resized, the canvas can be zoomed or reset, and the output panel switches among
all completed stage PNGs while retaining native telemetry, logs, and
cancellation.

The server validates the same rule independently, rejects forward references
and cycles, and derives the native command instead of trusting a browser mode
flag. An adjacent Generate → Edit pair with matching dimensions is fused into
one native `generate-edit` command so the model context is loaded once. Other
roots run as `generate`; connected stages run as `edit --reference-image`.

The FLUX node also includes a LoRA asset downloader with adjacent Name and HTTPS
URL fields. Downloads are streamed into `CPDIF_LORA_DIR` (default:
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
CPDIF_LORA_DIR=/path/to/loras \
CPDIF_UI_MAX_LORA_BYTES=4294967296 \
CPDIF_UI_PORT=4173 \
npm start
```

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
