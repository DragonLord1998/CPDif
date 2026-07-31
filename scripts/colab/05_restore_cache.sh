#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
CPDIF_REPO_DIR="${CPDIF_REPO_DIR:-$(cd -- "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)}"
CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
CPDIF_CACHE_ARCHIVE="${CPDIF_CACHE_ARCHIVE:-}"
CPDIF_CACHE_SHA256="${CPDIF_CACHE_SHA256:-}"

if [[ -z "${CPDIF_CACHE_ARCHIVE}" || ! -s "${CPDIF_CACHE_ARCHIVE}" ]]; then
  echo "Set CPDIF_CACHE_ARCHIVE to the downloaded cache archive." >&2
  exit 1
fi
if [[ -z "${CPDIF_CACHE_SHA256}" ]]; then
  echo "Set CPDIF_CACHE_SHA256 to the expected archive checksum." >&2
  exit 1
fi

actual_sha256="$(sha256sum "${CPDIF_CACHE_ARCHIVE}" | awk '{print $1}')"
if [[ "${actual_sha256}" != "${CPDIF_CACHE_SHA256}" ]]; then
  echo "Cache archive checksum mismatch." >&2
  exit 1
fi

manifest_tmp="$(mktemp)"
trap 'rm -f "${manifest_tmp}"' EXIT
tar --zstd -xOf "${CPDIF_CACHE_ARCHIVE}" cache-manifest.json >"${manifest_tmp}"

python3 "${SCRIPT_DIR}/cache_manifest.py" validate \
  --repo-dir "${CPDIF_REPO_DIR}" \
  --work-dir "${CPDIF_WORKDIR}" \
  --manifest "${manifest_tmp}"

mkdir -p "${CPDIF_WORKDIR}"
tar --zstd -xf "${CPDIF_CACHE_ARCHIVE}" -C "${CPDIF_WORKDIR}"
echo "Restored compatible GPU build cache into ${CPDIF_WORKDIR}"
