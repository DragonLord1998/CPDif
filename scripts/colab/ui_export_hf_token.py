"""Load a Colab HF token secret into kernel memory without printing it.

Run this file only from the trusted Colab UI. Colab intentionally prevents
`google.colab.userdata` access from remote CLI-executed cells.
"""

from __future__ import annotations

import os

from google.colab import userdata


token = userdata.get("HF_TOKEN") or userdata.get("HF_Token")
if not token:
    raise RuntimeError("HF_TOKEN is missing from Colab secrets")

os.environ["HF_TOKEN"] = token
print("HF_TOKEN loaded into kernel memory for this runtime; token value was not printed")
