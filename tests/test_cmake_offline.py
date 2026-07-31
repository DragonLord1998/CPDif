import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CMAKE_LISTS = REPO_ROOT / "CMakeLists.txt"


def require_cmake_project(testcase):
    if not CMAKE_LISTS.exists():
        testcase.skipTest("root CMakeLists.txt has not landed yet")
    if shutil.which("cmake") is None:
        testcase.skipTest("cmake is not installed")


def configure_offline_build(testcase, build_dir):
    # These cache variables are the intended CPU/offline contract for the native
    # wrapper. CMake tolerates unused -D values while the root project settles.
    command = [
        "cmake",
        "-S",
        str(REPO_ROOT),
        "-B",
        str(build_dir),
        "-DCPDIF_BUILD_TESTS=ON",
        "-DCPDIF_ENABLE_CUDA=OFF",
        "-DCPDIF_OFFLINE=ON",
        "-DCMAKE_BUILD_TYPE=Release",
    ]
    result = subprocess.run(
        command,
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=120,
    )
    testcase.assertEqual(0, result.returncode, result.stdout)


class CMakeOfflineTests(unittest.TestCase):
    def test_configures_cpu_offline_build(self):
        """configures a CPU offline build without model weights or a GPU."""
        require_cmake_project(self)

        with tempfile.TemporaryDirectory(prefix="cpdif-cmake-") as tmpdir:
            configure_offline_build(self, Path(tmpdir) / "build")

    def test_registers_offline_tests_with_ctest(self):
        """registers at least one offline test in CTest."""
        require_cmake_project(self)

        with tempfile.TemporaryDirectory(prefix="cpdif-cmake-") as tmpdir:
            build_dir = Path(tmpdir) / "build"
            configure_offline_build(self, build_dir)
            result = subprocess.run(
                ["ctest", "--test-dir", str(build_dir), "-N"],
                cwd=REPO_ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=60,
            )

        self.assertEqual(0, result.returncode, result.stdout)
        self.assertNotIn("Total Tests: 0", result.stdout)

    def test_builds_offline_test_targets(self):
        """builds offline test targets in the CPU configuration."""
        require_cmake_project(self)

        with tempfile.TemporaryDirectory(prefix="cpdif-cmake-") as tmpdir:
            build_dir = Path(tmpdir) / "build"
            configure_offline_build(self, build_dir)
            result = subprocess.run(
                ["cmake", "--build", str(build_dir), "--parallel", "2"],
                cwd=REPO_ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=300,
            )

        self.assertEqual(0, result.returncode, result.stdout)


if __name__ == "__main__":
    unittest.main()
