#!/usr/bin/env bash
set -euo pipefail

PID_REPO_URL="${PID_REPO_URL:-https://github.com/nv-tlabs/PiD.git}"
PID_REVISION="${PID_REVISION:-2c8814c2b91cc41a2be7809962c891e0d0ccff5f}"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
PID_ROOT="${CPDIF_PID_ROOT:-${CPDIF_WORKDIR}/PiD}"
READY_MARKER="${PID_ROOT}/.cpdif-pid-ready"

if [[ -f "${READY_MARKER}" ]] && [[ "$(cat "${READY_MARKER}")" == "${PID_REVISION}" ]]; then
  echo "NVIDIA PiD 4x runtime is already ready."
  exit 0
fi

if [[ ! -d "${PID_ROOT}/.git" ]]; then
  git clone --filter=blob:none --no-checkout "${PID_REPO_URL}" "${PID_ROOT}"
fi
git -C "${PID_ROOT}" fetch --depth 1 origin "${PID_REVISION}"
git -C "${PID_ROOT}" checkout --detach --force FETCH_HEAD

actual_revision="$(git -C "${PID_ROOT}" rev-parse HEAD)"
if [[ "${actual_revision}" != "${PID_REVISION}" ]]; then
  echo "NVIDIA PiD revision mismatch: ${actual_revision}" >&2
  exit 1
fi

# Keep Colab's CUDA-enabled torch build. PiD's official quick-start supports an
# existing torch install when the inference stack and eager utility imports are present.
python3 -m pip install --quiet --upgrade \
  'diffusers==0.37.1' \
  'transformers==4.57.1' \
  'accelerate>=1.1,<2' \
  'hydra-core==1.3.2' \
  'omegaconf==2.3.0' \
  'PyYAML>=6.0.2,<7' \
  'attrs>=25.3,<26' \
  'einops>=0.8.1,<0.9' \
  'loguru>=0.7.3,<0.8' \
  'termcolor>=3.1,<4' \
  'fvcore==0.1.5.post20221221' \
  'iopath==0.1.10' \
  'wandb>=0.20.1,<0.21' \
  'imageio>=2.37,<3' \
  'opencv-python-headless==4.11.0.86' \
  'Pillow>=11.1,<12' \
  'pandas>=2.2.3,<2.3' \
  'safetensors>=0.5.3,<1' \
  'sentencepiece>=0.2,<0.3' \
  'boto3>=1.38.31,<1.39' \
  'botocore>=1.38.42,<1.39'
python3 -m pip install --quiet --no-deps -e "${PID_ROOT}"

export HF_XET_HIGH_PERFORMANCE="${HF_XET_HIGH_PERFORMANCE:-1}"
export HF_HUB_DOWNLOAD_TIMEOUT="${HF_HUB_DOWNLOAD_TIMEOUT:-1800}"
hf download nvidia/PiD --local-dir "${PID_ROOT}" --include \
  'checkpoints/flux2_ae.safetensors' \
  'checkpoints/PiD_res2k_sr4x_official_flux2_distill_4step/*' \
  'checkpoints/PiD_v1pt5_res2kto4k_sr4x_official_flux2_distill_4step/*'

test -s "${PID_ROOT}/checkpoints/flux2_ae.safetensors"
test -s "${PID_ROOT}/checkpoints/PiD_res2k_sr4x_official_flux2_distill_4step/model_ema_bf16.pth"
test -s "${PID_ROOT}/checkpoints/PiD_v1pt5_res2kto4k_sr4x_official_flux2_distill_4step/model_ema_bf16.pth"
printf '%s\n' "${PID_REVISION}" > "${READY_MARKER}"
echo "NVIDIA PiD 4x runtime is ready at ${PID_ROOT}."
