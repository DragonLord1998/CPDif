#!/usr/bin/env bash
set -euo pipefail

SDC_REPO_URL="${SDC_REPO_URL:-https://github.com/leejet/stable-diffusion.cpp.git}"
SDC_REVISION="${SDC_REVISION:-e31a86ce9110b11a98bd5990c329093244c2d1e3}"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
SDC_DIR="${SDC_DIR:-${CPDIF_WORKDIR}/upstream/stable-diffusion.cpp}"

mkdir -p "$(dirname "${SDC_DIR}")"

if [[ ! -d "${SDC_DIR}/.git" ]]; then
  git clone --filter=blob:none --no-checkout "${SDC_REPO_URL}" "${SDC_DIR}"
fi

git -C "${SDC_DIR}" fetch --depth 1 origin "${SDC_REVISION}"
git -C "${SDC_DIR}" checkout --detach FETCH_HEAD
git -C "${SDC_DIR}" submodule update --init --depth 1 ggml

actual_revision="$(git -C "${SDC_DIR}" rev-parse HEAD)"
if [[ "${actual_revision}" != "${SDC_REVISION}" ]]; then
  echo "stable-diffusion.cpp revision mismatch" >&2
  echo "Expected: ${SDC_REVISION}" >&2
  echo "Actual:   ${actual_revision}" >&2
  exit 1
fi

echo "stable-diffusion.cpp revision: ${actual_revision}"
