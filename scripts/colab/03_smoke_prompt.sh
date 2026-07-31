#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
CPDIF_BUILD_DIR="${CPDIF_BUILD_DIR:-${CPDIF_WORKDIR}/build-a100}"
CPDIF_BIN="${CPDIF_BIN:-${CPDIF_BUILD_DIR}/bin/cpdif}"
MODEL_DIR="${MODEL_DIR:-${CPDIF_WORKDIR}/models}"
TRANSFORMER_PATH="${TRANSFORMER_PATH:-${MODEL_DIR}/flux-2-klein-9b.safetensors}"
TEXT_ENCODER_PATH="${TEXT_ENCODER_PATH:-${MODEL_DIR}/qwen_3_8b.safetensors}"
VAE_PATH="${VAE_PATH:-${MODEL_DIR}/flux2-vae.safetensors}"
SMOKE_OUT_DIR="${SMOKE_OUT_DIR:-${CPDIF_WORKDIR}/outputs}"
SMOKE_OUTPUT="${SMOKE_OUTPUT:-${SMOKE_OUT_DIR}/cpdif-klein-9b-a100.png}"
SMOKE_TELEMETRY="${SMOKE_TELEMETRY:-${SMOKE_OUT_DIR}/cpdif-klein-9b-a100.json}"
SMOKE_PROMPT="${SMOKE_PROMPT:-a small red cube on a plain white background, studio lighting}"
SMOKE_SEED="${SMOKE_SEED:-12345}"
SMOKE_STEPS="${SMOKE_STEPS:-4}"
SMOKE_WIDTH="${SMOKE_WIDTH:-1024}"
SMOKE_HEIGHT="${SMOKE_HEIGHT:-1024}"
SMOKE_CFG_SCALE="${SMOKE_CFG_SCALE:-1.0}"
CPDIF_MAX_VRAM="${CPDIF_MAX_VRAM:-36}"
CPDIF_RESIDENCY="${CPDIF_RESIDENCY:-auto}"
CPDIF_GPU_RESERVE_MIB="${CPDIF_GPU_RESERVE_MIB:-8192}"

for required in "${CPDIF_BIN}" "${TRANSFORMER_PATH}" "${TEXT_ENCODER_PATH}" "${VAE_PATH}"; do
  if [[ ! -s "${required}" ]]; then
    echo "Missing required executable/model asset: ${required}" >&2
    exit 1
  fi
done

mkdir -p "${SMOKE_OUT_DIR}"

selected_residency="$(python3 "${SCRIPT_DIR}/runtime_profile.py" \
  --residency "${CPDIF_RESIDENCY}" \
  --reserve-mib "${CPDIF_GPU_RESERVE_MIB}" \
  "${TRANSFORMER_PATH}" "${TEXT_ENCODER_PATH}" "${VAE_PATH}")"

residency_args=()
case "${selected_residency}" in
  gpu)
    residency_args+=(--no-offload-to-cpu)
    ;;
  stream)
    residency_args+=(--offload-to-cpu --max-vram "${CPDIF_MAX_VRAM}" --stream-layers)
    ;;
  *)
    echo "Unexpected residency profile: ${selected_residency}" >&2
    exit 1
    ;;
esac

"${CPDIF_BIN}" generate \
  --transformer "${TRANSFORMER_PATH}" \
  --text-encoder "${TEXT_ENCODER_PATH}" \
  --vae "${VAE_PATH}" \
  --prompt "${SMOKE_PROMPT}" \
  --seed "${SMOKE_SEED}" \
  --steps "${SMOKE_STEPS}" \
  --width "${SMOKE_WIDTH}" \
  --height "${SMOKE_HEIGHT}" \
  --cfg-scale "${SMOKE_CFG_SCALE}" \
  --rng cpu \
  "${residency_args[@]}" \
  --output "${SMOKE_OUTPUT}" \
  --telemetry "${SMOKE_TELEMETRY}"

python3 "${SCRIPT_DIR}/validate_smoke.py" \
  "${SMOKE_OUTPUT}" "${SMOKE_TELEMETRY}" "${SMOKE_WIDTH}" "${SMOKE_HEIGHT}"

sha256sum "${SMOKE_OUTPUT}" | tee "${SMOKE_OUTPUT}.sha256"
echo "Smoke image: ${SMOKE_OUTPUT}"
echo "Telemetry: ${SMOKE_TELEMETRY}"
echo "CPDIF_RESIDENCY=${selected_residency}"
