import importlib.util
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "colab" / "sglang_diffusion_benchmark.py"
SPEC = importlib.util.spec_from_file_location("sglang_diffusion_benchmark", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
BENCHMARK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BENCHMARK)


class SGLangDiffusionBenchmarkTests(unittest.TestCase):
    def test_cache_modes_match_evaluator_contract(self):
        self.assertEqual(
            {"easycache", "dbcache", "taylorseer", "cache-dit", "spectrum"},
            set(BENCHMARK.CACHE_MODES),
        )

    def test_cache_dit_uses_short_distilled_model_warmup(self):
        args = BENCHMARK.cache_args("cache-dit")
        self.assertIn("--cache-warmup", args)
        self.assertEqual("1", args[args.index("--cache-warmup") + 1])

    def test_spectrum_uses_short_warmup(self):
        args = BENCHMARK.cache_args("spectrum")
        self.assertEqual("1", args[args.index("--spectrum-warmup") + 1])


if __name__ == "__main__":
    unittest.main()
