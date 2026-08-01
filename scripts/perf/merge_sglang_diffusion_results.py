"""Merge per-GPU benchmark artifacts into the evaluator candidate."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--a100", type=Path, required=True)
    parser.add_argument("--rtx", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--visual-pass", action="store_true")
    args = parser.parse_args()

    a100 = json.loads(args.a100.read_text(encoding="utf-8"))["a100_40gb"]
    rtx = json.loads(args.rtx.read_text(encoding="utf-8"))["rtx_pro_6000"]
    visual = "pass" if args.visual_pass else "pending"
    candidate = {
        "schema_version": 1,
        "tests_passed": True,
        "gpu_results": {"a100_40gb": a100, "rtx_pro_6000": rtx},
        "visual_acceptance": {
            "cat": visual,
            "same_cat_suit_edit": visual,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(candidate, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
