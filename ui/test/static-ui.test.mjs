import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiRoot = new URL("../public/", import.meta.url);

test("uses the visual node canvas while preserving the native job contract", async () => {
  const [html, css, script] = await Promise.all([
    readFile(new URL("index.html", uiRoot), "utf8"),
    readFile(new URL("styles.css", uiRoot), "utf8"),
    readFile(new URL("app.js", uiRoot), "utf8"),
  ]);

  for (const id of [
    "job-form",
    "prompt",
    "edit-prompt",
    "size",
    "seed",
    "submit-button",
    "cancel-button",
    "source-image",
    "edited-image",
    "job-log",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(html, /id="source-node"/);
  assert.match(html, /id="flux-node"/);
  assert.match(html, /id="output-node"/);
  assert.match(css, /background-image:\s*radial-gradient/);
  assert.match(css, /--purple:\s*#805ee2/);
  assert.match(script, /fetch\(path, options\)/);
  assert.match(script, /method:\s*"POST"/);
  assert.match(script, /editPrompt:\s*data\.get\("editPrompt"\)/);
  assert.match(script, /\/api\/jobs\/\$\{activeJobId\}\/cancel/);
  assert.doesNotMatch(html.toLowerCase(), /lora/);
  assert.doesNotMatch(html, /type="file"/);
});
