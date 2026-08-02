"""Benchmark the native FLUX.2 klein 9B-KV reference-attention path."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import statistics
import subprocess
import sys
from typing import Any

from sglang_diffusion_benchmark import sha256, telemetry_workload_ms, validate_outputs


def performance_delta(baseline_ms: int, candidate_ms: int) -> tuple[float, float]:
    if baseline_ms <= 0 or candidate_ms <= 0:
        raise ValueError("benchmark latencies must be positive")
    return (
        round(baseline_ms / candidate_ms, 4),
        round((1.0 - candidate_ms / baseline_ms) * 100.0, 2),
    )


def telemetry_kv_cache_enabled(path: Path) -> bool:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload.get("klein_kv_cache") is True


def telemetry_stage_ms(path: Path) -> int:
    record = json.loads(path.read_text(encoding="utf-8"))
    return sum(
        int(record.get(field, 0))
        for field in ("load_ms", "reference_load_ms", "generation_ms", "image_write_ms")
    )


def historical_output_hashes(baseline_gpu: dict[str, Any]) -> dict[str, str]:
    default = baseline_gpu["default"]
    return {
        "cat": str(default["cat_png_sha256"]),
        "edit": str(default["edit_png_sha256"]),
    }


def graph_memory_args(gpu_key: str) -> list[str]:
    """Keep the 1024px KV graph inside the A100 40GB residency envelope."""
    if gpu_key == "a100_40gb":
        return ["--max-vram", "8"]
    return []


def output_hashes_are_diverse(hashes: list[dict[str, str]]) -> bool:
    """Reject flat/corrupt repeat outputs that pass PNG header validation."""
    return (
        len(hashes) >= 2
        and len({sample["cat"] for sample in hashes}) > 1
        and len({sample["edit"] for sample in hashes}) > 1
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gpu-key", choices=("a100_40gb", "rtx_pro_6000"), required=True)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--standard-transformer", type=Path, required=True)
    parser.add_argument("--transformer", type=Path, required=True)
    parser.add_argument("--text-encoder", type=Path, required=True)
    parser.add_argument("--vae", type=Path, required=True)
    parser.add_argument("--patch", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--requests", type=int, default=3)
    return parser.parse_args()


def run_profile(
    args: argparse.Namespace,
    script_dir: Path,
    transformer: Path,
    output_dir: Path,
    label: str,
    kv_enabled: bool,
    cat_prompt: str,
    suit_prompt: str,
) -> dict[str, Any]:
    command = [
        str(args.binary),
        "generate-edit",
        "--transformer",
        str(transformer),
        "--text-encoder",
        str(args.text_encoder),
        "--vae",
        str(args.vae),
    ]
    if kv_enabled:
        command.append("--klein-kv-cache")
    command += [
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
        *graph_memory_args(args.gpu_key),
        "--prompt",
        cat_prompt,
        "--edit-prompt",
        suit_prompt,
        "--seed",
        "20260731",
        "--edit-seed",
        "20260732",
        "--repeat",
        str(args.requests),
        "--output",
        str(output_dir / "cat-{index}.png"),
        "--telemetry",
        str(output_dir / "cat-{index}.json"),
        "--edited-output",
        str(output_dir / "cat-in-suit-{index}.png"),
        "--edited-telemetry",
        str(output_dir / "cat-in-suit-{index}.json"),
    ]

    runtime_record = output_dir / "benchmark.json"
    result = subprocess.run(
        [
            sys.executable,
            str(script_dir / "benchmark_runtime.py"),
            "--output",
            str(runtime_record),
            "--label",
            label,
            "--",
            *command,
        ],
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"{label} benchmark failed")

    runtime: dict[str, Any] = json.loads(runtime_record.read_text(encoding="utf-8"))
    pair_samples: list[int] = []
    edit_samples: list[int] = []
    images_valid = True
    telemetry_valid = True
    hashes: list[dict[str, str]] = []
    for index in range(1, args.requests + 1):
        cat = output_dir / f"cat-{index}.png"
        cat_json = output_dir / f"cat-{index}.json"
        edit = output_dir / f"cat-in-suit-{index}.png"
        edit_json = output_dir / f"cat-in-suit-{index}.json"
        images_valid &= validate_outputs(script_dir, cat, cat_json, "text-to-image")
        images_valid &= validate_outputs(script_dir, edit, edit_json, "image-edit")
        telemetry_valid &= telemetry_kv_cache_enabled(cat_json) is kv_enabled
        telemetry_valid &= telemetry_kv_cache_enabled(edit_json) is kv_enabled
        if index > 1:
            pair_samples.append(telemetry_workload_ms(cat_json, edit_json))
            edit_samples.append(telemetry_stage_ms(edit_json))
        hashes.append({"cat": sha256(cat), "edit": sha256(edit)})

    return {
        "wall_ms": int(runtime["wall_ms"]),
        "steady_state_pair_ms_samples": pair_samples,
        "steady_state_pair_ms_median": round(statistics.median(pair_samples)),
        "steady_state_edit_ms_samples": edit_samples,
        "steady_state_edit_ms_median": round(statistics.median(edit_samples)),
        "peak_vram_mib": int(runtime["peak_vram_mib"]),
        "images_valid": images_valid,
        "telemetry_valid": telemetry_valid,
        "output_diversity_valid": output_hashes_are_diverse(hashes),
        "hashes": hashes,
        "gpu": runtime["gpu"],
    }


def main() -> int:
    args = parse_args()
    if args.requests < 2:
        raise SystemExit("--requests must be at least 2")
    for path in (
        args.binary,
        args.standard_transformer,
        args.transformer,
        args.text_encoder,
        args.vae,
        args.patch,
        args.baseline,
    ):
        if not path.is_file():
            raise SystemExit(f"missing required file: {path}")

    script_dir = Path(__file__).resolve().parent
    args.output_dir.mkdir(parents=True, exist_ok=True)
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    baseline_gpu = baseline["gpu_results"][args.gpu_key]
    baseline_ms = int(baseline_gpu["persistent"]["steady_state_wall_ms_median"])

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
    # Run the candidate first so the standard baseline receives any ordering
    # advantage from a warmed GPU. The first request of each profile is omitted.
    kv = run_profile(
        args,
        script_dir,
        args.transformer,
        args.output_dir / "kv",
        f"{args.gpu_key}-klein-kv",
        True,
        cat_prompt,
        suit_prompt,
    )
    standard = run_profile(
        args,
        script_dir,
        args.standard_transformer,
        args.output_dir / "standard",
        f"{args.gpu_key}-standard",
        False,
        cat_prompt,
        suit_prompt,
    )

    edit_speedup, edit_reduction = performance_delta(
        standard["steady_state_edit_ms_median"],
        kv["steady_state_edit_ms_median"],
    )
    pair_speedup, pair_reduction = performance_delta(
        standard["steady_state_pair_ms_median"],
        kv["steady_state_pair_ms_median"],
    )
    expected_standard_hashes = historical_output_hashes(baseline_gpu)
    standard_exact = standard["hashes"][0] == expected_standard_hashes
    same_gpu = standard["gpu"] == kv["gpu"]
    passed = (
        same_gpu
        and standard_exact
        and standard["images_valid"]
        and standard["telemetry_valid"]
        and standard["output_diversity_valid"]
        and kv["images_valid"]
        and kv["telemetry_valid"]
        and kv["output_diversity_valid"]
        and kv["steady_state_edit_ms_median"] < standard["steady_state_edit_ms_median"]
    )
    output = {
        "schema_version": 2,
        "gpu_key": args.gpu_key,
        "profile": "flux2-klein-9b-kv-q8",
        "requests": args.requests,
        "standard": standard,
        "kv": kv,
        "comparison": {
            "edit_speedup": edit_speedup,
            "edit_latency_reduction_percent": edit_reduction,
            "pair_speedup": pair_speedup,
            "pair_latency_reduction_percent": pair_reduction,
            "historical_standard_persistent_pair_ms_median": baseline_ms,
            "same_gpu": same_gpu,
            "standard_historical_output_exact": standard_exact,
        },
        "artifacts": {
            "standard_transformer_sha256": sha256(args.standard_transformer),
            "kv_transformer_sha256": sha256(args.transformer),
            "text_encoder_sha256": sha256(args.text_encoder),
            "vae_sha256": sha256(args.vae),
            "upstream_patch_sha256": sha256(args.patch),
        },
        "visual_review_status": "pending",
        "passed": passed,
    }
    result_path = args.output_dir / "gpu-result.json"
    result_path.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(output, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
