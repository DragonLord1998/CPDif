#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_REPO_DIR="${CPDIF_REPO_DIR:-$(cd -- "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)}"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
CPDIF_CACHE_EXPORT_DIR="${CPDIF_CACHE_EXPORT_DIR:-/content/cpdif-cache-exports}"
CPDIF_CUDA_ARCHITECTURES="${CPDIF_CUDA_ARCHITECTURES:-}"

if [[ -z "${CPDIF_CUDA_ARCHITECTURES}" ]]; then
  CPDIF_CUDA_ARCHITECTURES="$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader,nounits | head -n1 | tr -d '[:space:].')"
fi
if [[ ! "${CPDIF_CUDA_ARCHITECTURES}" =~ ^[0-9]+$ ]]; then
  echo "Unable to detect a CUDA compute capability." >&2
  exit 1
fi
if [[ -z "${CPDIF_BUILD_DIR:-}" ]]; then
  if [[ "${CPDIF_CUDA_ARCHITECTURES}" == "80" ]]; then
    CPDIF_BUILD_DIR="${CPDIF_WORKDIR}/build-a100"
  else
    CPDIF_BUILD_DIR="${CPDIF_WORKDIR}/build-sm${CPDIF_CUDA_ARCHITECTURES}"
  fi
fi

if [[ ! -x "${CPDIF_BUILD_DIR}/bin/cpdif" ]]; then
  echo "A successful build is required before caching: ${CPDIF_BUILD_DIR}/bin/cpdif" >&2
  exit 1
fi

mkdir -p "${CPDIF_CACHE_EXPORT_DIR}"
project_commit="$(git -C "${CPDIF_REPO_DIR}" rev-parse --short=12 HEAD)"
archive="${CPDIF_CACHE_EXPORT_DIR}/cpdif-sm${CPDIF_CUDA_ARCHITECTURES}-${project_commit}.tar.zst"
manifest="${CPDIF_WORKDIR}/cache-manifest.json"
build_dir_name="$(basename -- "${CPDIF_BUILD_DIR}")"

python3 "${SCRIPT_DIR}/cache_manifest.py" create \
  --repo-dir "${CPDIF_REPO_DIR}" \
  --work-dir "${CPDIF_WORKDIR}" \
  --build-dir "${CPDIF_BUILD_DIR}" \
  --cuda-architectures "${CPDIF_CUDA_ARCHITECTURES}" \
  --output "${manifest}"

archive_entries=("${build_dir_name}" cache-manifest.json)
if [[ -d "${CPDIF_WORKDIR}/ccache" ]]; then
  archive_entries+=(ccache)
fi

tar --zstd -cf "${archive}" -C "${CPDIF_WORKDIR}" "${archive_entries[@]}"
sha256sum "${archive}" | tee "${archive}.sha256"
du -h "${archive}"
echo "CPDIF_CACHE_ARCHIVE=${archive}"
