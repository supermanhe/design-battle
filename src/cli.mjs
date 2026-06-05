import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { HOSTS } from "./adapters.mjs";
import { defaultDataDir, runsDir } from "./paths.mjs";
import { launchGallery, prepareBattle, runBattle } from "./orchestrator.mjs";
import { cleanRun, recoverRun, listRuns, loadRun, updateEntry, validateAndMarkReady } from "./state.mjs";
import { scanSkills } from "./skills.mjs";
import { startGalleryServer } from "./server.mjs";
import { buildEntryPrompt } from "./prompt.mjs";
import { entryDir } from "./paths.mjs";

export async function main(argv) {
  const [command = "help", ...rest] = argv;
  const { positional, flags } = parseArgs(rest);
  const dataDir = path.resolve(flags["data-dir"] || defaultDataDir());
  if (command === "run" || command === "prepare") {
    const brief = positional.join(" ").trim();
    if (!brief) throw new Error(`${command} requires a frontend brief.`);
    const options = {
      brief,
      host: flags.host || "codex",
      dataDir,
      count: numberFlag(flags.count, 4),
      concurrency: numberFlag(flags.concurrency, 4),
      timeoutMs: numberFlag(flags.timeout, 900) * 1000,
      hostProvider: flags.provider || process.env.DESIGN_BATTLE_HOST_PROVIDER,
      hostModel: flags.model || process.env.DESIGN_BATTLE_HOST_MODEL,
      skillNames: csvFlag(flags.skills),
      skillRoots: csvFlag(flags["skill-roots"]),
      runId: flags["run-id"],
      executor: flags.executor || "cli",
      noOpen: Boolean(flags["no-open"])
    };
    if (!options.skillRoots.length) delete options.skillRoots;
    if (command === "prepare") {
      const run = await prepareBattle(options);
      console.log(JSON.stringify(run, null, 2));
      return;
    }
    const result = await runBattle(options);
    console.log(`Run: ${result.run.id}`);
    console.log(`Gallery: ${result.gallery?.url || "disabled"}`);
    printSummary(result.run);
    return;
  }
  if (command === "serve") {
    const runId = positional[0] || null;
    if (runId) await recoverRun(dataDir, runId);
    const gallery = await startGalleryServer({
      dataDir,
      runId,
      port: numberFlag(flags.port, 0),
      autoOpen: Boolean(flags["auto-open"]) && !flags["no-open"]
    });
    console.log(`Design Battle gallery: ${gallery.url}`);
    return new Promise((resolve) => {
      const close = async () => {
        await gallery.close();
        resolve();
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    });
  }
  if (command === "open") {
    const runId = positional[0];
    if (!runId) throw new Error("open requires a run id.");
    const gallery = await launchGallery({ dataDir, runId, noOpen: false });
    console.log(gallery.url);
    return;
  }
  if (command === "task") {
    const [runId, entryId] = positional;
    const run = await loadRun(dataDir, runId);
    const entry = run?.entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw new Error(`Entry not found: ${runId}/${entryId}`);
    await updateEntry(dataDir, runId, entryId, {
      status: "running",
      stage: flags.stage || `Running via ${HOSTS[run.host]?.native || "native delegation"}`,
      startedAt: new Date().toISOString(),
      error: null
    });
    console.log(buildEntryPrompt({ brief: run.brief, skill: entry.skill, entryDir: entryDir(dataDir, runId, entryId) }));
    return;
  }
  if (command === "validate") {
    const [runId, entryId] = positional;
    if (!runId || !entryId) throw new Error("validate requires run id and entry id.");
    console.log(JSON.stringify(await validateAndMarkReady(dataDir, runId, entryId), null, 2));
    return;
  }
  if (command === "fail") {
    const [runId, entryId] = positional;
    if (!runId || !entryId) throw new Error("fail requires run id and entry id.");
    console.log(JSON.stringify(await updateEntry(dataDir, runId, entryId, {
      status: "failed",
      stage: "Failed",
      error: flags.error || "Native delegated agent failed.",
      completedAt: new Date().toISOString()
    }), null, 2));
    return;
  }
  if (command === "heartbeat") {
    const [runId, entryId] = positional;
    if (!runId || !entryId) throw new Error("heartbeat requires run id and entry id.");
    const run = await loadRun(dataDir, runId);
    const entry = run?.entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw new Error(`Entry not found: ${runId}/${entryId}`);
    if (entry.status !== "running") throw new Error(`Cannot heartbeat entry in status: ${entry.status}`);
    console.log(JSON.stringify(await updateEntry(dataDir, runId, entryId, {
      stage: flags.stage || entry.stage || "Running"
    }), null, 2));
    return;
  }
  if (command === "cancel") {
    const [runId, entryId] = positional;
    if (!runId || !entryId) throw new Error("cancel requires run id and entry id.");
    console.log(JSON.stringify(await updateEntry(dataDir, runId, entryId, {
      status: "cancelled",
      stage: "Cancelled",
      error: flags.reason || null,
      completedAt: new Date().toISOString()
    }), null, 2));
    return;
  }
  if (command === "scan") {
    const skills = await scanSkills({ roots: csvFlag(flags.roots).length ? csvFlag(flags.roots) : undefined });
    console.log(JSON.stringify(skills, null, 2));
    return;
  }
  if (command === "list") {
    const runs = await listRuns(dataDir);
    for (const run of runs) printSummary(run);
    return;
  }
  if (command === "clean") {
    const runId = positional[0];
    if (!runId) throw new Error("clean requires a run id.");
    const removed = await cleanRun(dataDir, runId);
    console.log(`Removed run ${removed.id}`);
    return;
  }
  if (command === "doctor") {
    await doctor(dataDir);
    return;
  }
  console.log(help());
}

function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index++) {
    const item = args[index];
    if (!item.startsWith("--")) {
      positional.push(item);
      continue;
    }
    const [rawKey, inline] = item.slice(2).split("=", 2);
    if (inline !== undefined) flags[rawKey] = inline;
    else if (args[index + 1] && !args[index + 1].startsWith("--")) flags[rawKey] = args[++index];
    else flags[rawKey] = true;
  }
  return { positional, flags };
}

function csvFlag(value) {
  if (!value || value === true) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function numberFlag(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function printSummary(run) {
  const counts = Object.groupBy ? Object.groupBy(run.entries, (entry) => entry.status) : run.entries.reduce((all, entry) => {
    (all[entry.status] ||= []).push(entry);
    return all;
  }, {});
  const summary = Object.entries(counts).map(([status, entries]) => `${status}=${entries.length}`).join(" ");
  console.log(`${run.id}  ${summary}  ${run.brief.slice(0, 72)}`);
}

async function doctor(dataDir) {
  console.log(`Node: ${process.version} ${Number(process.versions.node.split(".")[0]) >= 18 ? "OK" : "REQUIRES 18+"}`);
  console.log(`Data: ${dataDir}`);
  for (const [host, adapter] of Object.entries(HOSTS)) {
    const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [adapter.command], { encoding: "utf8" });
    console.log(`${host}: ${result.status === 0 ? `available (${adapter.native}; CLI fallback ready)` : "unavailable"}`);
  }
  const skills = await scanSkills();
  console.log(`Relevant design skills: ${skills.length}`);
  try {
    await access(runsDir(dataDir));
    console.log("Run history: available");
  } catch {
    console.log("Run history: empty");
  }
}

function help() {
  return `Design Battle

Usage:
  design-battle run "<brief>" [--host codex] [--skills a,b] [--count 4]
  design-battle prepare "<brief>" [options]
  design-battle serve [run-id] [--port 0] [--auto-open]
  design-battle open <run-id>
  design-battle task <run-id> <entry-id>
  design-battle validate <run-id> <entry-id>
  design-battle fail <run-id> <entry-id> [--error message]
  design-battle heartbeat <run-id> <entry-id> [--stage message]
  design-battle cancel <run-id> <entry-id> [--reason message]
  design-battle scan
  design-battle list
  design-battle clean <run-id>
  design-battle doctor

Options:
  --concurrency N     Maximum simultaneous contestants (default 4)
  --data-dir PATH     Override the user-level run history directory
  --executor cli|mock Use host CLI fallback or deterministic mock
  --no-open           Do not automatically open the gallery
  --provider NAME     Override the selected host's inference provider
  --model NAME        Override the selected host's inference model
  --skill-roots A,B   Override scanned Skill roots
  --skills A,B        Explicit contestant Skill names or paths
  --timeout SECONDS   Per-contestant timeout (default 900)
`;
}
