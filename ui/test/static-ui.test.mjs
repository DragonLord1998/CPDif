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
    "add-image-node",
    "add-klein-node",
    "add-output-node",
    "prompt-assistant-status",
    "klein-node-template",
    "image-node-template",
    "lora-node",
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
  assert.match(html, /class="node image-node"/);
  assert.match(html, /class="node utility-node lora-node"/);
  assert.match(html, /class="image-dropzone choose-image"/);
  assert.match(html, /0 images = Generate · 1–4 ordered images = Edit/);
  assert.match(html, /No image connected · Generate mode/);
  assert.match(html, /class="reference-grid"/);
  assert.match(html, /class="pid-upscale-output"/);
  assert.match(html, /4× NVIDIA PiD/);
  assert.match(html, /class="improve-prompt"/);
  assert.match(html, /class="undo-prompt"/);
  assert.match(css, /background-image:\s*radial-gradient/);
  assert.match(css, /--purple:\s*#805ee2/);
  assert.match(css, /\.klein-node:not\(\.edit-mode\)/);
  assert.match(css, /\.reference-slot/);
  assert.match(css, /\.reference-number/);
  assert.match(css, /\.output-node-actions/);
  assert.match(css, /\.assistant-status/);
  assert.match(script, /fetch\(path, options\)/);
  assert.match(script, /method:\s*"POST"/);
  assert.match(script, /function addStage/);
  assert.match(script, /function addImageSource/);
  assert.match(script, /function addOutputNode/);
  assert.match(script, /function runWorkflowFromStage/);
  assert.match(script, /function upscaleOutput/);
  assert.match(script, /inputNodeIds/);
  assert.match(script, /imageInputs/);
  assert.match(script, /"\/api\/images"/);
  assert.match(script, /type:\s*"job"/);
  assert.match(script, /body:\s*JSON\.stringify\(stagePayload\(stage\)\)/);
  assert.match(script, /\/upscale/);
  assert.match(script, /pidUrl/);
  assert.doesNotMatch(script, /startFromStageId/);
  assert.match(script, /\/api\/prompt-assistant\/status/);
  assert.match(script, /\/api\/prompt-assistant\/rewrite/);
  assert.match(script, /result\.usedVision/);
  assert.match(script, /\/api\/jobs\/\$\{activeJobId\}\/cancel/);
  assert.match(html, /Stored only · native inference support is not wired yet/);
  assert.match(script, /api\("\/api\/loras"/);
  assert.match(script, /JSON\.stringify\(\{ name, url \}\)/);
  assert.match(html, /type="file" accept="image\/png,image\/jpeg"/);
  assert.match(html, /id="stage-output-template"/);
  assert.match(html, /class="node stage-output-node"/);
  assert.doesNotMatch(html, /type="checkbox"/);
});
