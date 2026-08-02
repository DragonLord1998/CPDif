import importlib.util
import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATOR_PATH = REPO_ROOT / "scripts" / "colab" / "create_ui_notebook.py"
NOTEBOOK_PATH = REPO_ROOT / "notebooks" / "CPDif_Klein_9B_UI_Colab.ipynb"


def load_generator():
    spec = importlib.util.spec_from_file_location("create_ui_notebook", GENERATOR_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ColabUiNotebookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.generator = load_generator()
        cls.notebook = json.loads(NOTEBOOK_PATH.read_text(encoding="utf-8"))
        cls.sources = ["".join(cell["source"]) for cell in cls.notebook["cells"]]

    def test_generated_notebook_is_current(self):
        self.assertEqual(
            self.generator.render_notebook(),
            NOTEBOOK_PATH.read_text(encoding="utf-8"),
        )

    def test_notebook_has_exactly_two_compilable_code_cells(self):
        self.assertEqual(2, len(self.notebook["cells"]))
        self.assertEqual(["code", "code"], [cell["cell_type"] for cell in self.notebook["cells"]])
        for index, source in enumerate(self.sources, start=1):
            compile(source, f"notebook-cell-{index}", "exec")

    def test_first_cell_reserves_and_validates_colab_proxy(self):
        source = self.sources[0]
        self.assertIn("google.colab.kernel.proxyPort", source)
        self.assertIn("google.colab.kernel.accessAllowed", source)
        self.assertIn("prod.colab.dev", source)
        self.assertIn("colab.googleusercontent.com", source)
        self.assertIn("CPDIF_PROXY_URL", source)

    def test_second_cell_pins_fastest_build_and_restores_public_cache(self):
        source = self.sources[1]
        self.assertIn(self.generator.CPDIF_REPOSITORY, source)
        self.assertIn(self.generator.CPDIF_REVISION, source)
        self.assertIn('architecture not in {"80", "120"}', source)
        self.assertIn("10_restore_release_cache.sh", source)
        self.assertIn("02_build_cuda.sh", source)
        self.assertIn('"--unshallow", "--filter=blob:none"', source)
        self.assertNotIn('"--depth", "1"', source)
        self.assertIn("Release cache restore failed; continuing with a source build", source)
        self.assertIn("check=False", source)
        self.assertIn("download_kv_q8_transformer.sh", source)
        self.assertIn('aux_model_env["MODEL_COMPONENTS"] = "text_encoder,vae"', source)

    def test_second_cell_starts_node_ui_without_a_shell_and_waits_for_readiness(self):
        source = self.sources[1]
        self.assertIn('["npm", "start"]', source)
        self.assertIn('"CPDIF_UI_HOST": "127.0.0.1"', source)
        self.assertIn('"CPDIF_UI_MAX_VRAM": "8" if architecture == "80" else ""', source)
        self.assertIn("/api/status", source)
        self.assertIn("serve_kernel_port_as_iframe", source)
        self.assertNotIn("shell=True", source)
        self.assertNotIn("cloudflare", source.lower())

    def test_notebook_does_not_print_or_pass_hugging_face_token_on_command_line(self):
        source = self.sources[1]
        self.assertIn('userdata.get("HF_TOKEN")', source)
        self.assertIn('build_env["HF_TOKEN"] = hf_token', source)
        self.assertNotIn("print(hf_token", source)
        self.assertNotIn("--token", source)


if __name__ == "__main__":
    unittest.main()
