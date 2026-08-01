"""Evaluate the SGLang/diffusion.cpp optimization milestone.

The candidate file is produced by the real Colab GPU benchmark.  Keeping the
gate in a small, dependency-free script makes a pass/fail decision reproducible
both in Colab and in CI when benchmark artifacts are reviewed later.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any


GPU_KEYS = ("a100_40gb", "rtx_pro_6000")
REQUIRED_CACHE_MODES = {
    "easycache",
    "dbcache",
    "taylorseer",
    "cache-dit",
    "spectrum",
}


def _load(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"expected a JSON object: {path}")
    return value


def _baseline_wall_ms(baseline: dict[str, Any], gpu_key: str) -> int:
    record = baseline[gpu_key]
    if "wall_ms_median" in record:
        return int(record["wall_ms_median"])
    return int(record["wall_ms"])


def evaluate(
    baseline: dict[str, Any], candidate: dict[str, Any]
) -> list[str]:
    failures: list[str] = []
    if candidate.get("schema_version") != 1:
        failures.append("candidate schema_version must be 1")
    if candidate.get("tests_passed") is not True:
        failures.append("repository and native tests did not pass")

    gpu_results = candidate.get("gpu_results")
    if not isinstance(gpu_results, dict):
        return failures + ["candidate gpu_results must be an object"]

    for gpu_key in GPU_KEYS:
        result = gpu_results.get(gpu_key)
        if not isinstance(result, dict):
            failures.append(f"missing GPU result: {gpu_key}")
            continue

        default = result.get("default")
        persistent = result.get("persistent")
        if not isinstance(default, dict):
            failures.append(f"{gpu_key}: missing default benchmark")
            continue
        if not isinstance(persistent, dict):
            failures.append(f"{gpu_key}: missing persistent benchmark")
            continue

        baseline_ms = _baseline_wall_ms(baseline, gpu_key)
        default_ms = int(default.get("wall_ms_median", 0))
        steady_ms = int(persistent.get("steady_state_wall_ms_median", 0))
        if default_ms <= 0:
            failures.append(f"{gpu_key}: default wall time is invalid")
        elif default_ms > round(baseline_ms * 1.03):
            failures.append(
                f"{gpu_key}: default path regressed beyond 3% "
                f"({default_ms} ms vs {baseline_ms} ms)"
            )
        if steady_ms <= 0:
            failures.append(f"{gpu_key}: persistent wall time is invalid")
        elif default_ms > 0 and steady_ms > round(default_ms * 0.95):
            failures.append(
                f"{gpu_key}: persistent steady-state gain is below 5% "
                f"({steady_ms} ms vs {default_ms} ms)"
            )

        if default.get("exact_output_match") is not True:
            failures.append(f"{gpu_key}: default output is not bit exact")
        if persistent.get("exact_output_match") is not True:
            failures.append(f"{gpu_key}: persistent output is not bit exact")

        peak_vram = int(result.get("peak_vram_mib", 0))
        memory_total = int(result.get("memory_total_mib", 0))
        if peak_vram <= 0 or memory_total <= 0 or peak_vram >= memory_total:
            failures.append(f"{gpu_key}: invalid or unsafe peak VRAM result")

        cache_profiles = result.get("cache_profiles")
        if not isinstance(cache_profiles, list):
            failures.append(f"{gpu_key}: cache_profiles must be a list")
            continue
        observed_modes = {
            str(profile.get("mode"))
            for profile in cache_profiles
            if isinstance(profile, dict)
            and profile.get("returncode") == 0
            and profile.get("images_valid") is True
        }
        missing_modes = sorted(REQUIRED_CACHE_MODES - observed_modes)
        if missing_modes:
            failures.append(
                f"{gpu_key}: unverified cache modes: {', '.join(missing_modes)}"
            )

    visual = candidate.get("visual_acceptance")
    if not isinstance(visual, dict):
        failures.append("missing visual_acceptance")
    else:
        for key in ("cat", "same_cat_suit_edit"):
            if visual.get(key) != "pass":
                failures.append(f"visual acceptance failed: {key}")

    return failures


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        failures = evaluate(_load(args.baseline), _load(args.candidate))
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"PERFORMANCE GOAL FAIL: {error}", file=sys.stderr)
        return 1
    if failures:
        print("PERFORMANCE GOAL FAIL", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("PERFORMANCE GOAL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
