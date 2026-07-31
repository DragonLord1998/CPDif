#!/usr/bin/env bash
set -euo pipefail

CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
MODEL_DIR="${MODEL_DIR:-${CPDIF_WORKDIR}/models}"
MODEL_COMPONENTS="${MODEL_COMPONENTS:-transformer,text_encoder,vae}"

TRANSFORMER_REPO="${TRANSFORMER_REPO:-black-forest-labs/FLUX.2-klein-9B}"
TRANSFORMER_REMOTE_FILE="${TRANSFORMER_REMOTE_FILE:-flux-2-klein-9b.safetensors}"
TRANSFORMER_PATH="${TRANSFORMER_PATH:-${MODEL_DIR}/flux-2-klein-9b.safetensors}"
TRANSFORMER_SHA256="${TRANSFORMER_SHA256:-0975d6b77b5f510b99547d6724a208e36527df654e8f6134f59ece3f9f30da58}"

AUX_REPO="${AUX_REPO:-Comfy-Org/vae-text-encorder-for-flux-klein-9b}"
TEXT_ENCODER_REMOTE_FILE="${TEXT_ENCODER_REMOTE_FILE:-split_files/text_encoders/qwen_3_8b.safetensors}"
TEXT_ENCODER_PATH="${TEXT_ENCODER_PATH:-${MODEL_DIR}/qwen_3_8b.safetensors}"
TEXT_ENCODER_SHA256="${TEXT_ENCODER_SHA256:-f0ff9239d56269ca1d05e5f86da6a79fac111af464955681f11c7ab0ec5ef6c1}"
VAE_REMOTE_FILE="${VAE_REMOTE_FILE:-split_files/vae/flux2-vae.safetensors}"
VAE_PATH="${VAE_PATH:-${MODEL_DIR}/flux2-vae.safetensors}"
VAE_SHA256="${VAE_SHA256:-868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3}"

if ! command -v hf >/dev/null 2>&1; then
  python3 -m pip install --quiet --upgrade huggingface_hub
fi

mkdir -p "${MODEL_DIR}"

IFS=',' read -r -a requested_components <<<"${MODEL_COMPONENTS}"
component_enabled() {
  local wanted="$1"
  local component
  for component in "${requested_components[@]}"; do
    if [[ "${component}" == "${wanted}" ]]; then
      return 0
    fi
  done
  return 1
}

for component in "${requested_components[@]}"; do
  case "${component}" in
    transformer|text_encoder|vae) ;;
    *)
      echo "Unknown MODEL_COMPONENTS entry: ${component}" >&2
      exit 2
      ;;
  esac
done

download_asset() {
  local repo="$1"
  local remote_file="$2"
  local destination="$3"
  local temporary_dir
  temporary_dir="$(mktemp -d)"

  # The `hf` client reads HF_TOKEN from the environment. Do not place the
  # secret on the command line, where it could be exposed through process lists.
  local args=(download "${repo}" "${remote_file}" --local-dir "${temporary_dir}")

  if ! hf "${args[@]}"; then
    rm -rf "${temporary_dir}"
    echo "Failed to download ${repo}/${remote_file}." >&2
    echo "For the gated 9B transformer, accept the model license and provide a read-only HF_TOKEN Colab secret." >&2
    exit 1
  fi

  mv "${temporary_dir}/${remote_file}" "${destination}"
  chmod 0644 "${destination}"
  rm -rf "${temporary_dir}"
}

verify_asset() {
  local path="$1"
  local expected="$2"
  MODEL_PATH="${path}" MODEL_SHA256="${expected}" "$(dirname "${BASH_SOURCE[0]}")/verify_model.sh"
}

if component_enabled transformer; then
  if [[ ! -s "${TRANSFORMER_PATH}" ]]; then
    download_asset "${TRANSFORMER_REPO}" "${TRANSFORMER_REMOTE_FILE}" "${TRANSFORMER_PATH}"
  fi
  verify_asset "${TRANSFORMER_PATH}" "${TRANSFORMER_SHA256}"
fi

if component_enabled text_encoder; then
  if [[ ! -s "${TEXT_ENCODER_PATH}" ]]; then
    download_asset "${AUX_REPO}" "${TEXT_ENCODER_REMOTE_FILE}" "${TEXT_ENCODER_PATH}"
  fi
  verify_asset "${TEXT_ENCODER_PATH}" "${TEXT_ENCODER_SHA256}"
fi

if component_enabled vae; then
  if [[ ! -s "${VAE_PATH}" ]]; then
    download_asset "${AUX_REPO}" "${VAE_REMOTE_FILE}" "${VAE_PATH}"
  fi
  verify_asset "${VAE_PATH}" "${VAE_SHA256}"
fi

echo "Verified selected FLUX.2 Klein 9B components (${MODEL_COMPONENTS}) under ${MODEL_DIR}"
