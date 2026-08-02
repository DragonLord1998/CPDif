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
        self.assertIn("cache_tensor_persistent", patch_text)
        self.assertIn("persistent_cache_tensor_names", patch_text)
        self.assertIn("persistent_cache_buffer", patch_text)
        self.assertIn("copy_pending_persistent_cache_tensors", patch_text)
        self.assertIn("clear_persistent_cache_tensors", patch_text)
        self.assertIn("ggml_set_output(reference_k)", patch_text)
        self.assertIn("ggml_set_output(reference_v)", patch_text)
        self.assertIn("ggml_tensor* q_main = q;", patch_text)
        self.assertIn(
            "k_all        = ggml_concat(ctx->ggml_ctx, k, reference_k, 1);",
            patch_text,
        )
        self.assertIn(
            "v_all        = ggml_concat(ctx->ggml_ctx, v, reference_v, 2);",
            patch_text,
        )
        self.assertNotIn(
            "auto k_text  = token_view_3d(ctx->ggml_ctx, k, 0, text_tokens);",
            patch_text,
        )
        self.assertNotIn(
            "auto v_text  = token_view_4d(ctx->ggml_ctx, v, 0, text_tokens);",
            patch_text,
        )
        self.assertNotIn('mark_graph_cut(reference_k, cache_group, "klein_kv_k")', patch_text)
        self.assertNotIn('mark_graph_cut(reference_v, cache_group, "klein_kv_v")', patch_text)
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
        self.assertIn("gpu-build-cache-v4", restore_text)
        self.assertIn("cpdif-gpu-build-cache-v4-sm", restore_text)
        self.assertIn("05_restore_cache.sh", restore_text)

    def test_node_ui_wraps_the_exact_kv_backend_without_a_shell(self):
        package = REPO_ROOT / "ui" / "package.json"
        runtime = REPO_ROOT / "ui" / "lib" / "runtime.mjs"
        server = REPO_ROOT / "ui" / "server.mjs"
        self.assertTrue(package.is_file())
        self.assertTrue(server.is_file())
        runtime_text = runtime.read_text(encoding="utf-8")
        self.assertIn('"--klein-kv-cache"', runtime_text)
        self.assertIn('"--no-offload-to-cpu"', runtime_text)
        self.assertIn("shell: false", runtime_text)
        self.assertNotIn("exec(", runtime_text)


if __name__ == "__main__":
    unittest.main()
