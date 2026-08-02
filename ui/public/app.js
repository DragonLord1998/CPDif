const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const canvas = $("#canvas");
const elements = {
  form: $("#job-form"),
  template: $("#klein-node-template"),
  outputNode: $("#output-node"),
  workflowPanel: $("#workflow-panel"),
  addNode: $("#add-klein-node"),
  error: $("#form-error"),
  runtimeDot: $("#runtime-dot"),
  runtimeLabel: $("#runtime-label"),
  runtimeDetail: $("#runtime-detail"),
  workflowSummary: $("#workflow-summary"),
  jobStatus: $("#job-status"),
  jobLog: $("#job-log"),
  loraName: $("#lora-name"),
  loraUrl: $("#lora-url"),
  loraDownload: $("#download-lora"),
  loraDownloadText: $("#download-lora-text"),
  loraStatus: $("#lora-status"),
  loraList: $("#lora-list"),
  loraCount: $("#lora-count"),
  stageTabs: $("#stage-tabs"),
  outputImage: $("#output-image"),
  outputPlaceholder: $("#output-placeholder"),
  outputSize: $("#output-size"),
  activeTime: $("#active-time"),
  activeMode: $("#active-mode"),
  activeStage: $("#active-stage"),
  loading: $("#loading"),
  loadingText: $("#loading-text"),
  modal: $("#image-modal"),
  modalImage: $("#modal-image"),
  modalTitle: $("#modal-title"),
  toast: $("#toast"),
};

const stages = [];
let nextStageNumber = 1;
let activeJobId = null;
let activeStageId = null;
let selectedStageId = null;
let latestJob = null;
let pollTimer = null;
let loadingTimer = null;
let zoom = 1;
let runtimeReady = false;
let workflowBusy = false;

function formatMs(value) {
  return Number.isFinite(value) ? `${(value / 1000).toFixed(2)} s` : "—";
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) {
    return "Unknown size";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(elements.toast.timer);
  elements.toast.timer = window.setTimeout(
    () => elements.toast.classList.remove("show"),
    1700,
  );
}

async function api(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return payload;
}

function stageById(id) {
  return stages.find((stage) => stage.id === id) ?? null;
}

function selectNode(node) {
  $$(".node").forEach((candidate) => {
    candidate.classList.toggle("selected", candidate === node);
  });
  selectedStageId = node?.dataset.stageId ?? selectedStageId;
}

function curve(from, to, pathElement) {
  const canvasRect = canvas.getBoundingClientRect();
  const fromPort = from.querySelector(".port-out") ?? from;
  const toPort = to.querySelector(".port-in") ?? to;
  const fromRect = fromPort.getBoundingClientRect();
  const toRect = toPort.getBoundingClientRect();
  const x1 = (fromRect.left + fromRect.width / 2 - canvasRect.left) / zoom;
  const y1 = (fromRect.top + fromRect.height / 2 - canvasRect.top) / zoom;
  const x2 = (toRect.left + toRect.width / 2 - canvasRect.left) / zoom;
  const y2 = (toRect.top + toRect.height / 2 - canvasRect.top) / zoom;
  const bend = Math.max(65, Math.abs(x2 - x1) * 0.44);
  pathElement.setAttribute(
    "d",
    `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
  );
}

function addWire(from, to, className = "wire") {
  const pathElement = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathElement.setAttribute("class", className);
  $("#wires").append(pathElement);
  curve(from, to, pathElement);
}

function updateWires() {
  $("#wires").replaceChildren();
  for (const stage of stages) {
    if (stage.inputStageId) {
      const source = stageById(stage.inputStageId);
      if (source) {
        addWire(source.node, stage.node);
      }
    }
  }
  const last = stages.at(-1);
  if (last) {
    addWire(last.node, elements.outputNode, "wire output");
  }
}

function attachNode(node) {
  node.addEventListener("pointerdown", () => selectNode(node));
  const head = node.querySelector(".node-head");
  const handle = node.querySelector(".resize-handle");
  let dragging = false;
  let resizing = false;
  let offsetX = 0;
  let offsetY = 0;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  head.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, input, select")) {
      return;
    }
    dragging = true;
    head.setPointerCapture(event.pointerId);
    const rect = node.getBoundingClientRect();
    offsetX = (event.clientX - rect.left) / zoom;
    offsetY = (event.clientY - rect.top) / zoom;
    selectNode(node);
    event.preventDefault();
  });
  head.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    node.style.left = `${Math.max(0, (event.clientX - rect.left) / zoom - offsetX)}px`;
    node.style.top = `${Math.max(0, (event.clientY - rect.top) / zoom - offsetY)}px`;
    updateWires();
  });
  for (const eventName of ["pointerup", "pointercancel"]) {
    head.addEventListener(eventName, () => {
      dragging = false;
    });
  }

  handle.addEventListener("pointerdown", (event) => {
    resizing = true;
    handle.setPointerCapture(event.pointerId);
    startX = event.clientX;
    startY = event.clientY;
    startWidth = node.offsetWidth;
    startHeight = node.offsetHeight;
    selectNode(node);
    event.stopPropagation();
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (!resizing) {
      return;
    }
    node.style.width = `${Math.max(Number(node.dataset.minW), startWidth + (event.clientX - startX) / zoom)}px`;
    node.style.height = `${Math.max(Number(node.dataset.minH), startHeight + (event.clientY - startY) / zoom)}px`;
    updateWires();
  });
  for (const eventName of ["pointerup", "pointercancel"]) {
    handle.addEventListener(eventName, () => {
      resizing = false;
    });
  }
}

function updateZoom() {
  zoom = Math.max(0.65, Math.min(1.25, zoom));
  canvas.style.transform = `scale(${zoom})`;
  $("#zoom-value").textContent = `${Math.round(zoom * 100)}%`;
  window.setTimeout(updateWires, 180);
}

function layoutNodes() {
  stages.forEach((stage, index) => {
    stage.node.style.left = `${70 + index * 470}px`;
    stage.node.style.top = "80px";
    stage.node.style.width = "410px";
    stage.node.style.height = "440px";
  });
  const outputLeft = 70 + stages.length * 470;
  elements.outputNode.style.left = `${outputLeft}px`;
  elements.outputNode.style.top = "70px";
  elements.outputNode.style.width = "400px";
  elements.outputNode.style.height = "520px";
  elements.workflowPanel.style.left = "70px";
  elements.workflowPanel.style.top = "550px";
  canvas.style.width = `${Math.max(1500, outputLeft + 480)}px`;
  canvas.style.height = "1150px";
  updateWires();
}

function resetLayout() {
  layoutNodes();
  zoom = 1;
  updateZoom();
  toast("Layout reset");
}

function updateCounter(stage) {
  const value = `${stage.prompt.value.length} / 4000`;
  stage.node.querySelector(".prompt-counter").textContent = value;
  stage.node.querySelector(".prompt-counter-overlay").textContent = value;
}

function refreshConnectionOptions() {
  stages.forEach((stage, index) => {
    const previous = stages.slice(0, index);
    const select = stage.source;
    const current = stage.inputStageId;
    select.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No image connected";
    select.append(none);
    for (const candidate of previous) {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = `${candidate.label} output`;
      select.append(option);
    }
    stage.inputStageId = previous.some(({ id }) => id === current) ? current : null;
    select.value = stage.inputStageId ?? "";
    updateStageMode(stage);
  });
  updateWorkflowSummary();
  renderStageTabs();
  updateWires();
}

function updateStageMode(stage) {
  const edit = Boolean(stage.inputStageId);
  const badge = stage.node.querySelector(".mode-badge");
  badge.textContent = edit ? "Edit" : "Generate";
  badge.classList.toggle("edit", edit);
  stage.node.classList.toggle("edit-mode", edit);
  stage.node.querySelector(".prompt-label").textContent = edit
    ? "What should change?"
    : "Describe the image";
  stage.node.querySelector(".mode-hint").textContent = edit
    ? `Image connected from ${stageById(stage.inputStageId)?.label ?? "upstream"} · Edit mode`
    : "No image connected · Generate mode";
  stage.node.querySelector(".run-workflow-text").textContent = edit
    ? "◈ Edit image"
    : "✦ Generate";
  stage.node.querySelector(".node-status").textContent = edit
    ? "Ready to edit the connected image"
    : "Ready to generate from text";
}

function updateWorkflowSummary() {
  const edits = stages.filter(({ inputStageId }) => inputStageId).length;
  const generates = stages.length - edits;
  elements.workflowSummary.textContent = `${generates} Generate · ${edits} Edit`;
}

function addStage({ connectPrevious = true } = {}) {
  if (workflowBusy || stages.length >= 8) {
    toast(workflowBusy ? "Wait for the active workflow" : "Maximum 8 Klein nodes");
    return;
  }
  const id = `klein-${nextStageNumber}`;
  const label = `Klein ${nextStageNumber}`;
  const node = elements.template.content.firstElementChild.cloneNode(true);
  node.id = id;
  node.dataset.stageId = id;
  node.querySelector(".node-title").textContent = label;
  const source = node.querySelector(".image-source");
  const prompt = node.querySelector(".stage-prompt");
  const size = node.querySelector(".stage-size");
  const seed = node.querySelector(".stage-seed");
  seed.value = String(20260731 + stages.length);
  prompt.value = stages.length === 0
    ? "A realistic orange tabby cat sitting in a softly lit gray studio, full body, centered composition"
    : "Keep the same subject and composition. Dress the subject in a fitted black business suit with a white shirt and black tie.";
  const stage = {
    id,
    label,
    node,
    source,
    prompt,
    size,
    seed,
    inputStageId: connectPrevious ? stages.at(-1)?.id ?? null : null,
  };
  stages.push(stage);
  nextStageNumber += 1;
  elements.form.append(node);
  attachNode(node);
  source.addEventListener("change", () => {
    stage.inputStageId = source.value || null;
    updateStageMode(stage);
    updateWorkflowSummary();
    renderStageTabs();
    updateWires();
  });
  prompt.addEventListener("input", () => updateCounter(stage));
  prompt.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });
  node.querySelector(".remove-node").addEventListener("click", () => removeStage(stage.id));
  node.querySelector(".cancel-workflow").addEventListener("click", cancelWorkflow);
  updateCounter(stage);
  refreshConnectionOptions();
  layoutNodes();
  selectNode(node);
  setBusy(workflowBusy);
}

function removeStage(id) {
  if (workflowBusy) {
    toast("Stop the active workflow first");
    return;
  }
  if (stages.length === 1) {
    toast("Keep at least one Klein node");
    return;
  }
  const index = stages.findIndex((stage) => stage.id === id);
  if (index < 0) {
    return;
  }
  stages[index].node.remove();
  stages.splice(index, 1);
  for (const stage of stages) {
    if (stage.inputStageId === id) {
      stage.inputStageId = null;
    }
  }
  if (selectedStageId === id) {
    selectedStageId = stages.at(-1).id;
  }
  if (activeStageId === id) {
    activeStageId = stages.at(-1).id;
  }
  refreshConnectionOptions();
  layoutNodes();
  selectNode(stageById(selectedStageId)?.node ?? stages.at(-1).node);
  setBusy(workflowBusy);
}

function workflowPayload() {
  return {
    stages: stages.map((stage) => ({
      id: stage.id,
      inputStageId: stage.inputStageId,
      prompt: stage.prompt.value,
      width: Number(stage.size.value),
      height: Number(stage.size.value),
      seed: Number(stage.seed.value),
    })),
  };
}

function setBusy(busy) {
  workflowBusy = busy;
  for (const stage of stages) {
    const run = stage.node.querySelector(".run-workflow");
    const cancel = stage.node.querySelector(".cancel-workflow");
    run.disabled = busy || !runtimeReady;
    run.classList.toggle("generating", busy);
    cancel.hidden = !busy;
  }
  elements.addNode.disabled = busy || stages.length >= 8;
  elements.loading.hidden = !busy;
  window.clearInterval(loadingTimer);
  if (busy) {
    const messages = [
      "Loading the native Klein context…",
      "Running connected Generate and Edit stages…",
      "Caching reference attention for edit nodes…",
      "Decoding workflow outputs…",
    ];
    let index = 0;
    elements.loadingText.textContent = messages[index];
    loadingTimer = window.setInterval(() => {
      index = (index + 1) % messages.length;
      elements.loadingText.textContent = messages[index];
    }, 1500);
  }
}

function renderStageTabs(job = latestJob) {
  elements.stageTabs.replaceChildren();
  for (const stage of stages) {
    const button = document.createElement("button");
    const mode = stage.inputStageId ? "Edit" : "Generate";
    button.type = "button";
    button.role = "tab";
    button.dataset.stageId = stage.id;
    button.textContent = `${stage.label} · ${mode}`;
    button.addEventListener("click", () => setActiveStage(stage.id, job));
    elements.stageTabs.append(button);
  }
  if (!activeStageId || !stageById(activeStageId)) {
    activeStageId = stages.at(-1)?.id ?? null;
  }
  setActiveStage(activeStageId, job);
}

function setActiveStage(id, job = latestJob) {
  const stage = stageById(id);
  if (!stage) {
    return;
  }
  activeStageId = id;
  for (const button of elements.stageTabs.querySelectorAll("button")) {
    const active = button.dataset.stageId === id;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  elements.activeMode.textContent = stage.inputStageId ? "Edit" : "Generate";
  elements.activeStage.textContent = stage.label;
  elements.outputSize.textContent = `${stage.size.value} × ${stage.size.value}`;
  const timing = job?.telemetry?.[id]?.generation_ms;
  elements.activeTime.textContent = Number.isFinite(timing) ? formatMs(timing) : "Ready";
  const imageUrl = job?.images?.[id];
  if (imageUrl) {
    const version = encodeURIComponent(job.completedAt);
    elements.outputImage.src = `${imageUrl}?v=${version}`;
    elements.outputImage.alt = `${stage.label} ${stage.inputStageId ? "edited" : "generated"} output`;
    elements.outputImage.hidden = false;
    elements.outputPlaceholder.hidden = true;
  } else {
    elements.outputImage.hidden = true;
    elements.outputImage.removeAttribute("src");
    elements.outputPlaceholder.hidden = false;
  }
}

function resetResults() {
  latestJob = null;
  elements.outputImage.hidden = true;
  elements.outputImage.removeAttribute("src");
  elements.outputPlaceholder.hidden = false;
  elements.activeTime.textContent = "Running";
  elements.jobLog.textContent = "Waiting for native runtime output…";
  renderStageTabs(null);
}

function showCompletedJob(job) {
  latestJob = job;
  const finalId = stages.at(-1)?.id;
  renderStageTabs(job);
  if (finalId) {
    setActiveStage(finalId, job);
  }
}

function renderJob(job) {
  const labels = {
    queued: "Queued behind the active GPU workflow",
    running: "Running on CUDA",
    cancelling: "Stopping native process",
    cancelled: "Workflow stopped",
    failed: "Native workflow failed",
    completed: "Workflow complete",
  };
  elements.jobStatus.textContent = labels[job.status] ?? job.status;
  elements.jobLog.textContent = job.log || "Waiting for native runtime output…";
  const active = new Set(job.activeStages ?? []);
  for (const stage of stages) {
    const status = stage.node.querySelector(".node-status");
    status.classList.toggle("active", active.has(stage.id));
    status.textContent = active.has(stage.id)
      ? `Running ${stage.inputStageId ? "Edit" : "Generate"} on CUDA…`
      : job.status === "completed"
        ? "Output ready"
        : stage.inputStageId
          ? "Waiting for connected image"
          : "Ready to generate from text";
  }
  if (job.status === "completed") {
    showCompletedJob(job);
    toast("Native workflow completed");
  }
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    setBusy(false);
    activeJobId = null;
    if (job.error) {
      elements.error.textContent = job.error;
    }
    return true;
  }
  return false;
}

async function pollJob() {
  if (!activeJobId) {
    return;
  }
  try {
    const finished = renderJob(await api(`/api/jobs/${activeJobId}`));
    if (!finished) {
      pollTimer = window.setTimeout(pollJob, 800);
    }
  } catch (error) {
    elements.error.textContent = error.message;
    setBusy(false);
    activeJobId = null;
  }
}

async function checkRuntime() {
  elements.runtimeDot.classList.remove("ready", "error");
  try {
    const status = await api("/api/status");
    runtimeReady = status.ready;
    elements.runtimeDot.classList.toggle("ready", status.ready);
    elements.runtimeLabel.textContent = status.ready ? "Runtime ready" : "Runtime incomplete";
    const missing = Object.entries(status.checks)
      .filter(([, ready]) => !ready)
      .map(([name]) => name);
    elements.runtimeDetail.textContent = status.ready
      ? `${status.profile}${status.maxVram ? ` · ${status.maxVram} GiB graph budget` : ""}`
      : `Missing: ${missing.join(", ")}`;
  } catch (error) {
    runtimeReady = false;
    elements.runtimeDot.classList.add("error");
    elements.runtimeLabel.textContent = "Runtime unavailable";
    elements.runtimeDetail.textContent = error.message;
  }
  setBusy(workflowBusy);
}

function renderLoras(loras) {
  elements.loraList.replaceChildren();
  elements.loraCount.textContent = `${loras.length} ${loras.length === 1 ? "asset" : "assets"}`;
  if (loras.length === 0) {
    const empty = document.createElement("li");
    empty.className = "lora-empty";
    empty.textContent = "No downloaded LoRAs yet.";
    elements.loraList.append(empty);
    return;
  }
  for (const lora of loras) {
    const item = document.createElement("li");
    const identity = document.createElement("span");
    const name = document.createElement("strong");
    const filename = document.createElement("small");
    const size = document.createElement("em");
    name.textContent = lora.name;
    filename.textContent = lora.filename;
    size.textContent = formatBytes(lora.sizeBytes);
    identity.append(name, filename);
    item.append(identity, size);
    elements.loraList.append(item);
  }
}

async function loadLoras() {
  try {
    const payload = await api("/api/loras");
    renderLoras(payload.loras);
  } catch (error) {
    elements.loraStatus.textContent = error.message;
    elements.loraStatus.classList.add("error");
  }
}

async function downloadLora() {
  const name = elements.loraName.value.trim();
  const url = elements.loraUrl.value.trim();
  elements.loraStatus.classList.remove("error", "success");
  if (!name || !url) {
    elements.loraStatus.textContent = "Enter both a name and an HTTPS safetensors URL.";
    elements.loraStatus.classList.add("error");
    return;
  }
  elements.loraDownload.disabled = true;
  elements.loraDownload.classList.add("downloading");
  elements.loraDownloadText.textContent = "Downloading…";
  elements.loraStatus.textContent = "Downloading to the CPDif LoRA directory…";
  try {
    const payload = await api("/api/loras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url }),
    });
    elements.loraName.value = "";
    elements.loraUrl.value = "";
    elements.loraStatus.textContent = `${payload.lora.filename} downloaded. It is stored, not applied to inference.`;
    elements.loraStatus.classList.add("success");
    toast("LoRA downloaded");
    await loadLoras();
  } catch (error) {
    elements.loraStatus.textContent = error.message;
    elements.loraStatus.classList.add("error");
  } finally {
    elements.loraDownload.disabled = false;
    elements.loraDownload.classList.remove("downloading");
    elements.loraDownloadText.textContent = "Download";
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  window.clearTimeout(pollTimer);
  elements.error.textContent = "";
  resetResults();
  setBusy(true);
  try {
    const job = await api("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workflowPayload()),
    });
    activeJobId = job.id;
    renderJob(job);
    void pollJob();
  } catch (error) {
    elements.error.textContent = error.message;
    setBusy(false);
  }
});

async function cancelWorkflow() {
  if (!activeJobId) {
    return;
  }
  try {
    renderJob(
      await api(`/api/jobs/${activeJobId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch (error) {
    elements.error.textContent = error.message;
  }
}

elements.addNode.addEventListener("click", () => addStage());
elements.loraDownload.addEventListener("click", downloadLora);
for (const input of [elements.loraName, elements.loraUrl]) {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void downloadLora();
    }
  });
}

$("#copy-prompt").addEventListener("click", async () => {
  const stage = stageById(activeStageId) ?? stageById(selectedStageId);
  try {
    await navigator.clipboard.writeText(stage?.prompt.value ?? "");
    toast("Stage prompt copied");
  } catch {
    toast("Clipboard unavailable");
  }
});

$("#download-output").addEventListener("click", () => {
  if (elements.outputImage.hidden || !elements.outputImage.src) {
    toast("Run a workflow first");
    return;
  }
  const link = document.createElement("a");
  link.href = elements.outputImage.src;
  link.download = `cpdif-${activeStageId}.png`;
  link.click();
});

$("#expand-output").addEventListener("click", () => {
  if (elements.outputImage.hidden || !elements.outputImage.src) {
    toast("Run a workflow first");
    return;
  }
  elements.modalTitle.textContent = `${stageById(activeStageId)?.label ?? "Klein"} output`;
  elements.modalImage.replaceChildren(elements.outputImage.cloneNode());
  elements.modal.showModal();
});

$("#close-modal").addEventListener("click", () => elements.modal.close());
elements.modal.addEventListener("click", (event) => {
  if (event.target === elements.modal) {
    elements.modal.close();
  }
});

$("#zoom-in").addEventListener("click", () => {
  zoom += 0.1;
  updateZoom();
});
$("#zoom-out").addEventListener("click", () => {
  zoom -= 0.1;
  updateZoom();
});
$("#zoom-value").addEventListener("click", () => {
  zoom = 1;
  updateZoom();
});
$("#reset-layout").addEventListener("click", resetLayout);

attachNode(elements.outputNode);
window.addEventListener("resize", updateWires);
if (window.ResizeObserver) {
  new ResizeObserver(updateWires).observe(canvas);
}

addStage({ connectPrevious: false });
setActiveStage(stages[0].id);
updateZoom();
void checkRuntime();
void loadLoras();
