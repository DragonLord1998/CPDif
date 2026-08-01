"""Benchmark CPDif's SGLang-inspired persistent and diffusion-cache paths."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import sys
from typing import Any


CACHE_MODES = ("easycache", "dbcache", "taylorseer", "cache-dit", "spectrum")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def telemetry_workload_ms(cat_path: Path, edit_path: Path) -> int:
    total = 0
    for path in (cat_path, edit_path):
        record = json.loads(path.read_text(encoding="utf-8"))
        total += int(record["load_ms"])
        total += int(record.get("reference_load_ms", 0))
        total += int(record["generation_ms"])
        total += int(record["image_write_ms"])
    return total


def cache_args(mode: str) -> list[str]:
    args = ["--cache", mode]
    if mode == "easycache":
        return args + ["--cache-start", "0", "--cache-end", "1"]
    if mode == "spectrum":
        return args + ["--spectrum-warmup", "1", "--spectrum-stop", "0.9"]
    return args + [
        "--cache-warmup",
        "1",
        "--cache-max-continuous",
        "1",
        "--cache-fn",
        "1",
        "--cache-rdt",
        "0.24",
    ]


def validate_outputs(script_dir: Path, image: Path, telemetry: Path, mode: str) -> bool:
    result = subprocess.run(
        [
            sys.executable,
            str(script_dir / "validate_smoke.py"),
            str(image),
            str(telemetry),
            "1024",
            "1024",
            mode,
        ],
        check=False,
    )
    return result.returncode == 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gpu-key", choices=("a100_40gb", "rtx_pro_6000"), required=True)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--transformer", type=Path, required=True)
    parser.add_argument("--text-encoder", type=Path, required=True)
    parser.add_argument("--vae", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=3)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.samples < 1:
        raise SystemExit("--samples must be positive")
    for path in (args.binary, args.transformer, args.text_encoder, args.vae, args.baseline):
        if not path.is_file():
            raise SystemExit(f"missing required file: {path}")

    script_dir = Path(__file__).resolve().parent
    args.output_dir.mkdir(parents=True, exist_ok=True)
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    baseline_gpu = baseline[args.gpu_key]
    seed = 20260731
    cat_prompt = (
        "A highly detailed realistic studio photograph of one orange tabby cat "
        "sitting upright and facing the camera, full body visible, expressive green "
        "eyes, natural anatomy, crisp individual fur, soft neutral gray background, "
        "softbox lighting, centered composition"
    )
    suit_prompt = (
        "Keep exactly the same orange tabby cat, face, green eyes, fur pattern, body "
        "proportions, pose, camera angle, lighting, and gray studio background. Dress "
        "the cat in a perfectly fitted elegant black business suit with white dress "
        "shirt and small black tie. Preserve the identity of the cat and all uncovered fur."
    )
    common = [
        str(args.binary),
        "generate-edit",
        "--transformer",
        str(args.transformer),
        "--text-encoder",
        str(args.text_encoder),
        "--vae",
        str(args.vae),
        "--steps",
        "4",
        "--width",
        "1024",
        "--height",
        "1024",
        "--cfg-scale",
        "1.0",
        "--rng",
        "cpu",
        "--qwen-image-layers",
        "3",
        "--no-offload-to-cpu",
        "--prompt",
        cat_prompt,
        "--edit-prompt",
        suit_prompt,
    ]

    benchmark_records: list[dict[str, Any]] = []

    def run(label: str, command: list[str], record_path: Path) -> tuple[int, dict[str, Any]]:
        record_path.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            [
                sys.executable,
                str(script_dir / "benchmark_runtime.py"),
                "--output",
                str(record_path),
                "--label",
                label,
                "--",
                *command,
            ],
            check=False,
        )
        record = json.loads(record_path.read_text(encoding="utf-8"))
        benchmark_records.append(record)
        return result.returncode, record

    default_walls: list[int] = []
    default_hash_pairs: list[tuple[str, str]] = []
    for sample in range(1, args.samples + 1):
        output = args.output_dir / "default" / f"run-{sample}"
        cat = output / "cat.png"
        cat_json = output / "cat.json"
        edit = output / "cat-in-suit.png"
        edit_json = output / "cat-in-suit.json"
        command = common + [
            "--seed",
            str(seed),
            "--edit-seed",
            str(seed + 1),
            "--output",
            str(cat),
            "--telemetry",
            str(cat_json),
            "--edited-output",
            str(edit),
            "--edited-telemetry",
            str(edit_json),
        ]
        returncode, record = run(
            f"{args.gpu_key}-default-{sample}",
            command,
            output / "benchmark.json",
        )
        if returncode != 0:
            raise SystemExit(f"default benchmark {sample} failed")
        if not (
            validate_outputs(script_dir, cat, cat_json, "text-to-image")
            and validate_outputs(script_dir, edit, edit_json, "image-edit")
        ):
            raise SystemExit(f"default benchmark {sample} produced invalid output")
        default_walls.append(int(record["wall_ms"]))
        default_hash_pairs.append((sha256(cat), sha256(edit)))

    expected_pair = (
        str(baseline_gpu["cat_png_sha256"]),
        str(baseline_gpu["edit_png_sha256"]),
    )
    default_exact = all(pair == expected_pair for pair in default_hash_pairs)

    persistent_dir = args.output_dir / "persistent"
    persistent_command = common + [
        "--seed",
        str(seed),
        "--edit-seed",
        str(seed + 1),
        "--repeat",
        "3",
        "--output",
        str(persistent_dir / "cat-{index}.png"),
        "--telemetry",
        str(persistent_dir / "cat-{index}.json"),
        "--edited-output",
        str(persistent_dir / "cat-in-suit-{index}.png"),
        "--edited-telemetry",
        str(persistent_dir / "cat-in-suit-{index}.json"),
    ]
    persistent_returncode, persistent_record = run(
        f"{args.gpu_key}-persistent",
        persistent_command,
        persistent_dir / "benchmark.json",
    )
    if persistent_returncode != 0:
        raise SystemExit("persistent benchmark failed")
    steady_times: list[int] = []
    persistent_images_valid = True
    for index in range(1, 4):
        cat = persistent_dir / f"cat-{index}.png"
        cat_json = persistent_dir / f"cat-{index}.json"
        edit = persistent_dir / f"cat-in-suit-{index}.png"
        edit_json = persistent_dir / f"cat-in-suit-{index}.json"
        persistent_images_valid &= validate_outputs(
            script_dir, cat, cat_json, "text-to-image"
        )
        persistent_images_valid &= validate_outputs(
            script_dir, edit, edit_json, "image-edit"
        )
        if index > 1:
            steady_times.append(telemetry_workload_ms(cat_json, edit_json))
    persistent_pair = (
        sha256(persistent_dir / "cat-1.png"),
        sha256(persistent_dir / "cat-in-suit-1.png"),
    )

    cache_profiles: list[dict[str, Any]] = []
    for mode in CACHE_MODES:
        output = args.output_dir / "cache" / mode
        cat = output / "cat.png"
        cat_json = output / "cat.json"
        edit = output / "cat-in-suit.png"
        edit_json = output / "cat-in-suit.json"
        command = common + cache_args(mode) + [
            "--seed",
            str(seed),
            "--edit-seed",
            str(seed + 1),
            "--output",
            str(cat),
            "--telemetry",
            str(cat_json),
            "--edited-output",
            str(edit),
            "--edited-telemetry",
            str(edit_json),
        ]
        returncode, record = run(
            f"{args.gpu_key}-cache-{mode}",
            command,
            output / "benchmark.json",
        )
        images_valid = False
        if returncode == 0:
            images_valid = validate_outputs(
                script_dir, cat, cat_json, "text-to-image"
            ) and validate_outputs(script_dir, edit, edit_json, "image-edit")
        cache_profiles.append(
            {
                "mode": mode,
                "returncode": returncode,
                "images_valid": images_valid,
                "wall_ms": int(record["wall_ms"]),
                "cat_png_sha256": sha256(cat) if cat.is_file() else None,
                "edit_png_sha256": sha256(edit) if edit.is_file() else None,
            }
        )

    peak_vram = max(int(record["peak_vram_mib"]) for record in benchmark_records)
    memory_total = int(benchmark_records[0]["gpu"]["memory_total_mib"])
    gpu_result = {
        "gpu": benchmark_records[0]["gpu"],
        "default": {
            "wall_ms_samples": default_walls,
            "wall_ms_median": round(statistics.median(default_walls)),
            "exact_output_match": default_exact,
            "cat_png_sha256": default_hash_pairs[-1][0],
            "edit_png_sha256": default_hash_pairs[-1][1],
        },
        "persistent": {
            "wall_ms": int(persistent_record["wall_ms"]),
            "steady_state_wall_ms_samples": steady_times,
            "steady_state_wall_ms_median": round(statistics.median(steady_times)),
            "exact_output_match": persistent_pair == default_hash_pairs[-1],
            "images_valid": persistent_images_valid,
        },
        "peak_vram_mib": peak_vram,
        "memory_total_mib": memory_total,
        "cache_profiles": cache_profiles,
    }
    output_path = args.output_dir / "gpu-result.json"
    output_path.write_text(
        json.dumps({"schema_version": 1, args.gpu_key: gpu_result}, indent=2, sort_keys=True)
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({args.gpu_key: gpu_result}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
