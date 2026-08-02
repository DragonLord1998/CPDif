import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiRoot = new URL("../public/", import.meta.url);

test("uses automatic Generate/Edit Klein nodes while preserving the native job contract", async () => {
  const [html, css, script] = await Promise.all([
    readFile(new URL("index.html", uiRoot), "utf8"),
    readFile(new URL("styles.css", uiRoot), "utf8"),
    readFile(new URL("app.js", uiRoot), "utf8"),
  ]);

  for (const id of [
    "job-form",
    "add-klein-node",
    "prompt-assistant-status",
    "klein-node-template",
    "workflow-panel",
    "stage-tabs",
    "output-image",
    "output-placeholder",
    "output-node",
    "job-log",
    "lora-name",
    "lora-url",
    "download-lora",
    "lora-list",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(html, /class="node klein-node"/);
  assert.match(html, /class="image-source"/);
  assert.match(html, /No image wire = Generate · Image wire = Edit/);
  assert.match(html, /No image connected · Generate mode/);
  assert.match(html, /class="improve-prompt"/);
  assert.match(html, /class="undo-prompt"/);
  assert.match(css, /background-image:\s*radial-gradient/);
  assert.match(css, /--purple:\s*#805ee2/);
  assert.match(css, /\.klein-node:not\(\.edit-mode\)/);
  assert.match(css, /\.connection-field/);
  assert.match(css, /\.assistant-status/);
  assert.match(script, /fetch\(path, options\)/);
  assert.match(script, /method:\s*"POST"/);
  assert.match(script, /function addStage/);
  assert.match(script, /stage\.inputStageId = source\.value \|\| null/);
  assert.match(script, /inputStageId:\s*stage\.inputStageId/);
  assert.match(script, /body:\s*JSON\.stringify\(workflowPayload\(\)\)/);
  assert.match(script, /\/api\/prompt-assistant\/status/);
  assert.match(script, /\/api\/prompt-assistant\/rewrite/);
  assert.match(script, /result\.usedVision/);
  assert.match(script, /\/api\/jobs\/\$\{activeJobId\}\/cancel/);
  assert.match(html, /Stored only · native inference support is not wired yet/);
  assert.match(script, /api\("\/api\/loras"/);
  assert.match(script, /JSON\.stringify\(\{ name, url \}\)/);
  assert.doesNotMatch(html, /type="file"/);
  assert.doesNotMatch(html, /type="checkbox"/);
});
