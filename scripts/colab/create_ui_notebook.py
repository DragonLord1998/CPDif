#!/usr/bin/env python3
"""Generate the public two-cell CPDif Colab UI launcher."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = REPO_ROOT / "notebooks" / "CPDif_Klein_9B_UI_Colab.ipynb"
CPDIF_REPOSITORY = "https://github.com/DragonLord1998/CPDif.git"
CPDIF_REVISION = "9a9b53dc2c4276dc552cf237af08b2aff0a19511"
UI_PORT = 4173


CELL_1 = f'''# Cell 1/2 - Reserve this runtime's private Colab proxy URL.
from urllib.parse import urlparse

from google.colab import output

CPDIF_UI_PORT = {UI_PORT}


def _validate_colab_proxy_url(value):
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
        or "?" in value
        or "#" in value
    ):
        raise RuntimeError("Colab returned an invalid proxy URL.")
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    trusted_host = any(
        hostname.endswith(f".{{suffix}}") and hostname != suffix
        for suffix in ("prod.colab.dev", "colab.googleusercontent.com")
    )
    try:
        trusted_port = parsed.port in {{None, 443}}
    except ValueError:
        trusted_port = False
    if (
        parsed.scheme != "https"
        or not trusted_host
        or not trusted_port
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {{"", "/"}}
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("Colab returned an untrusted proxy URL.")
    return f"https://{{hostname}}/"


def _reserve_colab_proxy(port):
    value = output.eval_js(
        f"""
(async () => {{{{
  if (!google.colab.kernel.accessAllowed) {{{{
    throw new Error("Allow this notebook to access the Colab runtime first.");
  }}}}
  const proxy = await google.colab.kernel.proxyPort({{port}});
  return new URL("/", proxy).toString();
}}}})()
""",
        timeout_sec=30,
    )
    return _validate_colab_proxy_url(value)


CPDIF_PROXY_URL = _reserve_colab_proxy(CPDIF_UI_PORT)
print("Reserved the session-bound CPDif URL:")
print(CPDIF_PROXY_URL)
print("Run Cell 2 to restore the GPU build, download the models, and start the UI.")
'''


CELL_2 = f'''# Cell 2/2 - Restore the fastest validated build, download models, and start the UI.
import html
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from google.colab import output
from IPython.display import HTML, display

CPDIF_REPOSITORY = "{CPDIF_REPOSITORY}"
CPDIF_REVISION = "{CPDIF_REVISION}"
CPDIF_REPO_DIR = Path("/content/CPDif")
CPDIF_WORKDIR = Path("/content/cpdif-work")
CPDIF_UI_PORT = {UI_PORT}
CPDIF_UI_LOG = CPDIF_WORKDIR / "cpdif-ui.log"
CPDIF_UI_PID = CPDIF_WORKDIR / "cpdif-ui.pid"
CPDIF_PROMPT_ASSISTANT_MODEL = "lukey03/qwen3.5-9b-abliterated-vision"
CPDIF_PROMPT_SETUP_LOG = CPDIF_WORKDIR / "qwen-prompt-assistant-setup.log"
CPDIF_OLLAMA_LOG = CPDIF_WORKDIR / "ollama.log"


def run(command, *, cwd=None, env=None):
    print("+", " ".join(str(part) for part in command), flush=True)
    subprocess.run(
        [str(part) for part in command],
        cwd=None if cwd is None else str(cwd),
        env=env,
        check=True,
    )


def command_output(command):
    return subprocess.check_output([str(part) for part in command], text=True).strip()


def node_major_version():
    try:
        value = command_output(["node", "--version"]).lstrip("v")
        return int(value.split(".", 1)[0])
    except (FileNotFoundError, subprocess.CalledProcessError, ValueError):
        return 0


def install_node_if_needed():
    if node_major_version() >= 20:
        print("Node", command_output(["node", "--version"]), "is ready.")
        return
    setup_path = Path("/tmp/nodesource_setup_22.sh")
    print("Installing Node 22 for the CPDif UI...")
    urllib.request.urlretrieve("https://deb.nodesource.com/setup_22.x", setup_path)
    run(["bash", setup_path])
    run(["apt-get", "install", "-y", "nodejs"])
    if node_major_version() < 20:
        raise RuntimeError("Node 20 or newer is required to start the CPDif UI.")


def detect_cuda_architecture():
    raw = command_output(
        ["nvidia-smi", "--query-gpu=compute_cap", "--format=csv,noheader,nounits"]
    )
    architectures = {{line.strip().replace(".", "") for line in raw.splitlines() if line.strip()}}
    if len(architectures) != 1:
        raise RuntimeError(f"Expected one CUDA architecture, found: {{sorted(architectures)}}")
    architecture = architectures.pop()
    if architecture not in {{"80", "120"}}:
        raise RuntimeError(
            f"This launcher has validated release caches only for A100 sm80 and "
            f"RTX PRO 6000 sm120; the attached GPU reports sm{{architecture}}."
        )
    return architecture


def prepare_repository():
    if CPDIF_REPO_DIR.exists():
        if not (CPDIF_REPO_DIR / ".git").is_dir():
            raise RuntimeError(
                f"{{CPDIF_REPO_DIR}} exists but is not a Git checkout. "
                "Rename it or reconnect the runtime before rerunning this cell."
            )
        remote = command_output(["git", "-C", CPDIF_REPO_DIR, "remote", "get-url", "origin"])
        if remote.rstrip("/").removesuffix(".git") != CPDIF_REPOSITORY.rstrip("/").removesuffix(".git"):
            raise RuntimeError(f"Refusing to replace checkout with unexpected origin: {{remote}}")
    else:
        run(["git", "clone", "--filter=blob:none", "--no-checkout", CPDIF_REPOSITORY, CPDIF_REPO_DIR])
    shallow = command_output(
        ["git", "-C", CPDIF_REPO_DIR, "rev-parse", "--is-shallow-repository"]
    )
    if shallow == "true":
        print("Restoring Git ancestry required by release-cache validation...")
        run(["git", "-C", CPDIF_REPO_DIR, "fetch", "--unshallow", "--filter=blob:none", "origin"])
    run(["git", "-C", CPDIF_REPO_DIR, "fetch", "--filter=blob:none", "origin", CPDIF_REVISION])
    run(["git", "-C", CPDIF_REPO_DIR, "checkout", "--detach", "--force", CPDIF_REVISION])
    actual = command_output(["git", "-C", CPDIF_REPO_DIR, "rev-parse", "HEAD"])
    if actual != CPDIF_REVISION:
        raise RuntimeError(f"CPDif revision mismatch: expected {{CPDIF_REVISION}}, found {{actual}}")


def restore_release_cache(env):
    command = ["bash", CPDIF_REPO_DIR / "scripts/colab/10_restore_release_cache.sh"]
    print("+", " ".join(str(part) for part in command), flush=True)
    result = subprocess.run([str(part) for part in command], env=env, check=False)
    if result.returncode == 0:
        return True
    print(
        "Release cache restore failed; continuing with a source build. "
        "This is slower, but produces the same validated binary.",
        flush=True,
    )
    return False


def stop_previous_ui():
    if not CPDIF_UI_PID.is_file():
        return
    try:
        pid = int(CPDIF_UI_PID.read_text(encoding="utf-8").strip())
        os.killpg(pid, signal.SIGTERM)
    except (ValueError, ProcessLookupError, PermissionError):
        CPDIF_UI_PID.unlink(missing_ok=True)
        return
    for _ in range(20):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            CPDIF_UI_PID.unlink(missing_ok=True)
            return
        time.sleep(0.25)
    os.killpg(pid, signal.SIGKILL)
    CPDIF_UI_PID.unlink(missing_ok=True)


def start_prompt_assistant_setup(env):
    prompt_env = env.copy()
    prompt_env.update(
        {{
            "CPDIF_PROMPT_ASSISTANT_MODEL": CPDIF_PROMPT_ASSISTANT_MODEL,
            "CPDIF_PROMPT_ASSISTANT_LOG": str(CPDIF_OLLAMA_LOG),
            "OLLAMA_HOST": "127.0.0.1:11434",
            "OLLAMA_MODELS": str(CPDIF_WORKDIR / "models" / "ollama"),
        }}
    )
    CPDIF_PROMPT_SETUP_LOG.parent.mkdir(parents=True, exist_ok=True)
    with CPDIF_PROMPT_SETUP_LOG.open("w", encoding="utf-8") as log_file:
        process = subprocess.Popen(
            ["bash", CPDIF_REPO_DIR / "scripts/colab/11_prepare_prompt_assistant.sh"],
            env=prompt_env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    print(
        "Preparing the optional local Qwen vision prompt assistant in the background. "
        f"Progress: {{CPDIF_PROMPT_SETUP_LOG}}"
    )
    return process


def start_ui(architecture):
    stop_previous_ui()
    build_dir = "build-a100" if architecture == "80" else "build-sm120"
    ui_env = os.environ.copy()
    ui_env.update(
        {{
            "CPDIF_WORKDIR": str(CPDIF_WORKDIR),
            "CPDIF_BIN": str(CPDIF_WORKDIR / build_dir / "bin" / "cpdif"),
            "CPDIF_TRANSFORMER": str(
                CPDIF_WORKDIR / "models" / "flux-2-klein-9b-kv-Q8_0.gguf"
            ),
            "CPDIF_TEXT_ENCODER": str(CPDIF_WORKDIR / "models" / "qwen_3_8b.safetensors"),
            "CPDIF_VAE": str(CPDIF_WORKDIR / "models" / "flux2-vae.safetensors"),
            "CPDIF_UI_HOST": "127.0.0.1",
            "CPDIF_UI_PORT": str(CPDIF_UI_PORT),
            "CPDIF_UI_MAX_VRAM": "8" if architecture == "80" else "",
            "CPDIF_PROMPT_ASSISTANT_ENABLED": "1",
            "CPDIF_PROMPT_ASSISTANT_URL": "http://127.0.0.1:11434",
            "CPDIF_PROMPT_ASSISTANT_MODEL": CPDIF_PROMPT_ASSISTANT_MODEL,
        }}
    )
    CPDIF_UI_LOG.parent.mkdir(parents=True, exist_ok=True)
    with CPDIF_UI_LOG.open("w", encoding="utf-8") as log_file:
        process = subprocess.Popen(
            ["npm", "start"],
            cwd=str(CPDIF_REPO_DIR / "ui"),
            env=ui_env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    CPDIF_UI_PID.write_text(f"{{process.pid}}\\n", encoding="utf-8")
    return process


def wait_until_ready(process, timeout=120):
    status_url = f"http://127.0.0.1:{{CPDIF_UI_PORT}}/api/status"
    deadline = time.monotonic() + timeout
    last_status = None
    while time.monotonic() < deadline:
        exit_code = process.poll()
        if exit_code is not None:
            log = CPDIF_UI_LOG.read_text(encoding="utf-8", errors="replace")
            raise RuntimeError(f"CPDif UI exited with code {{exit_code}}.\\n{{log[-8000:]}}")
        try:
            with urllib.request.urlopen(status_url, timeout=5) as response:
                last_status = json.load(response)
            if last_status.get("ready") is True:
                return last_status
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            pass
        time.sleep(1)
    log = CPDIF_UI_LOG.read_text(encoding="utf-8", errors="replace")
    raise RuntimeError(f"CPDif UI did not become ready: {{last_status}}\\n{{log[-8000:]}}")


def reserve_proxy_if_needed():
    value = globals().get("CPDIF_PROXY_URL")
    if value:
        return _validate_colab_proxy_url(value)
    value = output.eval_js(
        f"""
(async () => {{{{
  if (!google.colab.kernel.accessAllowed) {{{{
    throw new Error("Allow this notebook to access the Colab runtime first.");
  }}}}
  const proxy = await google.colab.kernel.proxyPort({{CPDIF_UI_PORT}});
  return new URL("/", proxy).toString();
}}}})()
""",
        timeout_sec=30,
    )
    return _validate_colab_proxy_url(value)


CPDIF_WORKDIR.mkdir(parents=True, exist_ok=True)
prepare_repository()
architecture = detect_cuda_architecture()
print(f"Using validated sm{{architecture}} release-cache profile.")

build_env = os.environ.copy()
build_env.update(
    {{
        "CPDIF_REPO_DIR": str(CPDIF_REPO_DIR),
        "CPDIF_WORKDIR": str(CPDIF_WORKDIR),
        "CPDIF_CUDA_ARCHITECTURES": architecture,
        "HF_HUB_DOWNLOAD_TIMEOUT": "1800",
        "HF_XET_HIGH_PERFORMANCE": "1",
    }}
)
try:
    from google.colab import userdata

    hf_token = userdata.get("HF_TOKEN")
except Exception:
    hf_token = None
if hf_token:
    build_env["HF_TOKEN"] = hf_token

run(["bash", CPDIF_REPO_DIR / "scripts/colab/00_install_build_deps.sh"], env=build_env)
install_node_if_needed()
run(["bash", CPDIF_REPO_DIR / "scripts/colab/01_prepare_upstream.sh"], env=build_env)
restore_release_cache(build_env)
run(["bash", CPDIF_REPO_DIR / "scripts/colab/02_build_cuda.sh"], env=build_env)

aux_model_env = build_env.copy()
aux_model_env["MODEL_COMPONENTS"] = "text_encoder,vae"
run(["bash", CPDIF_REPO_DIR / "scripts/model/download_model.sh"], env=aux_model_env)
run(["bash", CPDIF_REPO_DIR / "scripts/model/download_kv_q8_transformer.sh"], env=build_env)

prompt_setup_process = start_prompt_assistant_setup(build_env)
ui_process = start_ui(architecture)
status = wait_until_ready(ui_process)
CPDIF_PROXY_URL = reserve_proxy_if_needed()

print("\\nCPDif Studio is ready:")
print(CPDIF_PROXY_URL)
print("This private proxy URL works only while this Colab runtime remains connected.")
print("Qwen downloads in the background; its studio badge turns green when vision prompting is ready.")
safe_url = html.escape(CPDIF_PROXY_URL, quote=True)
display(
    HTML(
        f'<p><a href="{{safe_url}}" target="_blank" rel="noopener noreferrer" '
        'style="display:inline-block;padding:12px 18px;border-radius:8px;'
        'background:#111827;color:white;text-decoration:none;font-weight:700">'
        'Open CPDif Studio</a></p>'
    )
)
try:
    output.serve_kernel_port_as_iframe(
        CPDIF_UI_PORT, path="/", width="100%", height="900"
    )
except Exception as iframe_error:
    print(f"Inline preview unavailable ({{iframe_error}}); use the direct link above.")
'''


def code_cell(source: str) -> dict[str, object]:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": source.splitlines(keepends=True),
    }


def build_notebook() -> dict[str, object]:
    """Return the deterministic notebook document."""
    return {
        "cells": [code_cell(CELL_1), code_cell(CELL_2)],
        "metadata": {
            "accelerator": "GPU",
            "colab": {
                "authorship_tag": "CPDif generated launcher",
                "include_colab_link": True,
            },
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def render_notebook() -> str:
    """Render stable UTF-8 JSON with a trailing newline."""
    return json.dumps(build_notebook(), indent=2, ensure_ascii=False) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the output is missing or differs from generated content",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rendered = render_notebook()
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != rendered:
            raise SystemExit(f"Notebook is stale; run {Path(__file__).name}")
        print(f"Notebook is current: {args.output}")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
