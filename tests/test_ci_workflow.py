import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"


class CIWorkflowTests(unittest.TestCase):
    def test_ci_workflow_exists(self):
        """provides a Linux CPU offline CI workflow."""
        self.assertTrue(WORKFLOW.is_file())

    def test_ci_forces_cuda_off(self):
        """configures CI with CUDA disabled."""
        workflow_text = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("CPDIF_ENABLE_CUDA=OFF", workflow_text)

    def test_ci_runs_python_offline_contract_tests(self):
        """runs Python offline contract tests before native build checks."""
        workflow_text = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("python -m unittest discover -s tests", workflow_text)


if __name__ == "__main__":
    unittest.main()
