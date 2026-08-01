import importlib.util
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "perf" / "evaluate_sglang_diffusion.py"
SPEC = importlib.util.spec_from_file_location("evaluate_sglang_diffusion", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
EVALUATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVALUATOR)


def baseline():
    return {
        "a100_40gb": {"wall_ms": 26630},
        "rtx_pro_6000": {"wall_ms_median": 10730},
    }


def passing_candidate():
    cache_profiles = [
        {"mode": mode, "returncode": 0, "images_valid": True}
        for mode in EVALUATOR.REQUIRED_CACHE_MODES
    ]
    return {
        "schema_version": 1,
        "tests_passed": True,
        "gpu_results": {
            "a100_40gb": {
                "default": {"wall_ms_median": 26630, "exact_output_match": True},
                "persistent": {
                    "steady_state_wall_ms_median": 25000,
                    "exact_output_match": True,
                },
                "peak_vram_mib": 30000,
                "memory_total_mib": 40960,
                "cache_profiles": cache_profiles,
            },
            "rtx_pro_6000": {
                "default": {"wall_ms_median": 10730, "exact_output_match": True},
                "persistent": {
                    "steady_state_wall_ms_median": 10000,
                    "exact_output_match": True,
                },
                "peak_vram_mib": 30000,
                "memory_total_mib": 97887,
                "cache_profiles": cache_profiles,
            },
        },
        "visual_acceptance": {"cat": "pass", "same_cat_suit_edit": "pass"},
    }


class PerformanceEvaluatorTests(unittest.TestCase):
    def test_accepts_complete_candidate(self):
        self.assertEqual([], EVALUATOR.evaluate(baseline(), passing_candidate()))

    def test_rejects_latency_regression_and_missing_cache_mode(self):
        candidate = passing_candidate()
        candidate["gpu_results"]["rtx_pro_6000"]["default"]["wall_ms_median"] = 12000
        candidate["gpu_results"]["rtx_pro_6000"]["cache_profiles"].pop()
        failures = EVALUATOR.evaluate(baseline(), candidate)
        self.assertTrue(any("regressed" in failure for failure in failures))
        self.assertTrue(any("unverified cache modes" in failure for failure in failures))

    def test_rejects_non_exact_persistent_outputs(self):
        candidate = passing_candidate()
        candidate["gpu_results"]["a100_40gb"]["persistent"]["exact_output_match"] = False
        failures = EVALUATOR.evaluate(baseline(), candidate)
        self.assertIn("a100_40gb: persistent output is not bit exact", failures)


if __name__ == "__main__":
    unittest.main()
