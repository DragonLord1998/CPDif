"""Colab CLI entrypoint that keeps Hugging Face secrets out of source and logs."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess


repo_dir = Path(os.environ.get("CPDIF_REPO_DIR", "/content/CPDif"))
entrypoint = repo_dir / "scripts" / "colab" / "run_a100_smoke.sh"
if not entrypoint.is_file():
    raise SystemExit(f"CPDif entrypoint not found: {entrypoint}")

environment = os.environ.copy()
environment["CPDIF_REPO_DIR"] = str(repo_dir)
if not environment.get("HF_TOKEN"):
    raise SystemExit(
        "HF_TOKEN is not available in the Colab kernel environment. "
        "Colab userdata cannot be fetched through CLI execution. Run "
        "scripts/colab/ui_export_hf_token.py once from the trusted Colab UI, "
        "then retry this CLI entrypoint."
    )

subprocess.run(["bash", str(entrypoint)], cwd=repo_dir, env=environment, check=True)
