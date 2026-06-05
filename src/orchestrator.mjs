import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDataDir, runDir } from "./paths.mjs";
import { createRun } from "./state.mjs";
import { scanSkills, selectSkills } from "./skills.mjs";
import { runEntries } from "./runner.mjs";
import { readJson } from "./json.mjs";

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
  const args = [binFile, "serve", runId, "--data-dir", dataDir, "--auto-open"];
  if (noOpen) args.push("--no-open");
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  const galleryFile = path.join(runDir(dataDir, runId), "gallery.json");
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
