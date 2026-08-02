#!/usr/bin/env python3
"""Run NVIDIA PiD's official FLUX.2 from-clean path and save one 4x PNG."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid-root", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--seed", type=int, default=0)
    return parser.parse_args()


def checkpoint_type(image_path: Path) -> str:
    from PIL import Image

    with Image.open(image_path) as image:
        longest_side = max(image.size)
    return "2k" if longest_side <= 512 else "2kto4k_v1pt5"


def main() -> int:
    args = parse_args()
    pid_root = args.pid_root.resolve(strict=True)
    input_path = args.input.resolve(strict=True)
    output_path = args.output.resolve()
    if not (pid_root / "pid" / "_src" / "inference" / "from_clean.py").is_file():
        raise SystemExit(f"NVIDIA PiD checkout is incomplete: {pid_root}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    variant = checkpoint_type(input_path)
    with tempfile.TemporaryDirectory(prefix="cpdif-pid-", dir=output_path.parent) as raw_dir:
        run_dir = Path(raw_dir)
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(pid_root)
        command = [
            sys.executable,
            "-m",
            "pid._src.inference.from_clean",
            "--backbone",
            "flux2",
            "--pid_ckpt_type",
            variant,
            "--input_path",
            str(input_path),
            "--prompt",
            args.prompt,
            "--degrade_sigmas",
            "0.0",
            "--output_dir",
            str(run_dir),
            "--cfg_scale",
            "1",
            "--pid_inference_steps",
            "4",
            "--scale",
            "4",
            "--seed",
            str(args.seed),
            "--save_format",
            "png",
        ]
        subprocess.run(command, cwd=pid_root, env=environment, check=True)

        candidates = list(run_dir.glob(f"*/sigma_0.000/{input_path.stem}.png"))
        if len(candidates) != 1:
            found = ", ".join(str(path.relative_to(run_dir)) for path in candidates)
            raise RuntimeError(
                f"Expected one NVIDIA PiD output, found {len(candidates)}: {found or 'none'}"
            )
        temporary_output = output_path.with_suffix(f"{output_path.suffix}.partial")
        shutil.copyfile(candidates[0], temporary_output)
        temporary_output.replace(output_path)

    print(f"NVIDIA PiD 4x output: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
