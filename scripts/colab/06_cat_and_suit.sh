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
CAT_PROMPT="${CAT_PROMPT:-A highly detailed realistic studio photograph of one orange tabby cat sitting upright and facing the camera, full body visible, expressive green eyes, natural anatomy, crisp individual fur, soft neutral gray background, softbox lighting, centered composition}"
SUIT_PROMPT="${SUIT_PROMPT:-Keep exactly the same orange tabby cat, face, green eyes, fur pattern, body proportions, pose, camera angle, lighting, and gray studio background. Dress the cat in a perfectly fitted elegant black business suit with white dress shirt and small black tie. Preserve the identity of the cat and all uncovered fur.}"

for required in "${CPDIF_BIN}" "${TRANSFORMER_PATH}" "${TEXT_ENCODER_PATH}" "${VAE_PATH}"; do
  if [[ ! -s "${required}" ]]; then
    echo "Missing required executable/model asset: ${required}" >&2
    exit 1
  fi
done

mkdir -p "${OUTPUT_DIR}"

common_args=(
  --transformer "${TRANSFORMER_PATH}"
  --text-encoder "${TEXT_ENCODER_PATH}"
  --vae "${VAE_PATH}"
  --steps "${STEPS}"
  --width "${WIDTH}"
  --height "${HEIGHT}"
  --cfg-scale 1.0
  --rng cpu
  --max-vram "${CPDIF_MAX_VRAM}"
  --stream-layers
)

"${CPDIF_BIN}" generate \
  "${common_args[@]}" \
  --prompt "${CAT_PROMPT}" \
  --seed "${SEED}" \
  --output "${CAT_IMAGE}" \
  --telemetry "${CAT_TELEMETRY}"

python3 "${SCRIPT_DIR}/validate_smoke.py" \
  "${CAT_IMAGE}" "${CAT_TELEMETRY}" "${WIDTH}" "${HEIGHT}" text-to-image

"${CPDIF_BIN}" edit \
  "${common_args[@]}" \
  --reference-image "${CAT_IMAGE}" \
  --qwen-image-layers 3 \
  --prompt "${SUIT_PROMPT}" \
  --seed "$((SEED + 1))" \
  --output "${SUIT_IMAGE}" \
  --telemetry "${SUIT_TELEMETRY}"

python3 "${SCRIPT_DIR}/validate_smoke.py" \
  "${SUIT_IMAGE}" "${SUIT_TELEMETRY}" "${WIDTH}" "${HEIGHT}" image-edit

sha256sum "${CAT_IMAGE}" "${SUIT_IMAGE}" | tee "${OUTPUT_DIR}/sha256.txt"
echo "CAT_IMAGE=${CAT_IMAGE}"
echo "SUIT_IMAGE=${SUIT_IMAGE}"
