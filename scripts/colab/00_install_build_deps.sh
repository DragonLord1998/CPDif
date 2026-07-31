#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if [[ "${EUID}" -ne 0 ]]; then
  SUDO=sudo
else
  SUDO=
fi

$SUDO apt-get update
$SUDO apt-get install -y --no-install-recommends \
  build-essential \
  ca-certificates \
  ccache \
  cmake \
  curl \
  git \
  git-lfs \
  ninja-build \
  pkg-config \
  python3 \
  python3-pip \
  zstd

git lfs install --skip-repo
python3 -m pip install --quiet --upgrade huggingface_hub

cmake --version
ninja --version
git --version
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi
fi
