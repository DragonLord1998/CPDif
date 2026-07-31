#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_REPO_DIR="${CPDIF_REPO_DIR:-$(cd -- "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)}"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
export CPDIF_REPO_DIR CPDIF_WORKDIR

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi is required for the A100 Colab workflow." >&2
  exit 1
fi

mapfile -t gpu_rows < <(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits)
if [[ "${#gpu_rows[@]}" -ne 1 ]]; then
  echo "Expected exactly one GPU, found ${#gpu_rows[@]}." >&2
  exit 1
fi

IFS=',' read -r gpu_name gpu_memory <<<"${gpu_rows[0]}"
gpu_name="${gpu_name# }"
gpu_memory="${gpu_memory// /}"
echo "GPU: ${gpu_name}, ${gpu_memory} MiB"

if [[ "${CPDIF_ALLOW_NON_A100_40GB:-0}" != "1" ]]; then
  if [[ "${gpu_name}" != *A100* ]] || (( gpu_memory < 39000 || gpu_memory > 42000 )); then
    echo "Expected one NVIDIA A100 40GB runtime; refusing ${gpu_name} (${gpu_memory} MiB)." >&2
    exit 1
  fi
fi

"${SCRIPT_DIR}/00_install_build_deps.sh"
"${SCRIPT_DIR}/01_prepare_upstream.sh"
"${SCRIPT_DIR}/02_build_cuda.sh"
"${CPDIF_REPO_DIR}/scripts/model/download_model.sh"
"${SCRIPT_DIR}/03_smoke_prompt.sh"
