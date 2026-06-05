import { access, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { entryDir, runDir, runsDir } from "./paths.mjs";
import { readJson, writeJson } from "./json.mjs";

export const STATUSES = new Set(["queued", "running", "ready", "failed", "cancelled"]);
const writeLocks = new Map();

export function makeRunId(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function makeEntryId(index, skillName) {
  return `${String(index + 1).padStart(2, "0")}-${skillName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill"}`;
}

export async function createRun({ dataDir, brief, host, skills, options = {} }) {
  let runId = options.runId || makeRunId();
  let suffix = 1;
  while (await pathExists(runDir(dataDir, runId))) runId = `${options.runId || makeRunId()}-${suffix++}`;
  const createdAt = new Date().toISOString();
  const entries = skills.map((skill, index) => ({
    id: makeEntryId(index, skill.name),
    skill: { name: skill.name, description: skill.description, path: skill.path, sources: skill.sources || [skill.path] },
    status: "queued",
    stage: "Waiting for an execution slot",
    favorite: false,
    createdAt,
    updatedAt: createdAt,
    error: null
  }));
  const run = {
    schemaVersion: 1,
    id: runId,
    brief,
    host,
    createdAt,
    updatedAt: createdAt,
    options,
    entries
  };
  await mkdir(path.join(runDir(dataDir, runId), "entries"), { recursive: true });
  await writeJson(path.join(runDir(dataDir, runId), "run.json"), run);
  for (const entry of entries) {
    const dir = entryDir(dataDir, runId, entry.id);
    await mkdir(path.join(dir, "site"), { recursive: true });
    const stagedSkill = path.join(dir, "primary-skill", "SKILL.md");
    await mkdir(path.dirname(stagedSkill), { recursive: true });
    try {
      await copyFile(entry.skill.path, stagedSkill);
    } catch {
      await writeFile(stagedSkill, `---\nname: ${entry.skill.name}\ndescription: ${entry.skill.description || ""}\n---\n`, "utf8");
    }
    entry.skill.stagedPath = stagedSkill;
    await writeJson(path.join(dir, "meta.json"), entry);
    await writeJson(path.join(dir, "status.json"), pickStatus(entry));
  }
  await writeJson(path.join(runDir(dataDir, runId), "run.json"), run);
  return run;
}

export async function updateEntry(dataDir, runId, entryId, patch) {
  const runFile = path.join(runDir(dataDir, runId), "run.json");
  return withWriteLock(runFile, async () => {
    const run = await readJson(runFile);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const entry = run.entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);
    const dir = entryDir(dataDir, runId, entryId);
    Object.assign(
      entry,
      await readJson(path.join(dir, "meta.json"), {}),
      await readJson(path.join(dir, "status.json"), {})
    );
    if (patch.status && !STATUSES.has(patch.status)) throw new Error(`Invalid entry status: ${patch.status}`);
    Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
    run.updatedAt = entry.updatedAt;
    const statusKeys = ["status", "stage", "error", "startedAt", "completedAt"];
    if (statusKeys.some((key) => Object.hasOwn(patch, key))) {
      await writeJson(path.join(dir, "status.json"), pickStatus(entry));
    }
    if (Object.hasOwn(patch, "favorite")) {
      const existingMeta = await readJson(path.join(dir, "meta.json"), entry);
      await writeJson(path.join(dir, "meta.json"), { ...existingMeta, favorite: entry.favorite, updatedAt: entry.updatedAt });
    }
    await writeJson(runFile, run);
    return entry;
  });
}

export async function validateAndMarkReady(dataDir, runId, entryId) {
  const indexFile = path.join(entryDir(dataDir, runId, entryId), "site", "index.html");
  const info = await stat(indexFile).catch(() => null);
  if (!info?.isFile() || info.size < 32) {
    return updateEntry(dataDir, runId, entryId, {
      status: "failed",
      stage: "Validation failed",
      error: "site/index.html is missing or empty",
      completedAt: new Date().toISOString()
    });
  }
  const source = await readFile(indexFile, "utf8").catch(() => "");
  if (!/<(?:!doctype\s+html|html)(?:\s|>)/i.test(source)) {
    return updateEntry(dataDir, runId, entryId, {
      status: "failed",
      stage: "Validation failed",
      error: "site/index.html is not a standalone HTML document",
      completedAt: new Date().toISOString()
    });
  }
  return updateEntry(dataDir, runId, entryId, {
    status: "ready",
    stage: "Ready",
    error: null,
    completedAt: new Date().toISOString()
  });
}

export async function loadRun(dataDir, runId) {
  const run = await readJson(path.join(runDir(dataDir, runId), "run.json"));
  if (!run) return null;
  for (const entry of run.entries) {
    const meta = await readJson(path.join(entryDir(dataDir, runId, entry.id), "meta.json"));
    if (meta) Object.assign(entry, meta);
    const status = await readJson(path.join(entryDir(dataDir, runId, entry.id), "status.json"));
    if (status) Object.assign(entry, status);
  }
  return run;
}

export async function listRuns(dataDir) {
  const root = runsDir(dataDir);
  let items = [];
  try {
    items = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const runs = await Promise.all(items.filter((item) => item.isDirectory()).map((item) => loadRun(dataDir, item.name)));
  return runs.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function cleanRun(dataDir, runId) {
  const runsRoot = path.resolve(runsDir(dataDir));
  const target = path.resolve(runsRoot, runId);
  const relative = path.relative(runsRoot, target);
  if (!runId || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid run id.");
  const run = await loadRun(dataDir, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  await rm(target, { recursive: true, force: true });
  return run;
}

export async function recoverRun(dataDir, runId, { staleMs = 20 * 60_000 } = {}) {
  const run = await loadRun(dataDir, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  for (const entry of run.entries) {
    if (["queued", "running"].includes(entry.status)) {
      const indexFile = path.join(entryDir(dataDir, runId, entry.id), "site", "index.html");
      if (await pathExists(indexFile)) {
        await validateAndMarkReady(dataDir, runId, entry.id);
        continue;
      }
    }
    if (entry.status === "running" && Date.now() - new Date(entry.updatedAt).getTime() > staleMs) {
      await updateEntry(dataDir, runId, entry.id, {
        status: "failed",
        stage: "Interrupted",
        error: "The parent orchestrator stopped before this entry completed."
      });
    }
  }
  return loadRun(dataDir, runId);
}

function pickStatus(entry) {
  return {
    status: entry.status,
    stage: entry.stage,
    error: entry.error || null,
    updatedAt: entry.updatedAt,
    startedAt: entry.startedAt || null,
    completedAt: entry.completedAt || null
  };
}

async function pathExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function withWriteLock(key, action) {
  const previous = writeLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  writeLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (writeLocks.get(key) === current) writeLocks.delete(key);
  }
}

export async function readLog(dataDir, runId, entryId) {
  try {
    return await readFile(path.join(entryDir(dataDir, runId, entryId), "agent.log"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}
