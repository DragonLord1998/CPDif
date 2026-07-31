"""Create and validate a hardware/toolchain manifest for an A100 build cache."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def output(*args: str, cwd: Path | None = None) -> str:
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def live_manifest(repo_dir: Path, work_dir: Path) -> dict[str, object]:
    upstream_dir = work_dir / "upstream" / "stable-diffusion.cpp"
    gpu_fields = output(
        "nvidia-smi",
        "--query-gpu=name,memory.total,compute_cap,driver_version",
        "--format=csv,noheader,nounits",
    ).split(",")
    if len(gpu_fields) != 4:
        raise ValueError("expected exactly one GPU from nvidia-smi")
    return {
        "schema_version": 1,
        "project_commit": output("git", "rev-parse", "HEAD", cwd=repo_dir),
        "upstream_commit": output("git", "rev-parse", "HEAD", cwd=upstream_dir),
        "repo_dir": str(repo_dir),
        "work_dir": str(work_dir),
        "cuda_architectures": "80",
        "gpu_name": gpu_fields[0].strip(),
        "gpu_memory_mib": int(gpu_fields[1].strip()),
        "compute_capability": gpu_fields[2].strip(),
        "driver_version": gpu_fields[3].strip(),
        "nvcc": output("nvcc", "--version").splitlines()[-1],
        "gcc": output("gcc", "-dumpfullversion", "-dumpversion"),
        "cmake": output("cmake", "--version").splitlines()[0],
    }


def create(args: argparse.Namespace) -> int:
    manifest = live_manifest(args.repo_dir, args.work_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(args.output)
    return 0


def validate(args: argparse.Namespace) -> int:
    saved = json.loads(args.manifest.read_text(encoding="utf-8"))
    live = live_manifest(args.repo_dir, args.work_dir)
    exact_fields = (
        "schema_version",
        "upstream_commit",
        "repo_dir",
        "work_dir",
        "cuda_architectures",
        "compute_capability",
        "nvcc",
        "gcc",
        "cmake",
    )
    mismatches = [
        f"{field}: saved={saved.get(field)!r} live={live.get(field)!r}"
        for field in exact_fields
        if saved.get(field) != live.get(field)
    ]
    if not (39000 <= int(live["gpu_memory_mib"]) <= 42000):
        mismatches.append(f"GPU memory is not A100 40GB: {live['gpu_memory_mib']} MiB")
    if "A100" not in str(live["gpu_name"]):
        mismatches.append(f"GPU is not A100: {live['gpu_name']}")

    saved_commit = str(saved.get("project_commit", ""))
    ancestor = subprocess.run(
        ["git", "merge-base", "--is-ancestor", saved_commit, "HEAD"],
        cwd=args.repo_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if ancestor.returncode != 0:
        mismatches.append(
            f"cache project commit {saved_commit!r} is not an ancestor of the current checkout"
        )

    if mismatches:
        print("Cache manifest is incompatible:", file=sys.stderr)
        for mismatch in mismatches:
            print(f"- {mismatch}", file=sys.stderr)
        return 1
    print("Cache manifest is compatible")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("create", "validate"))
    parser.add_argument("--repo-dir", type=Path, default=Path("/content/CPDif"))
    parser.add_argument("--work-dir", type=Path, default=Path("/content/cpdif-work"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    if args.action == "create" and args.output is None:
        parser.error("create requires --output")
    if args.action == "validate" and args.manifest is None:
        parser.error("validate requires --manifest")
    return args


if __name__ == "__main__":
    arguments = parse_args()
    raise SystemExit(create(arguments) if arguments.action == "create" else validate(arguments))
