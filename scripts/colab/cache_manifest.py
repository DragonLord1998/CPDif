"""Create and validate a hardware/toolchain manifest for a GPU build cache."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def output(*args: str, cwd: Path | None = None) -> str:
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def cuda_architecture(compute_capability: str) -> str:
    architecture = compute_capability.replace(".", "").strip()
    if not architecture.isdigit():
        raise ValueError(f"invalid compute capability: {compute_capability!r}")
    return architecture


def live_manifest(
    repo_dir: Path,
    work_dir: Path,
    build_dir: Path,
    cuda_architectures: str,
) -> dict[str, object]:
    upstream_dir = work_dir / "upstream" / "stable-diffusion.cpp"
    gpu_fields = output(
        "nvidia-smi",
        "--query-gpu=name,memory.total,compute_cap,driver_version",
        "--format=csv,noheader,nounits",
    ).split(",")
    if len(gpu_fields) != 4:
        raise ValueError("expected exactly one GPU from nvidia-smi")
    return {
        "schema_version": 2,
        "project_commit": output("git", "rev-parse", "HEAD", cwd=repo_dir),
        "upstream_commit": output("git", "rev-parse", "HEAD", cwd=upstream_dir),
        "repo_dir": str(repo_dir),
        "work_dir": str(work_dir),
        "build_dir_name": build_dir.name,
        "cuda_architectures": cuda_architectures,
        "gpu_name": gpu_fields[0].strip(),
        "gpu_memory_mib": int(gpu_fields[1].strip()),
        "compute_capability": gpu_fields[2].strip(),
        "driver_version": gpu_fields[3].strip(),
        "nvcc": output("nvcc", "--version").splitlines()[-1],
        "gcc": output("gcc", "-dumpfullversion", "-dumpversion"),
        "cmake": output("cmake", "--version").splitlines()[0],
    }


def create(args: argparse.Namespace) -> int:
    manifest = live_manifest(
        args.repo_dir,
        args.work_dir,
        args.build_dir,
        args.cuda_architectures,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(args.output)
    return 0


def validate(args: argparse.Namespace) -> int:
    saved = json.loads(args.manifest.read_text(encoding="utf-8"))
    schema_version = int(saved.get("schema_version", 0))
    legacy_a100 = schema_version == 1
    saved_architectures = str(saved.get("cuda_architectures", "80"))
    saved_build_name = str(saved.get("build_dir_name", "build-a100"))
    live = live_manifest(
        args.repo_dir,
        args.work_dir,
        args.work_dir / saved_build_name,
        saved_architectures,
    )
    if legacy_a100:
        live["schema_version"] = 1
        live.pop("build_dir_name", None)
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
    if not legacy_a100:
        exact_fields += ("build_dir_name",)
    mismatches = [
        f"{field}: saved={saved.get(field)!r} live={live.get(field)!r}"
        for field in exact_fields
        if saved.get(field) != live.get(field)
    ]
    live_architecture = cuda_architecture(str(live["compute_capability"]))
    if live_architecture != saved_architectures:
        mismatches.append(
            f"GPU architecture mismatch: cache=sm{saved_architectures} live=sm{live_architecture}"
        )
    if legacy_a100:
        if not (39000 <= int(live["gpu_memory_mib"]) <= 42000):
            mismatches.append(
                f"legacy cache requires A100 40GB: {live['gpu_memory_mib']} MiB"
            )
        if "A100" not in str(live["gpu_name"]):
            mismatches.append(f"legacy cache requires A100: {live['gpu_name']}")

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
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument("--cuda-architectures")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    if args.action == "create" and args.output is None:
        parser.error("create requires --output")
    if args.action == "create" and args.build_dir is None:
        parser.error("create requires --build-dir")
    if args.action == "create" and args.cuda_architectures is None:
        parser.error("create requires --cuda-architectures")
    if args.action == "validate" and args.manifest is None:
        parser.error("validate requires --manifest")
    return args


if __name__ == "__main__":
    arguments = parse_args()
    raise SystemExit(create(arguments) if arguments.action == "create" else validate(arguments))
