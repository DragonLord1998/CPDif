"""Run a CPDif command while sampling NVIDIA GPU telemetry."""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import tempfile
import time


def parse_samples(text: str) -> dict[str, float | int]:
    rows = list(csv.reader(text.splitlines()))
    memory = [int(row[1].strip()) for row in rows if len(row) >= 4]
    utilization = [int(row[2].strip()) for row in rows if len(row) >= 4]
    power = [float(row[3].strip()) for row in rows if len(row) >= 4]
    if not memory:
        raise ValueError("nvidia-smi produced no usable samples")
    return {
        "sample_count": len(memory),
        "peak_vram_mib": max(memory),
        "peak_gpu_utilization_percent": max(utilization),
        "peak_power_w": max(power),
    }


def gpu_identity() -> dict[str, str | int]:
    result = subprocess.run(
        [
            "nvidia-smi",
            "--query-gpu=name,memory.total,driver_version,compute_cap",
            "--format=csv,noheader,nounits",
        ],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    fields = [field.strip() for field in next(csv.reader(result.stdout.splitlines()))]
    return {
        "name": fields[0],
        "memory_total_mib": int(fields[1]),
        "driver_version": fields[2],
        "compute_capability": fields[3],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--sample-ms", type=int, default=100)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        parser.error("a command is required after --")
    if args.sample_ms < 50:
        parser.error("--sample-ms must be at least 50")
    return args


def main() -> int:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now(timezone.utc).isoformat()

    with tempfile.NamedTemporaryFile(mode="w+", encoding="utf-8") as sample_file:
        monitor = subprocess.Popen(
            [
                "nvidia-smi",
                "--query-gpu=timestamp,memory.used,utilization.gpu,power.draw",
                "--format=csv,noheader,nounits",
                f"--loop-ms={args.sample_ms}",
            ],
            stdout=sample_file,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        try:
            start = time.monotonic()
            result = subprocess.run(args.command)
            wall_ms = round((time.monotonic() - start) * 1000)
        finally:
            monitor.terminate()
            monitor.wait(timeout=5)
        sample_file.seek(0)
        samples = parse_samples(sample_file.read())

    summary = {
        "schema_version": 1,
        "label": args.label,
        "started_at": started_at,
        "command": args.command,
        "returncode": result.returncode,
        "wall_ms": wall_ms,
        "gpu": gpu_identity(),
        **samples,
    }
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps(summary, sort_keys=True))
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
