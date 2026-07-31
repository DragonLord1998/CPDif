#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_REPO_DIR="${CPDIF_REPO_DIR:-$(cd -- "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)}"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
CPDIF_BUILD_DIR="${CPDIF_BUILD_DIR:-${CPDIF_WORKDIR}/build-a100}"
CPDIF_CACHE_EXPORT_DIR="${CPDIF_CACHE_EXPORT_DIR:-/content/cpdif-cache-exports}"

if [[ ! -x "${CPDIF_BUILD_DIR}/bin/cpdif" ]]; then
  echo "A successful build is required before caching: ${CPDIF_BUILD_DIR}/bin/cpdif" >&2
  exit 1
fi

mkdir -p "${CPDIF_CACHE_EXPORT_DIR}"
project_commit="$(git -C "${CPDIF_REPO_DIR}" rev-parse --short=12 HEAD)"
archive="${CPDIF_CACHE_EXPORT_DIR}/cpdif-a100-sm80-${project_commit}.tar.zst"
manifest="${CPDIF_WORKDIR}/cache-manifest.json"

python3 "${SCRIPT_DIR}/cache_manifest.py" create \
  --repo-dir "${CPDIF_REPO_DIR}" \
  --work-dir "${CPDIF_WORKDIR}" \
  --output "${manifest}"

archive_entries=(build-a100 cache-manifest.json)
if [[ -d "${CPDIF_WORKDIR}/ccache" ]]; then
  archive_entries+=(ccache)
fi

tar --zstd -cf "${archive}" -C "${CPDIF_WORKDIR}" "${archive_entries[@]}"
sha256sum "${archive}" | tee "${archive}.sha256"
du -h "${archive}"
echo "CPDIF_CACHE_ARCHIVE=${archive}"
