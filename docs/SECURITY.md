# Security Notes

This workflow is designed for a private Colab CLI run, not a public service.

## Credentials

- Do not commit tokens, cookies, Colab notebooks containing tokens, or downloaded model files.
- Pass Hugging Face credentials through `HF_TOKEN`, or store a read-only token in Colab userdata as `HF_TOKEN`.
- The Colab CLI entrypoint injects the token into only the download subprocess environment and does not print or persist it.
- Prefer short-lived or least-privilege tokens for gated model downloads.

## Model Assets

- Keep the pinned SHA-256 values enabled for reproducible runs; override them only when intentionally changing an approved model revision.
- Store large model files under Colab storage or an external artifact store, not in this repository.
- FLUX.2 Klein 9B is gated and non-commercial. Accept its license before download and comply with the AUP and required safety filtering.

## Runtime Boundaries

- The provided workflow does not start a web UI, tunnel, reverse proxy, or public endpoint.
- The scripts target one interactive Colab A100 session and terminate after the smoke command completes.
- If future work adds a UI or tunnel, document authentication, network exposure, teardown behavior, and log redaction before enabling it.

## Logs

- Command logs may include model URLs and local file paths.
- Logs should not include `HF_TOKEN`; avoid enabling shell tracing (`set -x`) around credentialed commands.
