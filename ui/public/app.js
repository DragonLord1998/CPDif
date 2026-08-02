const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const canvas = $("#canvas");
const elements = {
  form: $("#job-form"),
  template: $("#klein-node-template"),
  imageTemplate: $("#image-node-template"),
  outputTemplate: $("#stage-output-template"),
  outputNode: $("#output-node"),
  workflowPanel: $("#workflow-panel"),
  loraNode: $("#lora-node"),
  addNode: $("#add-klein-node"),
  addImageNode: $("#add-image-node"),
  addOutputNode: $("#add-output-node"),
  promptAssistantStatus: $("#prompt-assistant-status"),
  promptAssistantStatusText: $("#prompt-assistant-status .assistant-status-text"),
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
const imageSources = [];
const outputNodes = [];
let nextStageNumber = 1;
let nextImageNumber = 1;
let nextOutputNumber = 1;
let activeJobId = null;
let activeStageId = null;
let selectedStageId = null;
let runningStageId = null;
let runningOutputId = null;
let latestJob = null;
let pollTimer = null;
let loadingTimer = null;
let zoom = 1;
let runtimeReady = false;
let pidReady = false;
let workflowBusy = false;
let assistantReady = false;
let assistantStatusTimer = null;

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

function imageSourceByNodeId(id) {
  return imageSources.find((source) => source.id === id) ?? null;
}

function connectedInputIds(stage) {
  return stage.inputNodeIds.filter(Boolean);
}

function compactStageInputs(stage) {
  const connected = connectedInputIds(stage).slice(0, 4);
  stage.inputNodeIds = [...connected, ...Array(4 - connected.length).fill("")];
}

function stageHasInput(stage) {
  return connectedInputIds(stage).length > 0;
}

function connectionSource(value) {
  const [kind, id] = String(value || "").split(":", 2);
  if (kind === "stage") {
    const stage = stageById(id);
    return stage ? { kind, id, label: stage.label, stage, image: stage.output } : null;
  }
  if (kind === "image") {
    const source = imageSourceByNodeId(id);
    return source
      ? { kind, id, label: source.label, source, image: source.image }
      : null;
  }
  return null;
}

function stageInputSources(stage) {
  return connectedInputIds(stage).map(connectionSource).filter(Boolean);
}

function stageInputLabel(stage) {
  const sources = stageInputSources(stage);
  return sources.length === 0
    ? null
    : sources.map((source, index) => `Image ${index + 1}: ${source.label}`).join(" · ");
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
    stage.inputNodeIds.forEach((value, slotIndex) => {
      const source = connectionSource(value);
      const slot = stage.inputSlots[slotIndex];
      if (source && slot) {
        addWire(
          source.kind === "stage" ? source.stage.node : source.source.node,
          slot.element,
          `${source.kind === "image" ? "wire image-wire" : "wire"}${source.image ? "" : " pending"}`,
        );
      }
    });
  }
  for (const output of outputNodes) {
    const source = stageById(output.sourceStageId);
    if (source) {
      addWire(source.node, output.node, "wire output");
    }
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
  const sourceColumnWidth = imageSources.length > 0 ? 340 : 0;
  imageSources.forEach((source, index) => {
    source.node.style.left = "50px";
    source.node.style.top = `${80 + index * 310}px`;
    source.node.style.width = "290px";
    source.node.style.height = "280px";
  });
  const kleinLeft = 70 + sourceColumnWidth;
  stages.forEach((stage, index) => {
    stage.node.style.left = `${kleinLeft + index * 520}px`;
    stage.node.style.top = "80px";
    stage.node.style.width = "460px";
    stage.node.style.height = "560px";
  });
  const outputLeft = kleinLeft + stages.length * 520;
  elements.outputNode.style.left = `${outputLeft}px`;
  elements.outputNode.style.top = "70px";
  elements.outputNode.style.width = "400px";
  elements.outputNode.style.height = "520px";
  const outputRowTop = 690;
  outputNodes.forEach((output, index) => {
    output.node.style.left = `${outputLeft + index * 320}px`;
    output.node.style.top = `${outputRowTop}px`;
    output.node.style.width = "290px";
    output.node.style.height = "320px";
  });
  elements.loraNode.style.left = `${kleinLeft}px`;
  elements.loraNode.style.top = `${outputRowTop + 370}px`;
  elements.loraNode.style.width = "410px";
  elements.loraNode.style.height = "270px";
  elements.workflowPanel.style.left = `${kleinLeft + 470}px`;
  elements.workflowPanel.style.top = `${outputRowTop + 370}px`;
  elements.workflowPanel.style.width = "410px";
  elements.workflowPanel.style.height = "220px";
  const outputNodesRight = outputLeft + outputNodes.length * 320 + 40;
  canvas.style.width = `${Math.max(1500, outputLeft + 480, outputNodesRight)}px`;
  const utilityBottom = Math.max(
    Number(elements.outputNode.style.top || 0) + 520,
    Number(elements.workflowPanel.style.top || 0) + 220,
    Number(elements.loraNode.style.top || 0) + 270,
    outputRowTop + 290,
  );
  const sourceBottom = imageSources.length > 0
    ? 80 + imageSources.length * 310
    : 390;
  canvas.style.height = `${Math.max(1120, utilityBottom + 80, sourceBottom)}px`;
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

function anyAssistantBusy() {
  return stages.some((stage) => stage.assistantBusy);
}

function anyImageBusy() {
  return imageSources.some((source) => source.uploading);
}

function updateAssistantControls(stage) {
  stage.improve.disabled =
    !assistantReady ||
    workflowBusy ||
    stage.assistantBusy ||
    anyAssistantBusy() ||
    anyImageBusy();
  stage.improve.classList.toggle("busy", stage.assistantBusy);
  stage.undo.hidden = stage.previousPrompt === null;
  stage.undo.disabled = workflowBusy || anyAssistantBusy() || anyImageBusy();
}

function updateAllAssistantControls() {
  for (const stage of stages) {
    updateAssistantControls(stage);
  }
}

function setAssistantStatus(state, text, title = "") {
  assistantReady = state === "ready";
  elements.promptAssistantStatus.dataset.state = state;
  elements.promptAssistantStatusText.textContent = text;
  elements.promptAssistantStatus.title = title;
  updateAllAssistantControls();
}

async function checkPromptAssistant() {
  window.clearTimeout(assistantStatusTimer);
  try {
    const status = await api("/api/prompt-assistant/status");
    if (!status.enabled) {
      setAssistantStatus("disabled", "Qwen disabled", status.model);
      return;
    }
    if (status.ready) {
      setAssistantStatus("ready", "Qwen vision ready", status.model);
      assistantStatusTimer = window.setTimeout(checkPromptAssistant, 15_000);
      return;
    }
    setAssistantStatus("unavailable", "Qwen preparing…", `${status.model} · ${status.detail}`);
  } catch (error) {
    setAssistantStatus("unavailable", "Qwen unavailable", error.message);
  }
  assistantStatusTimer = window.setTimeout(checkPromptAssistant, 5_000);
}

function completedReferences(stage) {
  const sources = stageInputSources(stage);
  if (sources.some(({ image }) => !image)) {
    return [];
  }
  return sources.map((source) =>
    source.kind === "image"
      ? { sourceId: source.source.serverId }
      : { jobId: source.stage.output.jobId, stageId: source.stage.output.stageId },
  );
}

async function improvePrompt(stage) {
  if (!assistantReady || workflowBusy || anyAssistantBusy() || anyImageBusy()) {
    return;
  }
  const original = stage.prompt.value.trim();
  if (!original) {
    stage.prompt.reportValidity();
    return;
  }
  const inputSignature = JSON.stringify(stage.inputNodeIds);
  const mode = stageHasInput(stage) ? "edit" : "generate";
  const images = completedReferences(stage);
  stage.assistantBusy = true;
  stage.node.querySelector(".node-status").textContent = images.length > 0
    ? `Qwen is reading ${images.length} connected image${images.length === 1 ? "" : "s"} and improving this prompt…`
    : "Qwen is improving this prompt…";
  setBusy(workflowBusy);
  try {
    const result = await api("/api/prompt-assistant/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        prompt: original,
        ...(images.length > 0 ? { images } : {}),
      }),
    });
    if (JSON.stringify(stage.inputNodeIds) !== inputSignature) {
      throw new Error("The image connection changed while Qwen was rewriting");
    }
    if (stage.prompt.value.trim() !== original) {
      throw new Error("The prompt changed while Qwen was rewriting");
    }
    stage.previousPrompt = stage.prompt.value;
    stage.prompt.value = result.prompt;
    updateCounter(stage);
    stage.node.querySelector(".node-status").textContent = result.usedVision
      ? "Prompt improved with Qwen vision · Undo is available"
      : "Prompt improved with Qwen · Undo is available";
    toast(result.usedVision ? "Prompt improved with vision" : "Prompt improved");
  } catch (error) {
    stage.node.querySelector(".node-status").textContent = error.message;
    toast("Qwen rewrite failed");
  } finally {
    stage.assistantBusy = false;
    setBusy(workflowBusy);
  }
}

function undoPrompt(stage) {
  if (
    stage.previousPrompt === null ||
    workflowBusy ||
    anyAssistantBusy() ||
    anyImageBusy()
  ) {
    return;
  }
  stage.prompt.value = stage.previousPrompt;
  stage.previousPrompt = null;
  updateCounter(stage);
  updateStageMode(stage);
  updateAssistantControls(stage);
  toast("Original prompt restored");
}

function makeOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function validConnectionValues(stage) {
  const stageIndex = stages.indexOf(stage);
  const values = new Map();
  for (const source of imageSources.filter(({ serverId }) => serverId)) {
    values.set(`image:${source.id}`, `${source.label} · uploaded`);
  }
  for (const candidate of stages.slice(0, stageIndex)) {
    values.set(
      `stage:${candidate.id}`,
      `${candidate.label} output${candidate.output ? " · ready" : " · run first"}`,
    );
  }
  return values;
}

function refreshReferenceSlot(stage, slotIndex, values = validConnectionValues(stage)) {
  const slot = stage.inputSlots[slotIndex];
  const current = stage.inputNodeIds[slotIndex] || "";
  if (current && !values.has(current)) {
    stage.inputNodeIds[slotIndex] = "";
  }
  slot.select.replaceChildren(makeOption("", "No image"));
  for (const [value, label] of values) {
    slot.select.append(makeOption(value, label));
  }
  slot.select.value = stage.inputNodeIds[slotIndex] || "";
  const source = connectionSource(stage.inputNodeIds[slotIndex]);
  const connectedNumber = stage.inputNodeIds
    .slice(0, slotIndex + 1)
    .filter(Boolean).length;
  slot.element.classList.toggle("connected", Boolean(source));
  slot.element.classList.toggle("ready", Boolean(source?.image));
  slot.badge.textContent = String(connectedNumber || slotIndex + 1);
  slot.badge.hidden = !source;
  slot.label.textContent = source ? `Image ${connectedNumber}` : `Reference ${slotIndex + 1}`;
  if (source?.image?.url) {
    const version = source.image.completedAt || source.image.id || "ready";
    slot.preview.src = `${source.image.url}?v=${encodeURIComponent(version)}`;
    slot.preview.alt = `Image ${connectedNumber}: ${source.label}`;
    slot.preview.hidden = false;
    slot.empty.hidden = true;
  } else {
    slot.preview.hidden = true;
    slot.preview.removeAttribute("src");
    slot.empty.hidden = false;
    slot.empty.textContent = source ? `${source.label} not run` : `Image ${slotIndex + 1}`;
  }
}

function refreshConnectionOptions() {
  for (const stage of stages) {
    const values = validConnectionValues(stage);
    stage.inputNodeIds = stage.inputNodeIds.map((value) =>
      value && values.has(value) ? value : "",
    );
    compactStageInputs(stage);
    stage.inputSlots.forEach((_, index) => refreshReferenceSlot(stage, index, values));
    updateStageMode(stage);
  }
  refreshOutputOptions();
  updateWorkflowSummary();
  renderStageTabs();
  updateWires();
}

function updateOutputNode(output) {
  const stage = stageById(output.sourceStageId);
  const result = stage?.output;
  const usingUpscaled = Boolean(output.useUpscaled && result?.pidUrl);
  const displayUrl = usingUpscaled ? result.pidUrl : result?.url;
  const version = usingUpscaled ? result.pidCompletedAt : result?.completedAt;
  output.node.querySelector(".output-node-title").textContent = output.label;
  if (displayUrl) {
    output.image.src = `${displayUrl}?v=${encodeURIComponent(version ?? "ready")}`;
    output.image.alt = `${stage.label} ${usingUpscaled ? "NVIDIA PiD 4x" : "native"} output`;
    output.image.hidden = false;
    output.placeholder.hidden = true;
  } else {
    output.image.hidden = true;
    output.image.removeAttribute("src");
    output.placeholder.hidden = false;
    output.placeholder.textContent = stage
      ? `Run ${stage.label} to display its output`
      : "Connect a Klein node";
  }
  output.pidButton.classList.toggle("upscaling", output.upscaling);
  output.pidButtonText.textContent = output.upscaling
    ? "Upscaling…"
    : result?.pidUrl
      ? "Show PiD 4×"
      : "4× NVIDIA PiD";
  output.pidButton.disabled =
    workflowBusy || anyAssistantBusy() || anyImageBusy() || !pidReady || !result?.url;
  output.originalButton.hidden = !usingUpscaled;
  output.downloadButton.disabled = !displayUrl;
  output.expandButton.disabled = !displayUrl;
  output.status.classList.toggle("ready", Boolean(result?.pidUrl));
  output.status.classList.toggle("error", Boolean(output.pidError));
  output.status.textContent = output.pidError
    ? output.pidError
    : output.upscaling
      ? "Running NVIDIA PiD's FLUX.2 decoder at 4× on the GPU…"
      : usingUpscaled
        ? "Displaying the cached NVIDIA PiD 4× result."
        : result?.pidUrl
          ? "NVIDIA PiD 4× result is cached for this Klein output."
          : !result?.url
            ? "Run the connected Klein node before upscaling."
            : pidReady
              ? "Ready for optional NVIDIA PiD 4× upscaling."
              : "NVIDIA PiD is still preparing in the Colab runtime.";
}

function refreshOutputOptions() {
  for (const output of outputNodes) {
    if (!stageById(output.sourceStageId)) {
      output.sourceStageId = stages[0]?.id ?? null;
    }
    output.select.replaceChildren(makeOption("", "No Klein connected"));
    for (const stage of stages) {
      output.select.append(makeOption(stage.id, stage.label));
    }
    output.select.value = output.sourceStageId ?? "";
    updateOutputNode(output);
  }
}

function addOutputNode({ sourceStageId = selectedStageId ?? stages.at(-1)?.id ?? null } = {}) {
  if (workflowBusy || outputNodes.length >= 8) {
    toast(workflowBusy ? "Wait for the active GPU task" : "Maximum 8 output nodes");
    return;
  }
  const node = elements.outputTemplate.content.firstElementChild.cloneNode(true);
  const output = {
    id: `output-${nextOutputNumber}`,
    label: `Output ${nextOutputNumber}`,
    node,
    select: node.querySelector(".output-source"),
    image: node.querySelector(".output-node-image"),
    placeholder: node.querySelector(".output-node-placeholder"),
    pidButton: node.querySelector(".pid-upscale-output"),
    pidButtonText: node.querySelector(".pid-button-text"),
    originalButton: node.querySelector(".original-output"),
    downloadButton: node.querySelector(".download-node-output"),
    expandButton: node.querySelector(".expand-node-output"),
    status: node.querySelector(".pid-output-status"),
    sourceStageId: stageById(sourceStageId) ? sourceStageId : stages[0]?.id ?? null,
    useUpscaled: false,
    upscaling: false,
    pidError: null,
  };
  nextOutputNumber += 1;
  node.id = output.id;
  node.dataset.outputId = output.id;
  outputNodes.push(output);
  canvas.append(node);
  attachNode(node);
  output.select.addEventListener("change", () => {
    output.sourceStageId = output.select.value || null;
    output.useUpscaled = false;
    output.pidError = null;
    updateOutputNode(output);
    updateWires();
  });
  output.pidButton.addEventListener("click", () => void upscaleOutput(output));
  output.originalButton.addEventListener("click", () => {
    output.useUpscaled = false;
    updateOutputNode(output);
  });
  output.downloadButton.addEventListener("click", () => downloadOutputNode(output));
  output.expandButton.addEventListener("click", () => expandOutputNode(output));
  node.querySelector(".remove-output-node").addEventListener("click", () => {
    if (workflowBusy) {
      toast("Wait for the active GPU task");
      return;
    }
    const index = outputNodes.indexOf(output);
    if (index >= 0) {
      outputNodes.splice(index, 1);
      node.remove();
      layoutNodes();
      updateWires();
    }
  });
  refreshOutputOptions();
  layoutNodes();
  selectNode(node);
  setBusy(workflowBusy);
}

function downloadOutputNode(output) {
  if (output.image.hidden || !output.image.src) {
    toast("Run the connected Klein node first");
    return;
  }
  const link = document.createElement("a");
  link.href = output.image.src;
  link.download = `cpdif-${output.sourceStageId}${output.useUpscaled ? "-pid4x" : ""}.png`;
  link.click();
}

function expandOutputNode(output) {
  if (output.image.hidden || !output.image.src) {
    toast("Run the connected Klein node first");
    return;
  }
  const stage = stageById(output.sourceStageId);
  elements.modalTitle.textContent = `${stage?.label ?? output.label}${output.useUpscaled ? " · NVIDIA PiD 4×" : ""}`;
  elements.modalImage.replaceChildren(output.image.cloneNode());
  elements.modal.showModal();
}

async function upscaleOutput(output) {
  const stage = stageById(output.sourceStageId);
  const result = stage?.output;
  if (!result?.url || workflowBusy || anyAssistantBusy() || anyImageBusy()) {
    return;
  }
  if (result.pidUrl) {
    output.useUpscaled = true;
    output.pidError = null;
    updateOutputNode(output);
    return;
  }
  runningStageId = null;
  runningOutputId = output.id;
  output.upscaling = true;
  output.pidError = null;
  elements.error.textContent = "";
  elements.jobStatus.textContent = "Running NVIDIA PiD 4×";
  elements.jobLog.textContent = `Upscaling ${stage.label} with NVIDIA PiD's FLUX.2 pixel decoder…`;
  setBusy(true);
  try {
    const payload = await api(
      `/api/jobs/${result.jobId}/images/${result.stageId}/upscale`,
      { method: "POST" },
    );
    result.pidUrl = payload.image.url;
    result.pidCompletedAt = new Date().toISOString();
    output.useUpscaled = true;
    for (const candidate of outputNodes.filter(
      ({ sourceStageId }) => sourceStageId === stage.id,
    )) {
      candidate.pidError = null;
      updateOutputNode(candidate);
    }
    elements.jobStatus.textContent = "NVIDIA PiD 4× complete";
    elements.jobLog.textContent = payload.image.cached
      ? "Reused the cached NVIDIA PiD 4× image."
      : "NVIDIA PiD 4× image is ready and cached with this Klein output.";
    toast("NVIDIA PiD 4× output ready");
  } catch (error) {
    output.pidError = error.message;
    elements.error.textContent = error.message;
    elements.jobStatus.textContent = "NVIDIA PiD failed";
  } finally {
    output.upscaling = false;
    runningOutputId = null;
    setBusy(false);
    refreshOutputOptions();
  }
}

function updateStageMode(stage) {
  const edit = stageHasInput(stage);
  const referenceCount = connectedInputIds(stage).length;
  const badge = stage.node.querySelector(".mode-badge");
  badge.textContent = edit ? "Edit" : "Generate";
  badge.classList.toggle("edit", edit);
  stage.node.classList.toggle("edit-mode", edit);
  stage.node.querySelector(".prompt-label").textContent = edit
    ? "What should change?"
    : "Describe the image";
  stage.node.querySelector(".mode-hint").textContent = edit
    ? `${stageInputLabel(stage)} · Edit mode`
    : "No image connected · Generate mode";
  stage.node.querySelector(".reference-count").textContent = `${referenceCount} / 4 connected`;
  stage.node.querySelector(".run-workflow-text").textContent = edit
    ? "◈ Edit image"
    : "✦ Generate";
  stage.node.querySelector(".node-status").textContent = edit
    ? `Ready to edit with ${referenceCount} ordered reference${referenceCount === 1 ? "" : "s"}`
    : "Ready to generate from text";
}

function stagePayload(stage) {
  const imageInputs = stageInputSources(stage).map((source, index) => {
    if (!source.image) {
      throw new Error(`Image ${index + 1} (${source.label}) is not ready. Run or upload it first.`);
    }
    return source.kind === "image"
      ? { type: "upload", imageId: source.source.serverId }
      : {
          type: "job",
          jobId: source.stage.output.jobId,
          stageId: source.stage.output.stageId,
        };
  });
  return {
    stages: [
      {
        id: stage.id,
        imageInputs,
        prompt: stage.prompt.value,
        width: Number(stage.size.value),
        height: Number(stage.size.value),
        seed: Number(stage.seed.value),
      },
    ],
  };
}

async function runWorkflowFromStage(stageId) {
  const stage = stageById(stageId);
  if (!stage || workflowBusy) {
    return;
  }
  if (!stage.prompt.checkValidity() || !stage.seed.checkValidity()) {
    stage.prompt.reportValidity();
    stage.seed.reportValidity();
    return;
  }
  window.clearTimeout(pollTimer);
  elements.error.textContent = "";
  runningStageId = stage.id;
  activeStageId = stage.id;
  elements.jobLog.textContent = `Waiting for ${stage.label} native runtime output…`;
  setBusy(true);
  try {
    const job = await api("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stagePayload(stage)),
    });
    activeJobId = job.id;
    renderJob(job);
    void pollJob();
  } catch (error) {
    elements.error.textContent = error.message;
    runningStageId = null;
    setBusy(false);
  }
}

function updateWorkflowSummary() {
  const edits = stages.filter(stageHasInput).length;
  const generates = stages.length - edits;
  elements.workflowSummary.textContent = `${generates} Generate · ${edits} Edit`;
}

function createReferenceSlots(stage) {
  const grid = stage.node.querySelector(".reference-grid");
  stage.inputSlots = Array.from({ length: 4 }, (_, slotIndex) => {
    const element = document.createElement("label");
    element.className = "reference-slot";
    const port = document.createElement("span");
    port.className = "port port-in";
    const previewWrap = document.createElement("span");
    previewWrap.className = "reference-preview";
    const preview = document.createElement("img");
    preview.hidden = true;
    const empty = document.createElement("span");
    empty.className = "reference-empty";
    empty.textContent = `Image ${slotIndex + 1}`;
    const badge = document.createElement("span");
    badge.className = "reference-number";
    badge.hidden = true;
    previewWrap.append(preview, empty, badge);
    const controls = document.createElement("span");
    controls.className = "reference-controls";
    const label = document.createElement("strong");
    label.textContent = `Reference ${slotIndex + 1}`;
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Reference image ${slotIndex + 1}`);
    controls.append(label, select);
    element.append(port, previewWrap, controls);
    grid.append(element);
    select.addEventListener("change", () => {
      const next = select.value;
      if (
        next &&
        stage.inputNodeIds.some((value, index) => index !== slotIndex && value === next)
      ) {
        toast("Each reference image can be connected only once");
        select.value = stage.inputNodeIds[slotIndex] || "";
        return;
      }
      stage.inputNodeIds[slotIndex] = next;
      compactStageInputs(stage);
      refreshConnectionOptions();
    });
    return { element, preview, empty, badge, label, select };
  });
}

function addStage({ connectPrevious = true } = {}) {
  if (workflowBusy || anyAssistantBusy() || anyImageBusy() || stages.length >= 8) {
    toast(
      workflowBusy || anyAssistantBusy() || anyImageBusy()
        ? "Wait for the active workflow"
        : "Maximum 8 Klein nodes",
    );
    return;
  }
  const id = `klein-${nextStageNumber}`;
  const label = `Klein ${nextStageNumber}`;
  const node = elements.template.content.firstElementChild.cloneNode(true);
  node.id = id;
  node.dataset.stageId = id;
  node.querySelector(".node-title").textContent = label;
  const prompt = node.querySelector(".stage-prompt");
  const size = node.querySelector(".stage-size");
  const seed = node.querySelector(".stage-seed");
  const improve = node.querySelector(".improve-prompt");
  const undo = node.querySelector(".undo-prompt");
  seed.value = String(20260731 + stages.length);
  prompt.value = stages.length === 0
    ? "A realistic orange tabby cat sitting in a softly lit gray studio, full body, centered composition"
    : "Keep the same subject and composition. Dress the subject in a fitted black business suit with a white shirt and black tie.";
  const stage = {
    id,
    label,
    node,
    prompt,
    size,
    seed,
    improve,
    undo,
    inputNodeIds: [
      connectPrevious && stages.at(-1) ? `stage:${stages.at(-1).id}` : "",
      "",
      "",
      "",
    ],
    inputSlots: [],
    output: null,
    previousPrompt: null,
    assistantBusy: false,
  };
  stages.push(stage);
  nextStageNumber += 1;
  elements.form.append(node);
  attachNode(node);
  createReferenceSlots(stage);
  prompt.addEventListener("input", () => updateCounter(stage));
  prompt.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void runWorkflowFromStage(stage.id);
    }
  });
  node.querySelector(".remove-node").addEventListener("click", () => removeStage(stage.id));
  node.querySelector(".run-workflow").addEventListener("click", () => {
    void runWorkflowFromStage(stage.id);
  });
  node.querySelector(".cancel-workflow").addEventListener("click", cancelWorkflow);
  improve.addEventListener("click", () => void improvePrompt(stage));
  undo.addEventListener("click", () => undoPrompt(stage));
  updateCounter(stage);
  refreshConnectionOptions();
  layoutNodes();
  selectNode(node);
  setBusy(workflowBusy);
}

function updateImageSourceNode(source, image = null) {
  const preview = source.node.querySelector(".image-source-preview");
  const empty = source.node.querySelector(".image-empty-state");
  const state = source.node.querySelector(".image-node-state");
  const name = source.node.querySelector(".image-source-name");
  const size = source.node.querySelector(".image-source-size");
  const status = source.node.querySelector(".image-source-status");
  state.classList.toggle("uploading", source.uploading);
  state.classList.toggle("ready", Boolean(source.serverId) && !source.uploading);
  if (source.uploading) {
    state.textContent = "Uploading";
    status.textContent = "Uploading the reference image to this runtime…";
    status.classList.remove("error");
    return;
  }
  if (image) {
    preview.src = `${image.url}?v=${encodeURIComponent(image.id)}`;
    preview.hidden = false;
    empty.hidden = true;
    state.textContent = "Ready";
    name.textContent = image.filename;
    size.textContent = `${image.width} × ${image.height} · ${formatBytes(image.sizeBytes)}`;
    status.textContent = "Ready to connect to a Klein image input.";
    status.classList.remove("error");
    return;
  }
  state.textContent = "Empty";
  preview.hidden = true;
  preview.removeAttribute("src");
  empty.hidden = false;
  name.textContent = "No image selected";
  size.textContent = "Ready to upload";
  status.textContent = "Upload an image, then connect it to a Klein node.";
}

async function uploadImageSource(source, file) {
  if (workflowBusy || anyAssistantBusy() || anyImageBusy()) {
    toast("Wait for the active workflow");
    return;
  }
  if (!file || !["image/png", "image/jpeg"].includes(file.type)) {
    const status = source.node.querySelector(".image-source-status");
    status.textContent = "Choose a PNG or JPEG image.";
    status.classList.add("error");
    return;
  }
  if (file.size > 32 * 1024 * 1024) {
    const status = source.node.querySelector(".image-source-status");
    status.textContent = "Reference images must be 32 MB or smaller.";
    status.classList.add("error");
    return;
  }
  const previousServerId = source.serverId;
  source.uploading = true;
  updateImageSourceNode(source);
  setBusy(workflowBusy);
  try {
    const payload = await api("/api/images", {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "X-CPDif-Filename": encodeURIComponent(file.name),
      },
      body: file,
    });
    source.serverId = payload.image.id;
    source.image = payload.image;
    source.uploading = false;
    updateImageSourceNode(source, payload.image);
    const target = stageById(source.connectStageId);
    const targetSlot = target?.inputNodeIds.findIndex((value) => !value) ?? -1;
    if (target && targetSlot >= 0) {
      target.inputNodeIds[targetSlot] = `image:${source.id}`;
    }
    refreshConnectionOptions();
    if (previousServerId && previousServerId !== source.serverId) {
      void fetch(`/api/images/${previousServerId}`, { method: "DELETE" });
    }
    toast(
      target && target.inputNodeIds.includes(`image:${source.id}`)
        ? `Image connected to ${target.label}`
        : "Reference image ready",
    );
  } catch (error) {
    source.uploading = false;
    updateImageSourceNode(source, source.image);
    const status = source.node.querySelector(".image-source-status");
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    source.fileInput.value = "";
    setBusy(workflowBusy);
  }
}

function addImageSource() {
  if (workflowBusy || anyAssistantBusy() || anyImageBusy() || imageSources.length >= 16) {
    toast(
      imageSources.length >= 16 ? "Maximum 16 image nodes" : "Wait for the active workflow",
    );
    return;
  }
  const id = `image-${nextImageNumber}`;
  const label = `Image ${nextImageNumber}`;
  const node = elements.imageTemplate.content.firstElementChild.cloneNode(true);
  node.id = id;
  node.dataset.imageSourceId = id;
  node.querySelector(".image-node-title").textContent = label;
  const title = node.querySelector(".image-node-title").parentElement;
  const numberBadge = document.createElement("span");
  numberBadge.className = "image-number-badge";
  numberBadge.textContent = String(nextImageNumber);
  title.append(numberBadge);
  const fileInput = node.querySelector(".image-file-input");
  const selectedStage = stageById(selectedStageId);
  const source = {
    id,
    label,
    node,
    badgeNode: numberBadge,
    fileInput,
    serverId: null,
    image: null,
    uploading: false,
    connectStageId:
      selectedStage && connectedInputIds(selectedStage).length < 4
        ? selectedStage.id
        : null,
  };
  imageSources.push(source);
  nextImageNumber += 1;
  canvas.append(node);
  attachNode(node);
  node.querySelector(".choose-image").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files;
    if (file) {
      void uploadImageSource(source, file);
    }
  });
  node.querySelector(".remove-image-node").addEventListener("click", () => {
    removeImageSource(source.id);
  });
  updateImageSourceNode(source);
  refreshConnectionOptions();
  layoutNodes();
  selectNode(node);
  setBusy(workflowBusy);
}

function removeImageSource(id) {
  if (workflowBusy || anyAssistantBusy() || anyImageBusy()) {
    toast("Wait for the active workflow");
    return;
  }
  const index = imageSources.findIndex((source) => source.id === id);
  if (index < 0) {
    return;
  }
  const [source] = imageSources.splice(index, 1);
  for (const stage of stages) {
    stage.inputNodeIds = stage.inputNodeIds.map((value) =>
      value === `image:${id}` ? "" : value,
    );
    compactStageInputs(stage);
  }
  source.node.remove();
  if (source.badgeNode) {
    source.badgeNode.remove();
  }
  if (source.serverId) {
    void fetch(`/api/images/${source.serverId}`, { method: "DELETE" });
  }
  refreshConnectionOptions();
  layoutNodes();
  setBusy(workflowBusy);
  toast("Image node removed");
}

function removeStage(id) {
  if (workflowBusy || anyAssistantBusy() || anyImageBusy()) {
    toast("Wait for the active workflow");
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
    stage.inputNodeIds = stage.inputNodeIds.map((value) =>
      value === `stage:${id}` ? "" : value,
    );
    compactStageInputs(stage);
  }
  for (const output of outputNodes) {
    if (output.sourceStageId === id) {
      output.sourceStageId = stages[0]?.id ?? null;
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

function setBusy(busy) {
  workflowBusy = busy;
  const promptBusy = anyAssistantBusy();
  const imageBusy = anyImageBusy();
  for (const stage of stages) {
    const run = stage.node.querySelector(".run-workflow");
    const cancel = stage.node.querySelector(".cancel-workflow");
    run.disabled = busy || promptBusy || imageBusy || !runtimeReady;
    run.classList.toggle("generating", busy && runningStageId === stage.id);
    cancel.hidden = !(busy && runningStageId === stage.id);
    for (const slot of stage.inputSlots) {
      slot.select.disabled = busy || promptBusy || imageBusy;
    }
  }
  for (const source of imageSources) {
    source.node.querySelector(".choose-image").disabled = busy || promptBusy || imageBusy;
    source.node.querySelector(".remove-image-node").disabled = busy || promptBusy || imageBusy;
  }
  for (const output of outputNodes) {
    output.select.disabled = busy || promptBusy || imageBusy;
    output.node.querySelector(".remove-output-node").disabled = busy || promptBusy || imageBusy;
    updateOutputNode(output);
  }
  elements.addNode.disabled = busy || promptBusy || imageBusy || stages.length >= 8;
  elements.addImageNode.disabled =
    busy || promptBusy || imageBusy || imageSources.length >= 16;
  elements.addOutputNode.disabled = busy || promptBusy || imageBusy || outputNodes.length >= 8;
  elements.loading.hidden = !busy;
  window.clearInterval(loadingTimer);
  if (busy) {
    const messages = runningOutputId
      ? [
          "Loading NVIDIA PiD's FLUX.2 decoder…",
          "Encoding the Klein output with the FLUX.2 VAE…",
          "Running the 4-step PiD pixel decoder…",
          "Saving the 4× PNG…",
        ]
      : [
          `Loading ${stageById(runningStageId)?.label ?? "the Klein node"}…`,
          "Encoding ordered reference images…",
          "Caching reference attention for this edit…",
          "Decoding this node's output…",
        ];
    let index = 0;
    elements.loadingText.textContent = messages[index];
    loadingTimer = window.setInterval(() => {
      index = (index + 1) % messages.length;
      elements.loadingText.textContent = messages[index];
    }, 1500);
  }
  updateAllAssistantControls();
}

function renderStageTabs(job = latestJob) {
  elements.stageTabs.replaceChildren();
  for (const stage of stages) {
    const button = document.createElement("button");
    const mode = stageHasInput(stage) ? "Edit" : "Generate";
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

function setActiveStage(id) {
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
  elements.activeMode.textContent = stageHasInput(stage) ? "Edit" : "Generate";
  elements.activeStage.textContent = stage.label;
  elements.outputSize.textContent = `${stage.size.value} × ${stage.size.value}`;
  const timing = stage.output?.generationMs;
  elements.activeTime.textContent = Number.isFinite(timing) ? formatMs(timing) : "Ready";
  const imageUrl = stage.output?.url;
  if (imageUrl) {
    const version = encodeURIComponent(stage.output.completedAt);
    elements.outputImage.src = `${imageUrl}?v=${version}`;
    elements.outputImage.alt = `${stage.label} ${stageHasInput(stage) ? "edited" : "generated"} output`;
    elements.outputImage.hidden = false;
    elements.outputPlaceholder.hidden = true;
  } else {
    elements.outputImage.hidden = true;
    elements.outputImage.removeAttribute("src");
    elements.outputPlaceholder.hidden = false;
  }
}

function showCompletedJob(job) {
  latestJob = job;
  const completedId = job.input?.stages?.[0]?.id ?? runningStageId;
  const stage = stageById(completedId);
  if (stage && job.images?.[completedId]) {
    stage.output = {
      jobId: job.id,
      stageId: completedId,
      url: job.images[completedId],
      completedAt: job.completedAt,
      generationMs: job.telemetry?.[completedId]?.generation_ms,
    };
    stage.node.querySelector(".node-status").textContent = "Output ready";
    refreshConnectionOptions();
    setActiveStage(completedId);
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
    if (active.has(stage.id)) {
      status.textContent = `Running only ${stage.label} (${stageHasInput(stage) ? "Edit" : "Generate"}) on CUDA…`;
    }
  }
  if (job.status === "completed") {
    showCompletedJob(job);
    toast(`${stageById(runningStageId)?.label ?? "Klein node"} completed`);
  }
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    if (job.error) {
      elements.error.textContent = job.error;
      const stage = stageById(runningStageId);
      if (stage) {
        stage.node.querySelector(".node-status").textContent = job.error;
      }
    }
    activeJobId = null;
    runningStageId = null;
    setBusy(false);
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
    activeJobId = null;
    runningStageId = null;
    setBusy(false);
  }
}

async function checkRuntime() {
  elements.runtimeDot.classList.remove("ready", "error");
  try {
    const status = await api("/api/status");
    runtimeReady = status.ready;
    pidReady = status.features?.pidUpscale?.ready === true;
    elements.runtimeDot.classList.toggle("ready", status.ready);
    elements.runtimeLabel.textContent = status.ready ? "Runtime ready" : "Runtime incomplete";
    const missing = Object.entries(status.checks)
      .filter(([, ready]) => !ready)
      .map(([name]) => name);
    elements.runtimeDetail.textContent = status.ready
      ? `${status.profile}${status.maxVram ? ` · ${status.maxVram} GiB graph budget` : ""}${pidReady ? " · PiD 4×" : ""}`
      : `Missing: ${missing.join(", ")}`;
  } catch (error) {
    runtimeReady = false;
    pidReady = false;
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
  const stage = stageById(selectedStageId) ?? stages.at(-1);
  if (!stage) {
    return;
  }
  await runWorkflowFromStage(stage.id);
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
elements.addImageNode.addEventListener("click", addImageSource);
elements.addOutputNode.addEventListener("click", () => addOutputNode());
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
attachNode(elements.loraNode);
attachNode(elements.workflowPanel);
window.addEventListener("resize", updateWires);
if (window.ResizeObserver) {
  new ResizeObserver(updateWires).observe(canvas);
}

addStage({ connectPrevious: false });
addOutputNode({ sourceStageId: stages[0].id });
setActiveStage(stages[0].id);
updateZoom();
void checkRuntime();
void checkPromptAssistant();
void loadLoras();
