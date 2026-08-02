const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const canvas = $("#canvas");
const elements = {
  form: $("#job-form"),
  submit: $("#submit-button"),
  submitText: $("#generate-text"),
  cancel: $("#cancel-button"),
  error: $("#form-error"),
  runtimeDot: $("#runtime-dot"),
  runtimeLabel: $("#runtime-label"),
  runtimeDetail: $("#runtime-detail"),
  fluxState: $("#flux-state"),
  jobStatus: $("#job-status"),
  jobLog: $("#job-log"),
  prompt: $("#prompt"),
  editPrompt: $("#edit-prompt"),
  promptCounter: $("#prompt-counter"),
  editCounter: $("#edit-counter"),
  sourceImage: $("#source-image"),
  editedImage: $("#edited-image"),
  sourcePlaceholder: $("#source-placeholder"),
  editedPlaceholder: $("#edited-placeholder"),
  sourceTime: $("#source-time"),
  editedTime: $("#edited-time"),
  outputSize: $("#output-size"),
  activeTime: $("#active-time"),
  loading: $("#loading"),
  loadingText: $("#loading-text"),
  modal: $("#image-modal"),
  modalImage: $("#modal-image"),
  modalTitle: $("#modal-title"),
  toast: $("#toast"),
};

const defaultLayout = {
  "source-node": [60, 135, 310, 380],
  "flux-node": [440, 72, 410, 440],
  "output-node": [930, 62, 400, 520],
};

let activeJobId = null;
let activeView = "edited";
let pollTimer = null;
let loadingTimer = null;
let zoom = 1;

function formatMs(value) {
  return Number.isFinite(value) ? `${(value / 1000).toFixed(2)} s` : "—";
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

function selectNode(node) {
  $$(".node").forEach((candidate) => {
    candidate.classList.toggle("selected", candidate === node);
  });
}

function curve(from, to, path) {
  const canvasRect = canvas.getBoundingClientRect();
  const fromRect = from.getBoundingClientRect();
  const toRect = to.getBoundingClientRect();
  const x1 = (fromRect.right - canvasRect.left) / zoom;
  const y1 = (fromRect.top + fromRect.height / 2 - canvasRect.top) / zoom;
  const x2 = (toRect.left - canvasRect.left) / zoom;
  const y2 = (toRect.top + toRect.height / 2 - canvasRect.top) / zoom;
  const bend = Math.max(65, Math.abs(x2 - x1) * 0.44);
  path.setAttribute(
    "d",
    `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
  );
}

function updateWires() {
  curve($("#source-node"), $("#flux-node"), $("#wire-source"));
  curve($("#flux-node"), $("#output-node"), $("#wire-output"));
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
    if (event.target.closest("button")) {
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

function resetLayout() {
  for (const [id, values] of Object.entries(defaultLayout)) {
    const node = document.getElementById(id);
    [node.style.left, node.style.top, node.style.width, node.style.height] = values.map(
      (value) => `${value}px`,
    );
  }
  zoom = 1;
  updateZoom();
  toast("Layout reset");
}

function updateCounter(input, counter) {
  counter.textContent = `${input.value.length} / 4000`;
}

function activeOutput() {
  return {
    image: activeView === "source" ? elements.sourceImage : elements.editedImage,
    time: activeView === "source" ? elements.sourceTime.textContent : elements.editedTime.textContent,
  };
}

function setView(view) {
  activeView = view;
  $$("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$("[data-output]").forEach((layer) => {
    const active = layer.dataset.output === view;
    layer.classList.toggle("active", active);
    layer.hidden = !active;
  });
  const output = activeOutput();
  elements.activeTime.textContent = output.time === "—" ? "Ready" : output.time;
}

function setBusy(busy) {
  elements.submit.disabled = busy;
  elements.submit.classList.toggle("generating", busy);
  elements.submitText.textContent = busy ? "Generating…" : "✦ Generate + edit";
  elements.cancel.hidden = !busy;
  elements.loading.hidden = !busy;
  window.clearInterval(loadingTimer);
  if (busy) {
    const messages = [
      "Encoding the source prompt…",
      "Sampling the source image…",
      "Caching reference attention…",
      "Applying the edit instruction…",
      "Decoding the KV result…",
    ];
    let index = 0;
    elements.loadingText.textContent = messages[index];
    loadingTimer = window.setInterval(() => {
      index = (index + 1) % messages.length;
      elements.loadingText.textContent = messages[index];
    }, 1500);
  }
}

function resetResults() {
  for (const image of [elements.sourceImage, elements.editedImage]) {
    image.hidden = true;
    image.removeAttribute("src");
  }
  elements.sourcePlaceholder.hidden = false;
  elements.editedPlaceholder.hidden = false;
  elements.sourceTime.textContent = "—";
  elements.editedTime.textContent = "—";
  elements.activeTime.textContent = "Running";
  elements.jobLog.textContent = "Waiting for native runtime output…";
}

function showCompletedJob(job) {
  const version = encodeURIComponent(job.completedAt);
  elements.sourceImage.src = `${job.images.source}?v=${version}`;
  elements.editedImage.src = `${job.images.edited}?v=${version}`;
  elements.sourceImage.hidden = false;
  elements.editedImage.hidden = false;
  elements.sourcePlaceholder.hidden = true;
  elements.editedPlaceholder.hidden = true;
  elements.sourceTime.textContent = formatMs(job.telemetry?.source?.generation_ms);
  elements.editedTime.textContent = formatMs(job.telemetry?.edited?.generation_ms);
  setView("edited");
}

function renderJob(job) {
  const labels = {
    queued: "Queued behind the active GPU job",
    running: "Running on CUDA",
    cancelling: "Stopping native process",
    cancelled: "Job stopped",
    failed: "Native job failed",
    completed: "KV edit complete",
  };
  elements.jobStatus.textContent = labels[job.status] ?? job.status;
  elements.jobLog.textContent = job.log || "Waiting for native runtime output…";
  if (job.status === "completed") {
    showCompletedJob(job);
    toast("Native edit completed");
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
  elements.fluxState.classList.remove("ready", "error");
  try {
    const status = await api("/api/status");
    elements.runtimeDot.classList.toggle("ready", status.ready);
    elements.fluxState.classList.toggle("ready", status.ready);
    elements.fluxState.classList.toggle("error", !status.ready);
    elements.runtimeLabel.textContent = status.ready ? "Runtime ready" : "Runtime incomplete";
    elements.fluxState.textContent = status.ready ? "Ready" : "Incomplete";
    const missing = Object.entries(status.checks)
      .filter(([, ready]) => !ready)
      .map(([name]) => name);
    elements.runtimeDetail.textContent = status.ready
      ? `${status.profile}${status.maxVram ? ` · ${status.maxVram} GiB graph budget` : ""}`
      : `Missing: ${missing.join(", ")}`;
    elements.submit.disabled = !status.ready;
  } catch (error) {
    elements.runtimeDot.classList.add("error");
    elements.fluxState.classList.add("error");
    elements.runtimeLabel.textContent = "Runtime unavailable";
    elements.runtimeDetail.textContent = error.message;
    elements.fluxState.textContent = "Offline";
    elements.submit.disabled = true;
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  window.clearTimeout(pollTimer);
  elements.error.textContent = "";
  resetResults();
  setView("edited");
  setBusy(true);
  const data = new FormData(elements.form);
  const size = Number(data.get("size"));
  elements.outputSize.textContent = `${size} × ${size}`;
  try {
    const job = await api("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: data.get("prompt"),
        editPrompt: data.get("editPrompt"),
        width: size,
        height: size,
        seed: Number(data.get("seed")),
      }),
    });
    activeJobId = job.id;
    renderJob(job);
    void pollJob();
  } catch (error) {
    elements.error.textContent = error.message;
    setBusy(false);
  }
});

elements.cancel.addEventListener("click", async () => {
  if (!activeJobId) {
    return;
  }
  elements.cancel.disabled = true;
  try {
    renderJob(
      await api(`/api/jobs/${activeJobId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch (error) {
    elements.error.textContent = error.message;
  } finally {
    elements.cancel.disabled = false;
  }
});

for (const input of [elements.prompt, elements.editPrompt]) {
  input.addEventListener("input", () =>
    updateCounter(
      input,
      input === elements.prompt ? elements.promptCounter : elements.editCounter,
    ),
  );
  input.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });
}

for (const button of $$("[data-view]")) {
  button.addEventListener("click", () => setView(button.dataset.view));
}

$("#size").addEventListener("change", (event) => {
  elements.outputSize.textContent = `${event.target.value} × ${event.target.value}`;
});

$("#copy-prompt").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements.editPrompt.value);
    toast("Edit instruction copied");
  } catch {
    toast("Clipboard unavailable");
  }
});

$("#download-output").addEventListener("click", () => {
  const { image } = activeOutput();
  if (image.hidden || !image.src) {
    toast("Run a job first");
    return;
  }
  const link = document.createElement("a");
  link.href = image.src;
  link.download = `cpdif-${activeView}.png`;
  link.click();
});

$("#expand-output").addEventListener("click", () => {
  const { image } = activeOutput();
  if (image.hidden || !image.src) {
    toast("Run a job first");
    return;
  }
  elements.modalTitle.textContent = activeView === "source" ? "Source output" : "Edited output";
  elements.modalImage.replaceChildren(image.cloneNode());
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

$$(".node").forEach(attachNode);
window.addEventListener("resize", updateWires);
if (window.ResizeObserver) {
  new ResizeObserver(updateWires).observe(canvas);
}

updateCounter(elements.prompt, elements.promptCounter);
updateCounter(elements.editPrompt, elements.editCounter);
setView("edited");
updateWires();
void checkRuntime();
