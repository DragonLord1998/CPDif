#!/usr/bin/env bash
set -euo pipefail

CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
MODEL_PATH="${MODEL_PATH:-${CPDIF_WORKDIR}/models/flux-2-klein-9b.safetensors}"
MODEL_SHA256="${MODEL_SHA256:-}"
ALLOW_UNVERIFIED_MODEL="${ALLOW_UNVERIFIED_MODEL:-0}"

if [[ ! -s "${MODEL_PATH}" ]]; then
  echo "Model file is missing or empty: ${MODEL_PATH}" >&2
  exit 1
fi

if [[ -z "${MODEL_SHA256}" ]]; then
  if [[ "${ALLOW_UNVERIFIED_MODEL}" == "1" ]]; then
    echo "WARNING: MODEL_SHA256 is unset; recorded local checksum only." >&2
    sha256sum "${MODEL_PATH}" | tee "${MODEL_PATH}.sha256"
    exit 0
  fi

  echo "MODEL_SHA256 is required for reproducible verification." >&2
  echo "Set MODEL_SHA256 to the expected sha256, or set ALLOW_UNVERIFIED_MODEL=1 for a non-reproducible first download." >&2
  exit 1
fi

actual="$(sha256sum "${MODEL_PATH}" | awk '{print $1}')"
if [[ "${actual}" != "${MODEL_SHA256}" ]]; then
  echo "Model checksum mismatch for ${MODEL_PATH}" >&2
  echo "Expected: ${MODEL_SHA256}" >&2
  echo "Actual:   ${actual}" >&2
  exit 1
fi

printf '%s  %s\n' "${actual}" "${MODEL_PATH}" | tee "${MODEL_PATH}.sha256"
echo "Verified model checksum."
