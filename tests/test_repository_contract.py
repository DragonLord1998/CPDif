import os
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


class RepositoryContractTests(unittest.TestCase):
    def test_does_not_commit_model_weight_artifacts(self):
        """keeps model weights out of the repository."""
        forbidden_suffixes = {
            ".safetensors",
            ".ckpt",
            ".pt",
            ".pth",
            ".onnx",
            ".bin",
            ".gguf",
        }
        ignored_roots = {".git", ".omx"}

        committed_weight_paths = []
        for root, dirs, files in os.walk(REPO_ROOT):
            dirs[:] = [name for name in dirs if name not in ignored_roots]
            for filename in files:
                path = Path(root, filename)
                if path.suffix.lower() in forbidden_suffixes:
                    committed_weight_paths.append(path.relative_to(REPO_ROOT))

        self.assertEqual([], committed_weight_paths)

    def test_has_native_build_entrypoint_when_source_tree_exists(self):
        """requires a root CMake entrypoint after native sources are added."""
        source_dir = REPO_ROOT / "src"
        if not source_dir.exists():
            self.skipTest("native source tree has not landed yet")

        self.assertTrue((REPO_ROOT / "CMakeLists.txt").is_file())

    def test_klein_kv_assets_are_pinned(self):
        patch = REPO_ROOT / "patches" / "stable-diffusion-klein-kv-cache.patch"
        downloader = REPO_ROOT / "scripts" / "model" / "download_kv_q8_transformer.sh"
        self.assertTrue(patch.is_file())
        patch_text = patch.read_text(encoding="utf-8")
        self.assertIn("klein_kv_cache", patch_text)
        self.assertIn("img_mod1.shift->ne[1] == img_modulated->ne[1]", patch_text)
        self.assertIn("mod.shift->ne[1] == x->ne[1]", patch_text)
        self.assertNotIn("ggml_n_dims(img_mod1.shift)", patch_text)
        download_text = downloader.read_text(encoding="utf-8")
        self.assertIn("QuantStack/FLUX.2-Klein-9B-KV-GGUF", download_text)
        self.assertIn(
            "94d7a02ac18b50b2c751c6e2ee82c53a338ab233338700330a7797b6c959e397",
            download_text,
        )

    def test_gpu_release_cache_contract_is_versioned(self):
        restore = REPO_ROOT / "scripts" / "colab" / "10_restore_release_cache.sh"
        restore_text = restore.read_text(encoding="utf-8")
        self.assertIn("gpu-build-cache-v3", restore_text)
        self.assertIn("cpdif-gpu-build-cache-v3-sm", restore_text)
        self.assertIn("05_restore_cache.sh", restore_text)


if __name__ == "__main__":
    unittest.main()
