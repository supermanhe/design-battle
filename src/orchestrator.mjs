import { spawn } from "node:child_process";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDataDir, runDir } from "./paths.mjs";
import { createRun } from "./state.mjs";
import { scanSkills, selectSkills } from "./skills.mjs";
import { runEntries } from "./runner.mjs";
import { readJson } from "./json.mjs";
import { openLocalUrl } from "./open.mjs";

const binFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "design-battle.mjs");

export async function prepareBattle({
  brief,
  host = "codex",
  dataDir = defaultDataDir(),
  count = 4,
  skillNames = [],
  skillRoots,
  concurrency = 4,
  timeoutMs = 15 * 60_000,
  hostProvider,
  hostModel,
  runId
}) {
  const available = await scanSkills({ roots: skillRoots });
  const selected = selectSkills(available, brief, { count, overrides: skillNames });
  if (!selected.length) throw new Error("No relevant frontend design skills were found.");
  return createRun({
    dataDir,
    brief,
    host,
    skills: selected,
    options: { count: selected.length, concurrency, timeoutMs, hostProvider, hostModel, runId }
  });
}

export async function runBattle(options) {
  const run = options.preparedRun || await prepareBattle(options);
  const gallery = options.gallery === false ? null : await launchGallery({
    dataDir: options.dataDir || defaultDataDir(),
    runId: run.id,
    noOpen: options.noOpen
  });
  const finalRun = await runEntries({
    dataDir: options.dataDir || defaultDataDir(),
    runId: run.id,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    executor: options.executor,
    mockDelays: options.mockDelays
  });
  return { run: finalRun, gallery };
}

export async function launchGallery({ dataDir = defaultDataDir(), runId, noOpen = false }) {
  const galleryFile = path.join(runDir(dataDir, runId), "gallery.json");
  const existing = await readJson(galleryFile);
  if (existing?.url && await galleryIsAlive(existing, runId)) {
    if (!noOpen) openLocalUrl(existing.url);
    return existing;
  }
  await rm(galleryFile, { force: true });
  const args = [binFile, "serve", runId, "--data-dir", dataDir, "--auto-open"];
  if (noOpen) args.push("--no-open");
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      await access(galleryFile);
      return readJson(galleryFile);
    } catch {
      // Keep waiting for the detached gallery process.
    }
  }
  throw new Error("Gallery server did not start in time.");
}

export async function closeGallery({ dataDir = defaultDataDir(), runId }) {
  const galleryFile = path.join(runDir(dataDir, runId), "gallery.json");
  const gallery = await readJson(galleryFile);
  if (!gallery?.url || !gallery.shutdownToken || !(await galleryIsAlive(gallery, runId))) {
    await rm(galleryFile, { force: true });
    return false;
  }
  const response = await fetch(new URL("/api/shutdown", gallery.url), {
    method: "POST",
    headers: { "X-Design-Battle-Token": gallery.shutdownToken },
    signal: AbortSignal.timeout(1000)
  });
  if (!response.ok) throw new Error(`Gallery shutdown failed: ${response.status}`);
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    try {
      await access(galleryFile);
    } catch {
      return true;
    }
  }
  await rm(galleryFile, { force: true });
  return true;
}

async function galleryIsAlive(gallery, runId) {
  try {
    const healthUrl = new URL("/api/health", gallery.url);
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return false;
    const health = await response.json();
    return health.pid === gallery.pid && health.runId === runId;
  } catch {
    return false;
  }
}
