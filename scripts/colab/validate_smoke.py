"""Validate CPDif's generated PNG header and telemetry contract."""

from __future__ import annotations

import json
from pathlib import Path
import struct
import sys
from typing import Optional


def validate(
    image_path: Path,
    telemetry_path: Path,
    expected_width: int,
    expected_height: int,
    expected_mode: Optional[str] = None,
) -> None:
    with image_path.open("rb") as image:
        signature = image.read(8)
        if signature != b"\x89PNG\r\n\x1a\n":
            raise ValueError(f"invalid PNG signature: {image_path}")
        ihdr_length = struct.unpack(">I", image.read(4))[0]
        ihdr_type = image.read(4)
        if ihdr_length != 13 or ihdr_type != b"IHDR":
            raise ValueError(f"missing PNG IHDR: {image_path}")
        width, height = struct.unpack(">II", image.read(8))

    if (width, height) != (expected_width, expected_height):
        raise ValueError(
            f"unexpected PNG size {width}x{height}; expected "
            f"{expected_width}x{expected_height}"
        )

    with telemetry_path.open("r", encoding="utf-8") as telemetry_file:
        telemetry = json.load(telemetry_file)

    required = {
        "schema_version",
        "engine",
        "mode",
        "session_request_index",
        "backend",
        "width",
        "height",
        "steps",
        "seed",
        "rng",
        "cache_mode",
        "cache",
        "parameter_residency",
        "stream_layers",
        "max_vram",
        "load_ms",
        "context_reused",
        "reference_load_ms",
        "generation_ms",
        "image_write_ms",
        "output",
    }
    missing = sorted(required.difference(telemetry))
    if missing:
        raise ValueError(f"telemetry is missing fields: {', '.join(missing)}")
    if (telemetry["width"], telemetry["height"]) != (expected_width, expected_height):
        raise ValueError("telemetry dimensions do not match the PNG")
    if telemetry["engine"] != "cpdif-sdcpp":
        raise ValueError(f"unexpected telemetry engine: {telemetry['engine']}")
    if expected_mode is not None and telemetry["mode"] != expected_mode:
        raise ValueError(
            f"unexpected telemetry mode: {telemetry['mode']}; expected {expected_mode}"
        )


def main(argv: list[str]) -> int:
    if len(argv) not in (5, 6):
        print(
            "usage: validate_smoke.py IMAGE TELEMETRY WIDTH HEIGHT [MODE]",
            file=sys.stderr,
        )
        return 2
    try:
        validate(
            Path(argv[1]),
            Path(argv[2]),
            int(argv[3]),
            int(argv[4]),
            argv[5] if len(argv) == 6 else None,
        )
    except (OSError, ValueError, json.JSONDecodeError, struct.error) as error:
        print(f"smoke validation failed: {error}", file=sys.stderr)
        return 1
    print(f"Validated PNG and telemetry: {argv[3]}x{argv[4]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
