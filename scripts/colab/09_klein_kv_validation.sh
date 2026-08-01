#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_REPO_DIR="${CPDIF_REPO_DIR:-$(cd -- "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)}"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"

bash "${SCRIPT_DIR}/00_install_build_deps.sh"
bash "${SCRIPT_DIR}/01_prepare_upstream.sh"
# A missing or incompatible release cache is expected on the first build. The
# normal build remains authoritative and becomes incremental after a restore.
bash "${SCRIPT_DIR}/10_restore_release_cache.sh" || true
bash "${SCRIPT_DIR}/02_build_cuda.sh"
python3 -m unittest discover -s "${CPDIF_REPO_DIR}/tests" -p 'test_*.py'
MODEL_COMPONENTS=text_encoder,vae bash "${CPDIF_REPO_DIR}/scripts/model/download_model.sh"
bash "${CPDIF_REPO_DIR}/scripts/model/download_q8_transformer.sh"
bash "${CPDIF_REPO_DIR}/scripts/model/download_kv_q8_transformer.sh"

gpu_name="$(nvidia-smi --query-gpu=name --format=csv,noheader | head -n1)"
if [[ "${gpu_name}" == *"A100"* ]]; then
  gpu_key="a100_40gb"
elif [[ "${gpu_name}" == *"RTX PRO 6000"* ]]; then
  gpu_key="rtx_pro_6000"
else
  echo "Unsupported validation GPU: ${gpu_name}" >&2
  exit 2
fi

if [[ -z "${CPDIF_BUILD_DIR:-}" ]]; then
  compute_capability="$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader,nounits | head -n1 | tr -d '[:space:].')"
  if [[ "${compute_capability}" == "80" ]]; then
    CPDIF_BUILD_DIR="${CPDIF_WORKDIR}/build-a100"
  else
    CPDIF_BUILD_DIR="${CPDIF_WORKDIR}/build-sm${compute_capability}"
  fi
fi

python3 "${SCRIPT_DIR}/klein_kv_benchmark.py" \
  --gpu-key "${gpu_key}" \
  --binary "${CPDIF_BUILD_DIR}/bin/cpdif" \
  --standard-transformer "${CPDIF_WORKDIR}/models/flux-2-klein-9b-Q8_0.gguf" \
  --transformer "${CPDIF_WORKDIR}/models/flux-2-klein-9b-kv-Q8_0.gguf" \
  --text-encoder "${CPDIF_WORKDIR}/models/qwen_3_8b.safetensors" \
  --vae "${CPDIF_WORKDIR}/models/flux2-vae.safetensors" \
  --patch "${CPDIF_REPO_DIR}/patches/stable-diffusion-klein-kv-cache.patch" \
  --baseline "${CPDIF_REPO_DIR}/docs/benchmarks/2026-08-01-sglang-diffusion.json" \
  --output-dir "${CPDIF_WORKDIR}/outputs/klein-kv/${gpu_key}"

echo "RESULT=${CPDIF_WORKDIR}/outputs/klein-kv/${gpu_key}/gpu-result.json"
