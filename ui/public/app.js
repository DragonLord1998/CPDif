const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const canvas = $("#canvas");
const elements = {
  form: $("#job-form"),
  template: $("#klein-node-template"),
  imageTemplate: $("#image-node-template"),
  outputNode: $("#output-node"),
  workflowPanel: $("#workflow-panel"),
  loraNode: $("#lora-node"),
  addNode: $("#add-klein-node"),
  addImageNode: $("#add-image-node"),
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
let nextStageNumber = 1;
let nextImageNumber = 1;
let activeJobId = null;
let activeStageId = null;
let selectedStageId = null;
let latestJob = null;
let pollTimer = null;
let loadingTimer = null;
let zoom = 1;
let runtimeReady = false;
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

function stageHasInput(stage) {
  return Boolean(stage.inputStageId || stage.inputImageNodeId);
}

function stageInputLabel(stage) {
  if (stage.inputStageId) {
    return stageById(stage.inputStageId)?.label ?? "upstream Klein";
  }
  if (stage.inputImageNodeId) {
    return imageSourceByNodeId(stage.inputImageNodeId)?.label ?? "uploaded image";
  }
  return null;
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
    } else if (stage.inputImageNodeId) {
      const source = imageSourceByNodeId(stage.inputImageNodeId);
      if (source?.serverId) {
        addWire(source.node, stage.node, "wire image-wire");
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
  const sourceColumnWidth = imageSources.length > 0 ? 340 : 0;
  imageSources.forEach((source, index) => {
    source.node.style.left = "50px";
    source.node.style.top = `${80 + index * 310}px`;
    source.node.style.width = "290px";
    source.node.style.height = "280px";
  });
  const kleinLeft = 70 + sourceColumnWidth;
  stages.forEach((stage, index) => {
    stage.node.style.left = `${kleinLeft + index * 470}px`;
    stage.node.style.top = "80px";
    stage.node.style.width = "410px";
    stage.node.style.height = "440px";
  });
  const outputLeft = kleinLeft + stages.length * 470;
  elements.outputNode.style.left = `${outputLeft}px`;
  elements.outputNode.style.top = "70px";
  elements.outputNode.style.width = "400px";
  elements.outputNode.style.height = "520px";
  elements.loraNode.style.left = `${kleinLeft}px`;
  elements.loraNode.style.top = "550px";
  elements.loraNode.style.width = "410px";
  elements.loraNode.style.height = "270px";
  elements.workflowPanel.style.left = `${kleinLeft + 470}px`;
  elements.workflowPanel.style.top = stages.length === 1 ? "610px" : "550px";
  elements.workflowPanel.style.width = "410px";
  elements.workflowPanel.style.height = "220px";
  canvas.style.width = `${Math.max(1500, outputLeft + 480)}px`;
  canvas.style.height = `${Math.max(1150, 390 + imageSources.length * 310)}px`;
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

function completedReference(stage) {
  if (stage.inputImageNodeId) {
    const source = imageSourceByNodeId(stage.inputImageNodeId);
    return source?.serverId ? { sourceId: source.serverId } : null;
  }
  if (
    !stage.inputStageId ||
    latestJob?.status !== "completed" ||
    !latestJob.images?.[stage.inputStageId]
  ) {
    return null;
  }
  return { jobId: latestJob.id, stageId: stage.inputStageId };
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
  const inputStageId = stage.inputStageId;
  const inputImageNodeId = stage.inputImageNodeId;
  const mode = stageHasInput(stage) ? "edit" : "generate";
  const image = completedReference(stage);
  stage.assistantBusy = true;
  stage.node.querySelector(".node-status").textContent = image
    ? "Qwen is reading the connected image and improving this prompt…"
    : "Qwen is improving this prompt…";
  setBusy(workflowBusy);
  try {
    const result = await api("/api/prompt-assistant/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, prompt: original, ...(image ? { image } : {}) }),
    });
    if (
      stage.inputStageId !== inputStageId ||
      stage.inputImageNodeId !== inputImageNodeId
    ) {
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

function refreshConnectionOptions() {
  stages.forEach((stage, index) => {
    const previous = stages.slice(0, index);
    const select = stage.source;
    const currentStage = stage.inputStageId;
    const currentImage = stage.inputImageNodeId;
    select.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No image connected";
    select.append(none);
    for (const source of imageSources.filter(({ serverId }) => serverId)) {
      const option = document.createElement("option");
      option.value = `image:${source.id}`;
      option.textContent = `${source.label} · uploaded`;
      select.append(option);
    }
    for (const candidate of previous) {
      const option = document.createElement("option");
      option.value = `stage:${candidate.id}`;
      option.textContent = `${candidate.label} output`;
      select.append(option);
    }
    stage.inputStageId = previous.some(({ id }) => id === currentStage)
      ? currentStage
      : null;
    stage.inputImageNodeId = imageSources.some(
      ({ id, serverId }) => id === currentImage && serverId,
    )
      ? currentImage
      : null;
    select.value = stage.inputStageId
      ? `stage:${stage.inputStageId}`
      : stage.inputImageNodeId
        ? `image:${stage.inputImageNodeId}`
        : "";
    updateStageMode(stage);
  });
  updateWorkflowSummary();
  renderStageTabs();
  updateWires();
}

function updateStageMode(stage) {
  const edit = stageHasInput(stage);
  const badge = stage.node.querySelector(".mode-badge");
  badge.textContent = edit ? "Edit" : "Generate";
  badge.classList.toggle("edit", edit);
  stage.node.classList.toggle("edit-mode", edit);
  stage.node.querySelector(".prompt-label").textContent = edit
    ? "What should change?"
    : "Describe the image";
  stage.node.querySelector(".mode-hint").textContent = edit
    ? `Image connected from ${stageInputLabel(stage)} · Edit mode`
    : "No image connected · Generate mode";
  stage.node.querySelector(".run-workflow-text").textContent = edit
    ? "◈ Edit image"
    : "✦ Generate";
  stage.node.querySelector(".node-status").textContent = edit
    ? "Ready to edit the connected image"
    : "Ready to generate from text";
}

function updateWorkflowSummary() {
  const edits = stages.filter(stageHasInput).length;
  const generates = stages.length - edits;
  elements.workflowSummary.textContent = `${generates} Generate · ${edits} Edit`;
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
  const source = node.querySelector(".image-source");
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
    source,
    prompt,
    size,
    seed,
    improve,
    undo,
    inputStageId: connectPrevious ? stages.at(-1)?.id ?? null : null,
    inputImageNodeId: null,
    previousPrompt: null,
    assistantBusy: false,
  };
  stages.push(stage);
  nextStageNumber += 1;
  elements.form.append(node);
  attachNode(node);
  source.addEventListener("change", () => {
    const [kind, id] = source.value.split(":", 2);
    stage.inputStageId = kind === "stage" ? id : null;
    stage.inputImageNodeId = kind === "image" ? id : null;
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
    if (target && !stageHasInput(target)) {
      target.inputImageNodeId = source.id;
    }
    refreshConnectionOptions();
    if (previousServerId && previousServerId !== source.serverId) {
      void fetch(`/api/images/${previousServerId}`, { method: "DELETE" });
    }
    toast(
      target && target.inputImageNodeId === source.id
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
  if (workflowBusy || anyAssistantBusy() || anyImageBusy() || imageSources.length >= 4) {
    toast(
      imageSources.length >= 4 ? "Maximum 4 image nodes" : "Wait for the active workflow",
    );
    return;
  }
  const id = `image-${nextImageNumber}`;
  const label = `Image ${nextImageNumber}`;
  const node = elements.imageTemplate.content.firstElementChild.cloneNode(true);
  node.id = id;
  node.dataset.imageSourceId = id;
  node.querySelector(".image-node-title").textContent = label;
  const fileInput = node.querySelector(".image-file-input");
  const selectedStage = stageById(selectedStageId);
  const source = {
    id,
    label,
    node,
    fileInput,
    serverId: null,
    image: null,
    uploading: false,
    connectStageId:
      selectedStage && !stageHasInput(selectedStage) ? selectedStage.id : null,
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
    if (stage.inputImageNodeId === id) {
      stage.inputImageNodeId = null;
    }
  }
  source.node.remove();
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
      inputImageId: stage.inputImageNodeId
        ? imageSourceByNodeId(stage.inputImageNodeId)?.serverId ?? null
        : null,
      prompt: stage.prompt.value,
      width: Number(stage.size.value),
      height: Number(stage.size.value),
      seed: Number(stage.seed.value),
    })),
  };
}

function setBusy(busy) {
  workflowBusy = busy;
  const promptBusy = anyAssistantBusy();
  const imageBusy = anyImageBusy();
  for (const stage of stages) {
    const run = stage.node.querySelector(".run-workflow");
    const cancel = stage.node.querySelector(".cancel-workflow");
    run.disabled = busy || promptBusy || imageBusy || !runtimeReady;
    run.classList.toggle("generating", busy);
    cancel.hidden = !busy;
  }
  for (const source of imageSources) {
    source.node.querySelector(".choose-image").disabled = busy || promptBusy || imageBusy;
    source.node.querySelector(".remove-image-node").disabled = busy || promptBusy || imageBusy;
  }
  elements.addNode.disabled = busy || promptBusy || imageBusy || stages.length >= 8;
  elements.addImageNode.disabled =
    busy || promptBusy || imageBusy || imageSources.length >= 4;
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
  elements.activeMode.textContent = stageHasInput(stage) ? "Edit" : "Generate";
  elements.activeStage.textContent = stage.label;
  elements.outputSize.textContent = `${stage.size.value} × ${stage.size.value}`;
  const timing = job?.telemetry?.[id]?.generation_ms;
  elements.activeTime.textContent = Number.isFinite(timing) ? formatMs(timing) : "Ready";
  const imageUrl = job?.images?.[id];
  if (imageUrl) {
    const version = encodeURIComponent(job.completedAt);
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
      ? `Running ${stageHasInput(stage) ? "Edit" : "Generate"} on CUDA…`
      : job.status === "completed"
        ? "Output ready"
        : stageHasInput(stage)
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
elements.addImageNode.addEventListener("click", addImageSource);
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
setActiveStage(stages[0].id);
updateZoom();
void checkRuntime();
void checkPromptAssistant();
void loadLoras();
