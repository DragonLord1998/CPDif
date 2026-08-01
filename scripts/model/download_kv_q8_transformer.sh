#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
MODEL_DIR="${MODEL_DIR:-${CPDIF_WORKDIR}/models}"

export MODEL_COMPONENTS=transformer
export TRANSFORMER_REPO="QuantStack/FLUX.2-Klein-9B-KV-GGUF"
export TRANSFORMER_REMOTE_FILE="Flux-2-Klein-9B-KV-Q8_0.gguf"
export TRANSFORMER_PATH="${TRANSFORMER_PATH:-${MODEL_DIR}/flux-2-klein-9b-kv-Q8_0.gguf}"
export TRANSFORMER_SHA256="94d7a02ac18b50b2c751c6e2ee82c53a338ab233338700330a7797b6c959e397"

exec bash "${SCRIPT_DIR}/download_model.sh"
