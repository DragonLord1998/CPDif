#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_REPO_DIR="${CPDIF_REPO_DIR:-$(cd -- "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)}"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi is required for GPU validation." >&2
  exit 1
fi

mapfile -t gpu_rows < <(nvidia-smi --query-gpu=name,memory.total,compute_cap --format=csv,noheader,nounits)
if [[ "${#gpu_rows[@]}" -ne 1 ]]; then
  echo "Expected exactly one GPU, found ${#gpu_rows[@]}." >&2
  exit 1
fi

IFS=',' read -r gpu_name gpu_memory compute_capability <<<"${gpu_rows[0]}"
gpu_name="${gpu_name# }"
gpu_memory="${gpu_memory// /}"
compute_capability="${compute_capability//[[:space:].]/}"
if [[ ! "${compute_capability}" =~ ^[0-9]+$ ]]; then
  echo "Unable to parse GPU compute capability." >&2
  exit 1
fi

export CPDIF_REPO_DIR CPDIF_WORKDIR
export CPDIF_CUDA_ARCHITECTURES="${CPDIF_CUDA_ARCHITECTURES:-${compute_capability}}"
export CPDIF_BUILD_DIR="${CPDIF_BUILD_DIR:-${CPDIF_WORKDIR}/build-sm${CPDIF_CUDA_ARCHITECTURES}}"

echo "GPU=${gpu_name}"
echo "GPU_MEMORY_MIB=${gpu_memory}"
echo "CUDA_ARCHITECTURE=sm${CPDIF_CUDA_ARCHITECTURES}"

"${SCRIPT_DIR}/00_install_build_deps.sh"
"${SCRIPT_DIR}/01_prepare_upstream.sh"
"${SCRIPT_DIR}/02_build_cuda.sh"

MODEL_COMPONENTS=text_encoder,vae \
  bash "${CPDIF_REPO_DIR}/scripts/model/download_model.sh"
bash "${CPDIF_REPO_DIR}/scripts/model/download_q8_transformer.sh"

TRANSFORMER_PATH="${CPDIF_WORKDIR}/models/flux-2-klein-9b-Q8_0.gguf" \
  bash "${SCRIPT_DIR}/06_cat_and_suit.sh"
