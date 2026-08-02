#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_REPO_DIR="${CPDIF_REPO_DIR:-$(cd -- "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)}"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
SDC_DIR="${SDC_DIR:-${CPDIF_WORKDIR}/upstream/stable-diffusion.cpp}"
CPDIF_BUILD_TYPE="${CPDIF_BUILD_TYPE:-Release}"
CPDIF_BUILD_JOBS="${CPDIF_BUILD_JOBS:-$(nproc)}"
CPDIF_CCACHE_DIR="${CPDIF_CCACHE_DIR:-${CPDIF_WORKDIR}/ccache}"
CPDIF_CCACHE_MAX_SIZE="${CPDIF_CCACHE_MAX_SIZE:-20G}"
CPDIF_CUDA_ARCHITECTURES="${CPDIF_CUDA_ARCHITECTURES:-}"

if [[ -z "${CPDIF_CUDA_ARCHITECTURES}" ]]; then
  compute_capability="$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader,nounits | head -n1 | tr -d '[:space:].')"
  if [[ ! "${compute_capability}" =~ ^[0-9]+$ ]]; then
    echo "Unable to detect a CUDA compute capability." >&2
    exit 1
  fi
  CPDIF_CUDA_ARCHITECTURES="${compute_capability}"
fi

if [[ -z "${CPDIF_BUILD_DIR:-}" ]]; then
  if [[ "${CPDIF_CUDA_ARCHITECTURES}" == "80" ]]; then
    CPDIF_BUILD_DIR="${CPDIF_WORKDIR}/build-a100"
  else
    CPDIF_BUILD_DIR="${CPDIF_WORKDIR}/build-sm${CPDIF_CUDA_ARCHITECTURES}"
  fi
fi

if [[ ! -f "${CPDIF_REPO_DIR}/CMakeLists.txt" ]]; then
  echo "Missing CPDif source at ${CPDIF_REPO_DIR}" >&2
  exit 1
fi
if [[ ! -f "${SDC_DIR}/CMakeLists.txt" ]]; then
  echo "Missing stable-diffusion.cpp checkout at ${SDC_DIR}" >&2
  echo "Run scripts/colab/01_prepare_upstream.sh first." >&2
  exit 1
fi

mkdir -p "${CPDIF_CCACHE_DIR}"
export CCACHE_DIR="${CPDIF_CCACHE_DIR}"
export CCACHE_BASEDIR="/content"
export CCACHE_COMPRESS=1
ccache --max-size "${CPDIF_CCACHE_MAX_SIZE}"

cmake -S "${CPDIF_REPO_DIR}" -B "${CPDIF_BUILD_DIR}" -G Ninja \
  -DCMAKE_BUILD_TYPE="${CPDIF_BUILD_TYPE}" \
  -DCPDIF_BUILD_TESTS=ON \
  -DCPDIF_ENABLE_CUDA=ON \
  -DCPDIF_OFFLINE=OFF \
  -DCPDIF_CUDA_ARCHITECTURES="${CPDIF_CUDA_ARCHITECTURES}" \
  -DCPDIF_SDCXX_SOURCE_DIR="${SDC_DIR}" \
  -DCMAKE_C_COMPILER_LAUNCHER=ccache \
  -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
  -DCMAKE_CUDA_COMPILER_LAUNCHER=ccache

cmake --build "${CPDIF_BUILD_DIR}" --config "${CPDIF_BUILD_TYPE}" --parallel "${CPDIF_BUILD_JOBS}"
ctest --test-dir "${CPDIF_BUILD_DIR}" --output-on-failure

CPDIF_BIN="${CPDIF_BUILD_DIR}/bin/cpdif"
if [[ ! -x "${CPDIF_BIN}" ]]; then
  echo "Build completed but cpdif was not found at ${CPDIF_BIN}" >&2
  exit 1
fi

"${CPDIF_BIN}" backend
ccache --show-stats
echo "Built ${CPDIF_BIN}"
echo "CUDA architecture: sm${CPDIF_CUDA_ARCHITECTURES}"
