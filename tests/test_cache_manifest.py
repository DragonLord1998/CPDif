import argparse
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "colab" / "cache_manifest.py"
SPEC = importlib.util.spec_from_file_location("cache_manifest", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
CACHE_MANIFEST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CACHE_MANIFEST)


class CacheManifestTests(unittest.TestCase):
    def compatible_manifest(self):
        return {
            "schema_version": 3,
            "project_commit": "abc123",
            "upstream_commit": "def456",
            "upstream_patch_sha256": "patch-a",
            "repo_dir": "/content/CPDif",
            "work_dir": "/content/cpdif-work",
            "build_dir_name": "build-sm120",
            "cuda_architectures": "120",
            "gpu_name": "NVIDIA RTX PRO 6000 Blackwell Server Edition",
            "gpu_memory_mib": 97887,
            "compute_capability": "12.0",
            "driver_version": "575.57.08",
            "nvcc": "Cuda compilation tools, release 12.8",
            "gcc": "12.2.0",
            "cmake": "cmake version 3.31.6",
        }

    def validate_manifest(self, saved, live):
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "manifest.json"
            manifest_path.write_text(json.dumps(saved), encoding="utf-8")
            args = argparse.Namespace(
                manifest=manifest_path,
                repo_dir=Path("/content/CPDif"),
                work_dir=Path("/content/cpdif-work"),
            )
            with (
                mock.patch.object(CACHE_MANIFEST, "live_manifest", return_value=live),
                mock.patch.object(
                    CACHE_MANIFEST.subprocess,
                    "run",
                    return_value=argparse.Namespace(returncode=0),
                ),
                redirect_stdout(io.StringIO()),
                redirect_stderr(io.StringIO()),
            ):
                return CACHE_MANIFEST.validate(args)

    def test_converts_compute_capability_to_cuda_architecture(self):
        self.assertEqual("80", CACHE_MANIFEST.cuda_architecture("8.0"))
        self.assertEqual("120", CACHE_MANIFEST.cuda_architecture("12.0"))

    def test_rejects_invalid_compute_capability(self):
        with self.assertRaises(ValueError):
            CACHE_MANIFEST.cuda_architecture("Blackwell")

    def test_hashes_the_upstream_patch_for_cache_invalidation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "patch.diff"
            path.write_bytes(b"stable-diffusion patch\n")
            self.assertEqual(
                hashlib.sha256(b"stable-diffusion patch\n").hexdigest(),
                CACHE_MANIFEST.sha256_file(path),
            )

    def test_accepts_matching_patch_hash(self):
        manifest = self.compatible_manifest()
        self.assertEqual(0, self.validate_manifest(manifest, dict(manifest)))

    def test_rejects_changed_patch_hash(self):
        saved = self.compatible_manifest()
        live = dict(saved)
        live["upstream_patch_sha256"] = "patch-b"
        self.assertEqual(1, self.validate_manifest(saved, live))

    def test_rejects_pre_patch_schema_two_cache(self):
        saved = self.compatible_manifest()
        saved["schema_version"] = 2
        saved.pop("upstream_patch_sha256")
        self.assertEqual(1, self.validate_manifest(saved, self.compatible_manifest()))


if __name__ == "__main__":
    unittest.main()
