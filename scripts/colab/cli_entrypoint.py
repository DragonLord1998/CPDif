"""Colab CLI entrypoint that keeps Hugging Face secrets out of source and logs."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess


def colab_secret(name: str) -> str | None:
    try:
        from google.colab import userdata

        return userdata.get(name)
    except Exception:
        return None


repo_dir = Path(os.environ.get("CPDIF_REPO_DIR", "/content/CPDif"))
entrypoint = repo_dir / "scripts" / "colab" / "run_a100_smoke.sh"
if not entrypoint.is_file():
    raise SystemExit(f"CPDif entrypoint not found: {entrypoint}")

environment = os.environ.copy()
environment["CPDIF_REPO_DIR"] = str(repo_dir)
if not environment.get("HF_TOKEN"):
    token = colab_secret("HF_TOKEN") or colab_secret("HF_Token")
    if token:
        environment["HF_TOKEN"] = token

subprocess.run(["bash", str(entrypoint)], cwd=repo_dir, env=environment, check=True)
