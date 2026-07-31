import importlib.util
from pathlib import Path
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "colab" / "runtime_profile.py"
SPEC = importlib.util.spec_from_file_location("runtime_profile", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
RUNTIME_PROFILE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME_PROFILE)


class RuntimeProfileTests(unittest.TestCase):
    def test_auto_keeps_models_on_gpu_when_reserve_fits(self):
        self.assertEqual(
            "gpu",
            RUNTIME_PROFILE.select_profile("auto", 40960, 26000, 8192),
        )

    def test_auto_streams_when_model_and_reserve_do_not_fit(self):
        self.assertEqual(
            "stream",
            RUNTIME_PROFILE.select_profile("auto", 40960, 35000, 8192),
        )

    def test_explicit_profile_overrides_capacity_estimate(self):
        self.assertEqual(
            "gpu",
            RUNTIME_PROFILE.select_profile("gpu", 1000, 35000, 8192),
        )
        self.assertEqual(
            "stream",
            RUNTIME_PROFILE.select_profile("stream", 100000, 1000, 8192),
        )

    def test_model_size_rounds_up_to_mib(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory, "first.bin")
            second = Path(directory, "second.bin")
            first.write_bytes(b"a" * (RUNTIME_PROFILE.MIB + 1))
            second.write_bytes(b"b")
            self.assertEqual(2, RUNTIME_PROFILE.model_size_mib((first, second)))

    def test_rejects_unknown_profile(self):
        with self.assertRaises(ValueError):
            RUNTIME_PROFILE.select_profile("fastest", 40960, 26000, 8192)


if __name__ == "__main__":
    unittest.main()
