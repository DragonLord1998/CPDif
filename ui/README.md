# CPDif Node UI

This is a dependency-free Node 20+ UI for the native `cpdif generate-edit`
command. It runs one GPU job at a time, uses the dedicated Klein 9B-KV Q8
checkpoint, verifies KV-cache telemetry, and shows the generated source image,
edited image, timings, and native process log.

The UI does not proxy model weights to a browser and does not invoke a shell.
Prompts are passed as individual child-process arguments.

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

The initial UI intentionally wraps one `generate-edit` process per submitted
job. The server serializes jobs to avoid overlapping model allocations. A
future native serving mode can preserve the already-loaded model across jobs
without changing this browser/API contract.
