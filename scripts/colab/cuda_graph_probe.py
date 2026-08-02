"""Prove that the pinned ggml CUDA graph path captures a real CPDif workload."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys


CAPTURE_SIGNAL = "CUDA graph warmup complete"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gpu-key", choices=("a100_40gb", "rtx_pro_6000"), required=True)
    parser.add_argument("--build-dir", type=Path, required=True)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--transformer", type=Path, required=True)
    parser.add_argument("--text-encoder", type=Path, required=True)
    parser.add_argument("--vae", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    required = (
        args.binary,
        args.transformer,
        args.text_encoder,
        args.vae,
        args.build_dir / "CMakeCache.txt",
    )
    for path in required:
        if not path.is_file():
            raise SystemExit(f"missing required CUDA graph probe input: {path}")

    cmake_cache = (args.build_dir / "CMakeCache.txt").read_text(encoding="utf-8")
    if "GGML_CUDA_GRAPHS:BOOL=ON" not in cmake_cache:
        raise SystemExit("CUDA graph probe requires GGML_CUDA_GRAPHS=ON")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    cat = args.output_dir / "cat.png"
    cat_json = args.output_dir / "cat.json"
    edit = args.output_dir / "cat-in-suit.png"
    edit_json = args.output_dir / "cat-in-suit.json"
    log_path = args.output_dir / "cuda-graph-probe.log"
    report_path = args.output_dir / "cuda-graph-probe.json"
    graph_memory_args = ["--max-vram", "8"] if args.gpu_key == "a100_40gb" else []

    command = [
        str(args.binary),
        "generate-edit",
        "--transformer",
        str(args.transformer),
        "--text-encoder",
        str(args.text_encoder),
        "--vae",
        str(args.vae),
        "--klein-kv-cache",
        "--steps",
        "4",
        "--width",
        "512",
        "--height",
        "512",
        "--cfg-scale",
        "1.0",
        "--rng",
        "cpu",
        "--qwen-image-layers",
        "3",
        "--no-offload-to-cpu",
        *graph_memory_args,
        "--prompt",
        "A realistic orange tabby cat in a neutral gray studio",
        "--edit-prompt",
        "Keep the same cat and dress it in a fitted black suit",
        "--seed",
        "20260731",
        "--edit-seed",
        "20260732",
        "--repeat",
        "1",
        "--output",
        str(cat),
        "--telemetry",
        str(cat_json),
        "--edited-output",
        str(edit),
        "--edited-telemetry",
        str(edit_json),
        "--verbose",
    ]
    with log_path.open("w", encoding="utf-8") as log:
        result = subprocess.run(
            command,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
            check=False,
        )
    if result.returncode != 0:
        raise SystemExit(f"CUDA graph runtime probe failed; inspect {log_path}")

    log_text = log_path.read_text(encoding="utf-8", errors="replace")
    capture_signals = log_text.count(CAPTURE_SIGNAL)
    if capture_signals < 1:
        raise SystemExit(
            f"CUDA graph runtime probe did not observe '{CAPTURE_SIGNAL}'; inspect {log_path}"
        )

    script_dir = Path(__file__).resolve().parent
    for image, telemetry, mode in (
        (cat, cat_json, "text-to-image"),
        (edit, edit_json, "image-edit"),
    ):
        subprocess.run(
            [
                sys.executable,
                str(script_dir / "validate_smoke.py"),
                str(image),
                str(telemetry),
                "512",
                "512",
                mode,
            ],
            check=True,
        )

    report = {
        "schema_version": 1,
        "gpu_key": args.gpu_key,
        "ggml_cuda_graphs_compiled": True,
        "runtime_capture_signal": CAPTURE_SIGNAL,
        "runtime_capture_signal_count": capture_signals,
        "log": str(log_path),
        "passed": True,
    }
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
