const state = { run: null, runs: [], focusId: null, source: null };
const $ = (selector) => document.querySelector(selector);
const gallery = $("#gallery");
const template = $("#entry-template");

boot().catch((error) => {
  $("#brief").textContent = "Gallery unavailable";
  gallery.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
});

async function boot() {
  const params = new URLSearchParams(location.search);
  let runId = params.get("run");
  if (!runId) {
    const fallback = await fetchJson("/api/default-run");
    runId = fallback.runId;
  }
  state.runs = await fetchJson("/api/runs");
  $("#history-count").textContent = String(state.runs.length).padStart(2, "0");
  renderHistory();
  if (!runId && state.runs[0]) runId = state.runs[0].id;
  if (!runId) throw new Error("No Design Battle runs yet.");
  state.run = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
  render();
  connect(runId);
  setInterval(updateElapsed, 1000);
}

function connect(runId) {
  state.source?.close();
  state.source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  state.source.addEventListener("run", (event) => {
    state.run = JSON.parse(event.data);
    render();
  });
}

function render() {
  const run = state.run;
  document.title = `${run.brief.slice(0, 45)} / Design Battle`;
  $("#run-id").textContent = `${run.id} / ${run.host}`;
  $("#brief").textContent = run.brief;
  $("#host-label").textContent = `Host: ${run.host}`;
  const settled = run.entries.filter((entry) => ["ready", "failed", "cancelled"].includes(entry.status)).length;
  $("#live-label").textContent = settled === run.entries.length ? "Battle complete" : "Live generation";
  $("#scoreboard").innerHTML = ["ready", "running", "failed"].map((status) =>
    `<div class="score ${status}"><b>${run.entries.filter((entry) => entry.status === status).length}</b><span>${status}</span></div>`
  ).join("");

  for (const [index, entry] of run.entries.entries()) {
    let card = gallery.querySelector(`[data-entry="${CSS.escape(entry.id)}"]`);
    if (!card) {
      card = template.content.firstElementChild.cloneNode(true);
      card.dataset.entry = entry.id;
      card.style.animationDelay = `${index * 70}ms`;
      card.querySelector(".entry-number").textContent = String(index + 1).padStart(2, "0");
      card.querySelector(".entry-skill").textContent = entry.skill.name;
      card.querySelector(".favorite-button").addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFavorite(entry.id);
      });
      card.querySelector(".log-button").addEventListener("click", (event) => {
        event.stopPropagation();
        showLog(entry.id);
      });
      card.addEventListener("click", () => {
        if (entryById(entry.id)?.status === "ready") openFocus(entry.id);
      });
      gallery.append(card);
    }
    card.className = `entry-card ${entry.status}${entry.favorite ? " favorite" : ""}`;
    card.querySelector(".entry-status").textContent = entry.status;
    card.querySelector(".stage-title").textContent = entry.error || entry.stage || entry.status;
    card.querySelector(".progress-state").dataset.status = entry.status;
    card.querySelector(".favorite-button").textContent = entry.favorite ? "★" : "☆";
    card.querySelector(".favorite-button").setAttribute("aria-pressed", String(Boolean(entry.favorite)));
    const frame = card.querySelector(".entry-frame");
    const source = siteUrl(entry);
    if (entry.status === "ready" && frame.dataset.source !== source) {
      frame.src = source;
      frame.dataset.source = source;
      frame.title = `${entry.skill.name} design entry`;
    }
  }
  updateElapsed();
  if (state.focusId) renderFocus();
}

function updateElapsed() {
  if (!state.run) return;
  for (const entry of state.run.entries) {
    const card = gallery.querySelector(`[data-entry="${CSS.escape(entry.id)}"]`);
    if (!card) continue;
    const start = new Date(entry.startedAt || entry.createdAt).getTime();
    const end = entry.completedAt ? new Date(entry.completedAt).getTime() : Date.now();
    card.querySelector(".stage-time").textContent = `${formatDuration(Math.max(0, end - start))} elapsed`;
  }
}

function openFocus(entryId) {
  state.focusId = entryId;
  $("#focus-view").classList.add("open");
  $("#focus-view").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderFocus();
}

function closeFocus() {
  state.focusId = null;
  $("#focus-view").classList.remove("open");
  $("#focus-view").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function renderFocus() {
  const entry = entryById(state.focusId);
  if (!entry) return closeFocus();
  const index = state.run.entries.findIndex((candidate) => candidate.id === entry.id);
  $("#focus-index").textContent = `Concept ${String(index + 1).padStart(2, "0")} / ${String(state.run.entries.length).padStart(2, "0")}`;
  $("#focus-title").textContent = entry.skill.name;
  $("#focus-favorite").textContent = entry.favorite ? "Unfavorite" : "Favorite";
  const focusFrame = $("#focus-frame");
  const source = siteUrl(entry);
  if (focusFrame.dataset.source !== source) {
    focusFrame.src = source;
    focusFrame.dataset.source = source;
  }
  $("#thumbnail-rail").innerHTML = state.run.entries.map((candidate, candidateIndex) => `
    <button class="thumb ${candidate.id === entry.id ? "active" : ""}" data-focus="${escapeHtml(candidate.id)}" ${candidate.status !== "ready" ? "disabled" : ""}>
      ${candidate.status === "ready" ? `<iframe src="${siteUrl(candidate)}" title="" tabindex="-1"></iframe>` : ""}
      <span>${String(candidateIndex + 1).padStart(2, "0")} / ${escapeHtml(candidate.status)}</span>
      <b>${escapeHtml(candidate.skill.name)}</b>
    </button>`).join("");
  document.querySelectorAll("[data-focus]").forEach((button) => button.addEventListener("click", () => {
    state.focusId = button.dataset.focus;
    renderFocus();
  }));
}

function moveFocus(direction) {
  if (!state.focusId) return;
  const ready = state.run.entries.filter((entry) => entry.status === "ready");
  const index = ready.findIndex((entry) => entry.id === state.focusId);
  state.focusId = ready[(index + direction + ready.length) % ready.length]?.id || state.focusId;
  renderFocus();
}

async function toggleFavorite(entryId) {
  const entry = entryById(entryId);
  const updated = await fetchJson(`/api/runs/${encodeURIComponent(state.run.id)}/entries/${encodeURIComponent(entryId)}/favorite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorite: !entry.favorite })
  });
  Object.assign(entry, updated);
  render();
}

async function showLog(entryId) {
  const entry = entryById(entryId);
  $("#log-title").textContent = entry.skill.name;
  const response = await fetch(`/api/runs/${encodeURIComponent(state.run.id)}/entries/${encodeURIComponent(entryId)}/log`);
  $("#log-content").textContent = await response.text() || entry.error || "No log was written.";
  $("#log-dialog").showModal();
}

function renderHistory() {
  $("#history-list").innerHTML = state.runs.map((run) => {
    const ready = run.entries.filter((entry) => entry.status === "ready").length;
    return `<a class="history-item" href="/?run=${encodeURIComponent(run.id)}">
      <span>${escapeHtml(run.id)} / ${escapeHtml(run.host)}</span>
      <strong>${escapeHtml(run.brief)}</strong>
      <span>${ready} ready · ${run.entries.length} total</span>
    </a>`;
  }).join("") || "<p>No archived runs yet.</p>";
}

function entryById(entryId) {
  return state.run.entries.find((entry) => entry.id === entryId);
}

function siteUrl(entry) {
  return `/runs/${encodeURIComponent(state.run.id)}/entries/${encodeURIComponent(entry.id)}/site/index.html`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Request failed: ${response.status}`);
  return value;
}

function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

$("#history-trigger").addEventListener("click", () => {
  $("#history-panel").classList.add("open");
  $("#history-panel").setAttribute("aria-hidden", "false");
});
document.querySelectorAll("[data-close-history]").forEach((button) => button.addEventListener("click", () => {
  $("#history-panel").classList.remove("open");
  $("#history-panel").setAttribute("aria-hidden", "true");
}));
$("#focus-close").addEventListener("click", closeFocus);
$("#focus-refresh").addEventListener("click", () => {
  const frame = $("#focus-frame");
  frame.src = `${frame.dataset.source}?refresh=${Date.now()}`;
});
$("#focus-favorite").addEventListener("click", () => toggleFavorite(state.focusId));
document.querySelector("[data-close-log]").addEventListener("click", () => $("#log-dialog").close());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeFocus();
  if (event.key === "ArrowLeft") moveFocus(-1);
  if (event.key === "ArrowRight") moveFocus(1);
});
