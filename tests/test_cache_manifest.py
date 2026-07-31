import importlib.util
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "colab" / "cache_manifest.py"
SPEC = importlib.util.spec_from_file_location("cache_manifest", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
CACHE_MANIFEST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CACHE_MANIFEST)


class CacheManifestTests(unittest.TestCase):
    def test_converts_compute_capability_to_cuda_architecture(self):
        self.assertEqual("80", CACHE_MANIFEST.cuda_architecture("8.0"))
        self.assertEqual("120", CACHE_MANIFEST.cuda_architecture("12.0"))

    def test_rejects_invalid_compute_capability(self):
        with self.assertRaises(ValueError):
            CACHE_MANIFEST.cuda_architecture("Blackwell")


if __name__ == "__main__":
    unittest.main()
