#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
MODEL_DIR="${MODEL_DIR:-${CPDIF_WORKDIR}/models}"

export MODEL_COMPONENTS=transformer
export TRANSFORMER_REPO="leejet/FLUX.2-klein-9B-GGUF"
export TRANSFORMER_REMOTE_FILE="flux-2-klein-9b-Q8_0.gguf"
export TRANSFORMER_PATH="${TRANSFORMER_PATH:-${MODEL_DIR}/flux-2-klein-9b-Q8_0.gguf}"
export TRANSFORMER_SHA256="67ca777c7aa2d6a0d63d4a7564f823c63af88e9688643df727e1867789062982"

exec bash "${SCRIPT_DIR}/download_model.sh"
