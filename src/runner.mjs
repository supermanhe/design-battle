import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { entryDir } from "./paths.mjs";
import { loadRun, updateEntry, validateAndMarkReady } from "./state.mjs";
import { runCliEntry } from "./adapters.mjs";

export async function runEntries({
  dataDir,
  runId,
  concurrency = 4,
  timeoutMs = 15 * 60_000,
  executor = "cli",
  onFirstSettled = () => {},
  mockDelays = []
}) {
  const run = await loadRun(dataDir, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  let cursor = 0;
  let firstSettled = false;
  const settle = async () => {
    if (!firstSettled) {
      firstSettled = true;
      await onFirstSettled(await loadRun(dataDir, runId));
    }
  };
  const worker = async () => {
    while (cursor < run.entries.length) {
      const index = cursor++;
      const entry = run.entries[index];
      const beforeStart = await loadRun(dataDir, runId);
      if (beforeStart.entries.find((candidate) => candidate.id === entry.id)?.status === "cancelled") {
        await settle();
        continue;
      }
      const started = await updateEntry(dataDir, runId, entry.id, {
        status: "running",
        stage: executor === "mock" ? "Rendering mock concept" : `Running ${run.host} CLI`,
        startedAt: new Date().toISOString(),
        error: null
      }, { unlessStatuses: ["cancelled"] });
      if (started.status === "cancelled") {
        await settle();
        continue;
      }
      try {
        if (typeof executor === "function") {
          await executor({ dataDir, run, entry, index });
        } else if (executor === "mock") {
          await runMockEntry({ dataDir, run, entry, delay: mockDelays[index] ?? 80 + index * 50 });
        } else {
          await runCliEntry({ dataDir, run, entry, timeoutMs });
        }
        const current = await loadRun(dataDir, runId);
        if (current.entries.find((candidate) => candidate.id === entry.id)?.status !== "cancelled") {
          await validateAndMarkReady(dataDir, runId, entry.id);
        }
      } catch (error) {
        const current = await loadRun(dataDir, runId);
        if (current.entries.find((candidate) => candidate.id === entry.id)?.status !== "cancelled") {
          const output = path.join(entryDir(dataDir, runId, entry.id), "site", "index.html");
          const outputInfo = await stat(output).catch(() => null);
          if (outputInfo?.isFile()) {
            await validateAndMarkReady(dataDir, runId, entry.id);
          } else {
            await updateEntry(dataDir, runId, entry.id, {
              status: "failed",
              stage: error.code === "ETIMEDOUT" ? "Timed out" : "Failed",
              error: error.message,
              completedAt: new Date().toISOString()
            }, { unlessStatuses: ["cancelled"] });
          }
        }
      }
      await settle();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, run.entries.length)) }, worker));
  return loadRun(dataDir, runId);
}

async function runMockEntry({ dataDir, run, entry, delay }) {
  await new Promise((resolve) => setTimeout(resolve, delay));
  const dir = path.join(entryDir(dataDir, run.id, entry.id), "site");
  await mkdir(dir, { recursive: true });
  const hue = Math.abs(hash(entry.skill.name)) % 360;
  const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(entry.skill.name)}</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:hsl(${hue} 28% 10%);color:hsl(${hue} 70% 92%);font:16px/1.5 Georgia,serif}
main{width:min(86vw,860px);border:1px solid hsl(${hue} 55% 55%/.55);padding:clamp(2rem,7vw,7rem);background:linear-gradient(145deg,hsl(${hue} 50% 20%),hsl(${hue + 45} 45% 12%));box-shadow:0 35px 90px #0008}
small{font:700 .72rem/1.2 ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:hsl(${hue} 70% 70%)}
h1{font-size:clamp(3rem,10vw,8rem);line-height:.85;letter-spacing:-.08em;margin:.6em 0 .35em}
p{max-width:45ch;font-size:clamp(1rem,2vw,1.35rem);opacity:.78}
</style><main><small>Design Battle / ${escapeHtml(entry.skill.name)}</small><h1>${escapeHtml(run.brief.slice(0, 62))}</h1><p>Standalone mock entry created to verify progressive delivery, isolation, and gallery behavior.</p></main></html>`;
  await writeFile(path.join(dir, "index.html"), html, "utf8");
}

function hash(value) {
  return [...value].reduce((total, char) => ((total << 5) - total + char.charCodeAt(0)) | 0, 0);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
