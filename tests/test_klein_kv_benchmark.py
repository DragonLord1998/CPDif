import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
COLAB_DIR = REPO_ROOT / "scripts" / "colab"
MODULE_PATH = COLAB_DIR / "klein_kv_benchmark.py"
sys.path.insert(0, str(COLAB_DIR))
SPEC = importlib.util.spec_from_file_location("klein_kv_benchmark", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
KLEIN_KV = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(KLEIN_KV)


class KleinKvBenchmarkTests(unittest.TestCase):
    def test_reports_speedup_and_latency_reduction(self):
        self.assertEqual((1.25, 20.0), KLEIN_KV.performance_delta(1000, 800))

    def test_rejects_non_positive_latency(self):
        with self.assertRaises(ValueError):
            KLEIN_KV.performance_delta(1000, 0)

    def test_requires_kv_cache_telemetry_to_be_true(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "telemetry.json"
            path.write_text(json.dumps({"klein_kv_cache": True}), encoding="utf-8")
            self.assertTrue(KLEIN_KV.telemetry_kv_cache_enabled(path))
            path.write_text(json.dumps({"klein_kv_cache": False}), encoding="utf-8")
            self.assertFalse(KLEIN_KV.telemetry_kv_cache_enabled(path))

    def test_sums_only_one_telemetry_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "telemetry.json"
            path.write_text(
                json.dumps(
                    {
                        "load_ms": 0,
                        "reference_load_ms": 12,
                        "generation_ms": 800,
                        "image_write_ms": 20,
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(832, KLEIN_KV.telemetry_stage_ms(path))


if __name__ == "__main__":
    unittest.main()
