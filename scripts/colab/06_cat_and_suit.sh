#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
CPDIF_BUILD_DIR="${CPDIF_BUILD_DIR:-${CPDIF_WORKDIR}/build-a100}"
CPDIF_BIN="${CPDIF_BIN:-${CPDIF_BUILD_DIR}/bin/cpdif}"
MODEL_DIR="${MODEL_DIR:-${CPDIF_WORKDIR}/models}"
OUTPUT_DIR="${OUTPUT_DIR:-${CPDIF_WORKDIR}/outputs/cat-suit}"

TRANSFORMER_PATH="${TRANSFORMER_PATH:-${MODEL_DIR}/flux-2-klein-9b.safetensors}"
TEXT_ENCODER_PATH="${TEXT_ENCODER_PATH:-${MODEL_DIR}/qwen_3_8b.safetensors}"
VAE_PATH="${VAE_PATH:-${MODEL_DIR}/flux2-vae.safetensors}"

CAT_IMAGE="${CAT_IMAGE:-${OUTPUT_DIR}/cat.png}"
CAT_TELEMETRY="${CAT_TELEMETRY:-${OUTPUT_DIR}/cat.json}"
SUIT_IMAGE="${SUIT_IMAGE:-${OUTPUT_DIR}/cat-in-suit.png}"
SUIT_TELEMETRY="${SUIT_TELEMETRY:-${OUTPUT_DIR}/cat-in-suit.json}"

WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-1024}"
STEPS="${STEPS:-4}"
SEED="${SEED:-20260731}"
CPDIF_MAX_VRAM="${CPDIF_MAX_VRAM:-36}"
CPDIF_RESIDENCY="${CPDIF_RESIDENCY:-auto}"
CPDIF_GPU_RESERVE_MIB="${CPDIF_GPU_RESERVE_MIB:-8192}"
CAT_PROMPT="${CAT_PROMPT:-A highly detailed realistic studio photograph of one orange tabby cat sitting upright and facing the camera, full body visible, expressive green eyes, natural anatomy, crisp individual fur, soft neutral gray background, softbox lighting, centered composition}"
SUIT_PROMPT="${SUIT_PROMPT:-Keep exactly the same orange tabby cat, face, green eyes, fur pattern, body proportions, pose, camera angle, lighting, and gray studio background. Dress the cat in a perfectly fitted elegant black business suit with white dress shirt and small black tie. Preserve the identity of the cat and all uncovered fur.}"

for required in "${CPDIF_BIN}" "${TRANSFORMER_PATH}" "${TEXT_ENCODER_PATH}" "${VAE_PATH}"; do
  if [[ ! -s "${required}" ]]; then
    echo "Missing required executable/model asset: ${required}" >&2
    exit 1
  fi
done

mkdir -p "${OUTPUT_DIR}"

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

common_args=(
  --transformer "${TRANSFORMER_PATH}"
  --text-encoder "${TEXT_ENCODER_PATH}"
  --vae "${VAE_PATH}"
  --steps "${STEPS}"
  --width "${WIDTH}"
  --height "${HEIGHT}"
  --cfg-scale 1.0
  --rng cpu
  --qwen-image-layers 3
  "${residency_args[@]}"
)

"${CPDIF_BIN}" generate-edit \
  "${common_args[@]}" \
  --prompt "${CAT_PROMPT}" \
  --seed "${SEED}" \
  --output "${CAT_IMAGE}" \
  --telemetry "${CAT_TELEMETRY}" \
  --edit-prompt "${SUIT_PROMPT}" \
  --edit-seed "$((SEED + 1))" \
  --edited-output "${SUIT_IMAGE}" \
  --edited-telemetry "${SUIT_TELEMETRY}"

python3 "${SCRIPT_DIR}/validate_smoke.py" \
  "${CAT_IMAGE}" "${CAT_TELEMETRY}" "${WIDTH}" "${HEIGHT}" text-to-image

python3 "${SCRIPT_DIR}/validate_smoke.py" \
  "${SUIT_IMAGE}" "${SUIT_TELEMETRY}" "${WIDTH}" "${HEIGHT}" image-edit

sha256sum "${CAT_IMAGE}" "${SUIT_IMAGE}" | tee "${OUTPUT_DIR}/sha256.txt"
echo "CAT_IMAGE=${CAT_IMAGE}"
echo "SUIT_IMAGE=${SUIT_IMAGE}"
echo "CPDIF_RESIDENCY=${selected_residency}"
