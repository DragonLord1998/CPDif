#!/usr/bin/env bash
set -euo pipefail

CPDIF_WORKDIR="${CPDIF_WORKDIR:-/content/cpdif-work}"
CPDIF_PROMPT_ASSISTANT_MODEL="${CPDIF_PROMPT_ASSISTANT_MODEL:-lukey03/qwen3.5-9b-abliterated-vision}"
OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
OLLAMA_MODELS="${OLLAMA_MODELS:-${CPDIF_WORKDIR}/models/ollama}"
OLLAMA_LOG="${CPDIF_PROMPT_ASSISTANT_LOG:-${CPDIF_WORKDIR}/ollama.log}"
OLLAMA_PID="${CPDIF_WORKDIR}/ollama.pid"
OLLAMA_INSTALLER="/tmp/cpdif-ollama-install.sh"
OLLAMA_MIN_VERSION="0.17.1"

export OLLAMA_HOST OLLAMA_MODELS OLLAMA_KEEP_ALIVE=0
mkdir -p "${OLLAMA_MODELS}" "$(dirname "${OLLAMA_LOG}")"

needs_ollama_install=1
if command -v ollama >/dev/null 2>&1; then
  current_version="$(ollama --version 2>/dev/null | grep -Eo '[0-9]+(\.[0-9]+)+' | tail -n 1 || true)"
  if [[ -n "${current_version}" ]] &&
    [[ "$(printf '%s\n' "${OLLAMA_MIN_VERSION}" "${current_version}" | sort -V | head -n 1)" == "${OLLAMA_MIN_VERSION}" ]]; then
    needs_ollama_install=0
  else
    echo "Updating Ollama ${current_version:-unknown} to ${OLLAMA_MIN_VERSION} or newer..."
  fi
fi

if [[ "${needs_ollama_install}" -eq 1 ]]; then
  echo "Installing Ollama from the official installer..."
  curl --fail --silent --show-error --location \
    https://ollama.com/install.sh \
    --output "${OLLAMA_INSTALLER}"
  bash "${OLLAMA_INSTALLER}"
fi

if ! curl --fail --silent --max-time 2 "http://${OLLAMA_HOST}/api/tags" >/dev/null; then
  echo "Starting loopback-only Ollama on ${OLLAMA_HOST}..."
  nohup ollama serve >"${OLLAMA_LOG}" 2>&1 &
  echo "$!" >"${OLLAMA_PID}"
fi

for _ in $(seq 1 60); do
  if curl --fail --silent --max-time 2 "http://${OLLAMA_HOST}/api/tags" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl --fail --silent --max-time 2 "http://${OLLAMA_HOST}/api/tags" >/dev/null; then
  echo "Ollama did not become ready. See ${OLLAMA_LOG}." >&2
  exit 1
fi

echo "Downloading ${CPDIF_PROMPT_ASSISTANT_MODEL} for local prompt rewriting..."
ollama pull "${CPDIF_PROMPT_ASSISTANT_MODEL}"
echo "Local Qwen prompt assistant is ready."
