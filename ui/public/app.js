const elements = {
  form: document.querySelector("#job-form"),
  submit: document.querySelector("#submit-button"),
  cancel: document.querySelector("#cancel-button"),
  error: document.querySelector("#form-error"),
  runtimeDot: document.querySelector("#runtime-dot"),
  runtimeLabel: document.querySelector("#runtime-label"),
  runtimeDetail: document.querySelector("#runtime-detail"),
  jobStatus: document.querySelector("#job-status"),
  jobLog: document.querySelector("#job-log"),
  sourceImage: document.querySelector("#source-image"),
  editedImage: document.querySelector("#edited-image"),
  sourcePlaceholder: document.querySelector("#source-placeholder"),
  editedPlaceholder: document.querySelector("#edited-placeholder"),
  sourceTime: document.querySelector("#source-time"),
  editedTime: document.querySelector("#edited-time"),
};

let activeJobId = null;
let pollTimer = null;

function formatMs(value) {
  return Number.isFinite(value) ? `${(value / 1000).toFixed(2)} s` : "—";
}

async function api(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return payload;
}

function setBusy(busy) {
  elements.submit.disabled = busy;
  elements.cancel.hidden = !busy;
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
  elements.jobLog.textContent = "Waiting for native runtime output…";
}

function showCompletedJob(job) {
  elements.sourceImage.src = `${job.images.source}?v=${encodeURIComponent(job.completedAt)}`;
  elements.editedImage.src = `${job.images.edited}?v=${encodeURIComponent(job.completedAt)}`;
  elements.sourceImage.hidden = false;
  elements.editedImage.hidden = false;
  elements.sourcePlaceholder.hidden = true;
  elements.editedPlaceholder.hidden = true;
  elements.sourceTime.textContent = formatMs(job.telemetry?.source?.generation_ms);
  elements.editedTime.textContent = formatMs(job.telemetry?.edited?.generation_ms);
}

function renderJob(job) {
  const labels = {
    queued: "Queued behind the active GPU job…",
    running: "Running FLUX.2 Klein 9B-KV on CUDA…",
    cancelling: "Stopping the native process…",
    cancelled: "Job stopped.",
    failed: "Native job failed.",
    completed: "Edit completed with KV-cache telemetry confirmed.",
  };
  elements.jobStatus.textContent = labels[job.status] ?? job.status;
  elements.jobLog.textContent = job.log || "Waiting for native runtime output…";
  if (job.status === "completed") {
    showCompletedJob(job);
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
  try {
    const status = await api("/api/status");
    elements.runtimeDot.classList.toggle("ready", status.ready);
    elements.runtimeLabel.textContent = status.ready ? "Runtime ready" : "Runtime incomplete";
    const missing = Object.entries(status.checks)
      .filter(([, ready]) => !ready)
      .map(([name]) => name);
    elements.runtimeDetail.textContent = status.ready
      ? `${status.profile}${status.maxVram ? ` · ${status.maxVram} GiB graph budget` : ""}`
      : `Missing: ${missing.join(", ")}`;
    elements.submit.disabled = !status.ready;
  } catch (error) {
    elements.runtimeLabel.textContent = "Runtime unavailable";
    elements.runtimeDetail.textContent = error.message;
    elements.submit.disabled = true;
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  window.clearTimeout(pollTimer);
  elements.error.textContent = "";
  resetResults();
  setBusy(true);
  const data = new FormData(elements.form);
  const size = Number(data.get("size"));
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

void checkRuntime();
