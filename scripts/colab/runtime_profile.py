"""Select a safe parameter-residency profile for CPDif GPU inference."""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys
from typing import Iterable


MIB = 1024 * 1024
DEFAULT_RESERVE_MIB = 8192


def model_size_mib(paths: Iterable[Path]) -> int:
    total_bytes = sum(path.stat().st_size for path in paths)
    return (total_bytes + MIB - 1) // MIB


def detect_gpu_vram_mib() -> int:
    result = subprocess.run(
        [
            "nvidia-smi",
            "--query-gpu=memory.total",
            "--format=csv,noheader,nounits",
        ],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    first_gpu = result.stdout.splitlines()[0].strip()
    return int(first_gpu)


def select_profile(
    requested: str,
    gpu_vram_mib: int,
    weights_mib: int,
    reserve_mib: int = DEFAULT_RESERVE_MIB,
) -> str:
    if requested in {"gpu", "stream"}:
        return requested
    if requested != "auto":
        raise ValueError("residency must be auto, gpu, or stream")
    if gpu_vram_mib <= 0:
        return "stream"
    return "gpu" if weights_mib + reserve_mib <= gpu_vram_mib else "stream"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--residency", choices=("auto", "gpu", "stream"), default="auto")
    parser.add_argument("--gpu-vram-mib", type=int)
    parser.add_argument("--reserve-mib", type=int, default=DEFAULT_RESERVE_MIB)
    parser.add_argument("model", type=Path, nargs="+")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.reserve_mib < 0:
        raise SystemExit("--reserve-mib must be non-negative")
    missing = [str(path) for path in args.model if not path.is_file()]
    if missing:
        raise SystemExit(f"model files are missing: {', '.join(missing)}")

    weights_mib = model_size_mib(args.model)
    gpu_vram_mib = args.gpu_vram_mib
    if gpu_vram_mib is None:
        try:
            gpu_vram_mib = detect_gpu_vram_mib()
        except (FileNotFoundError, subprocess.CalledProcessError, ValueError, IndexError):
            gpu_vram_mib = 0
    profile = select_profile(
        args.residency,
        gpu_vram_mib,
        weights_mib,
        args.reserve_mib,
    )
    print(profile)
    print(
        f"CPDif residency={profile} weights={weights_mib}MiB "
        f"reserve={args.reserve_mib}MiB gpu={gpu_vram_mib}MiB",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
