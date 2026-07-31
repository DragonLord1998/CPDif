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


if __name__ == "__main__":
    unittest.main()
