import importlib.util
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "colab" / "benchmark_runtime.py"
SPEC = importlib.util.spec_from_file_location("benchmark_runtime", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
BENCHMARK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BENCHMARK)


class BenchmarkRuntimeTests(unittest.TestCase):
    def test_parses_peak_gpu_samples(self):
        samples = BENCHMARK.parse_samples(
            "2026/07/31 12:00:00, 1024, 50, 100.5\n"
            "2026/07/31 12:00:00, 29662, 100, 281.0\n"
        )
        self.assertEqual(2, samples["sample_count"])
        self.assertEqual(29662, samples["peak_vram_mib"])
        self.assertEqual(100, samples["peak_gpu_utilization_percent"])
        self.assertEqual(281.0, samples["peak_power_w"])

    def test_rejects_empty_sample_set(self):
        with self.assertRaises(ValueError):
            BENCHMARK.parse_samples("")


if __name__ == "__main__":
    unittest.main()
