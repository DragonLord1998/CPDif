import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = REPO_ROOT / "scripts" / "colab" / "validate_smoke.py"
SPEC = importlib.util.spec_from_file_location("validate_smoke", VALIDATOR_PATH)
VALIDATOR = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(VALIDATOR)


class SmokeValidatorTests(unittest.TestCase):
    def write_fixture(self, directory, width=64, height=64):
        image_path = Path(directory, "output.png")
        telemetry_path = Path(directory, "output.json")
        image_path.write_bytes(
            b"\x89PNG\r\n\x1a\n"
            + struct.pack(">I", 13)
            + b"IHDR"
            + struct.pack(">II", width, height)
            + b"\x08\x02\x00\x00\x00"
        )
        telemetry_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "engine": "cpdif-sdcpp",
                    "mode": "text-to-image",
                    "backend": "test",
                    "width": width,
                    "height": height,
                    "steps": 4,
                    "seed": 42,
                    "rng": "cpu",
                    "parameter_residency": "cuda",
                    "stream_layers": False,
                    "max_vram": "0",
                    "load_ms": 1,
                    "generation_ms": 2,
                    "output": str(image_path),
                }
            ),
            encoding="utf-8",
        )
        return image_path, telemetry_path

    def test_accepts_matching_png_header_and_telemetry(self):
        with tempfile.TemporaryDirectory(prefix="cpdif-smoke-") as directory:
            image, telemetry = self.write_fixture(directory)
            VALIDATOR.validate(image, telemetry, 64, 64)

    def test_rejects_dimension_mismatch(self):
        with tempfile.TemporaryDirectory(prefix="cpdif-smoke-") as directory:
            image, telemetry = self.write_fixture(directory)
            with self.assertRaisesRegex(ValueError, "unexpected PNG size"):
                VALIDATOR.validate(image, telemetry, 128, 64)


if __name__ == "__main__":
    unittest.main()
