#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_REPO_DIR="${CPDIF_REPO_DIR:-$(cd -- "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)}"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
CPDIF_RELEASE_REPO="${CPDIF_RELEASE_REPO:-DragonLord1998/CPDif}"
CPDIF_RELEASE_TAG="${CPDIF_RELEASE_TAG:-gpu-build-cache-v4}"
CPDIF_CUDA_ARCHITECTURES="${CPDIF_CUDA_ARCHITECTURES:-}"
CPDIF_RELEASE_DOWNLOAD_DIR="${CPDIF_RELEASE_DOWNLOAD_DIR:-/content/cpdif-release-cache}"

if [[ -z "${CPDIF_CUDA_ARCHITECTURES}" ]]; then
  CPDIF_CUDA_ARCHITECTURES="$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader,nounits | head -n1 | tr -d '[:space:].')"
fi
if [[ ! "${CPDIF_CUDA_ARCHITECTURES}" =~ ^[0-9]+$ ]]; then
  echo "Unable to detect a CUDA compute capability." >&2
  exit 1
fi

asset_base="cpdif-gpu-build-cache-v4-sm${CPDIF_CUDA_ARCHITECTURES}"
archive="${CPDIF_RELEASE_DOWNLOAD_DIR}/${asset_base}.tar.zst"
checksum_file="${archive}.sha256"
release_url="https://github.com/${CPDIF_RELEASE_REPO}/releases/download/${CPDIF_RELEASE_TAG}"

mkdir -p "${CPDIF_RELEASE_DOWNLOAD_DIR}"
curl --fail --location --retry 3 --retry-delay 2 \
  --output "${archive}" \
  "${release_url}/${asset_base}.tar.zst"
curl --fail --location --retry 3 --retry-delay 2 \
  --output "${checksum_file}" \
  "${release_url}/${asset_base}.tar.zst.sha256"

expected_sha256="$(awk 'NR == 1 {print $1}' "${checksum_file}")"
if [[ ! "${expected_sha256}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Release checksum file is invalid: ${checksum_file}" >&2
  exit 1
fi

CPDIF_CACHE_ARCHIVE="${archive}" \
CPDIF_CACHE_SHA256="${expected_sha256}" \
CPDIF_REPO_DIR="${CPDIF_REPO_DIR}" \
CPDIF_WORKDIR="${CPDIF_WORKDIR}" \
  bash "${SCRIPT_DIR}/05_restore_cache.sh"

echo "Restored ${asset_base} from GitHub release ${CPDIF_RELEASE_TAG}"
