#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_REPO_DIR="${CPDIF_REPO_DIR:-$(cd -- "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)}"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"

gpu_name="$(nvidia-smi --query-gpu=name --format=csv,noheader | head -n 1)"
compute_capability="$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader,nounits | head -n 1 | tr -d '.[:space:]')"
case "${gpu_name}" in
  *A100*) gpu_key="a100_40gb" ;;
  *RTX*PRO*6000*) gpu_key="rtx_pro_6000" ;;
  *)
    echo "Unsupported validation GPU: ${gpu_name}" >&2
    exit 1
    ;;
esac

export CPDIF_REPO_DIR CPDIF_WORKDIR
export CPDIF_CUDA_ARCHITECTURES="${CPDIF_CUDA_ARCHITECTURES:-${compute_capability}}"
export CPDIF_BUILD_DIR="${CPDIF_BUILD_DIR:-${CPDIF_WORKDIR}/build-sm${CPDIF_CUDA_ARCHITECTURES}}"

echo "GPU=${gpu_name}"
echo "GPU_KEY=${gpu_key}"
echo "CUDA_ARCHITECTURE=sm${CPDIF_CUDA_ARCHITECTURES}"

"${SCRIPT_DIR}/00_install_build_deps.sh"
"${SCRIPT_DIR}/01_prepare_upstream.sh"
"${SCRIPT_DIR}/02_build_cuda.sh"

MODEL_COMPONENTS=text_encoder,vae \
  bash "${CPDIF_REPO_DIR}/scripts/model/download_model.sh"
bash "${CPDIF_REPO_DIR}/scripts/model/download_q8_transformer.sh"

ctest --test-dir "${CPDIF_BUILD_DIR}" --output-on-failure
python3 -m unittest discover -s "${CPDIF_REPO_DIR}/tests" -p 'test_*.py'

python3 "${SCRIPT_DIR}/sglang_diffusion_benchmark.py" \
  --gpu-key "${gpu_key}" \
  --binary "${CPDIF_BUILD_DIR}/bin/cpdif" \
  --transformer "${CPDIF_WORKDIR}/models/flux-2-klein-9b-Q8_0.gguf" \
  --text-encoder "${CPDIF_WORKDIR}/models/qwen_3_8b.safetensors" \
  --vae "${CPDIF_WORKDIR}/models/flux2-vae.safetensors" \
  --baseline "${CPDIF_REPO_DIR}/docs/benchmarks/2026-07-31-colab-gpus.json" \
  --output-dir "${CPDIF_WORKDIR}/outputs/sglang-diffusion/${gpu_key}" \
  --samples "${CPDIF_BENCHMARK_SAMPLES:-3}"

echo "RESULT=${CPDIF_WORKDIR}/outputs/sglang-diffusion/${gpu_key}/gpu-result.json"
