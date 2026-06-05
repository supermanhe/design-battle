import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { entryDir } from "../src/paths.mjs";
import { runEntries } from "../src/runner.mjs";
import { createRun, loadRun } from "../src/state.mjs";
import { sampleSkills, temporaryDirectory } from "./helpers.mjs";

test("mock executor finishes entries out of order without waiting for the slowest", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "A page", host: "codex", skills: sampleSkills.slice(0, 3) });
  const firstSettled = [];
  const promise = runEntries({
    dataDir: temporary.dir,
    runId: run.id,
    concurrency: 3,
    executor: "mock",
    mockDelays: [180, 25, 90],
    onFirstSettled: (snapshot) => firstSettled.push(snapshot.entries.find((entry) => entry.status === "ready")?.id)
  });
  await new Promise((resolve) => setTimeout(resolve, 70));
  const during = await loadRun(temporary.dir, run.id);
  assert.equal(during.entries[1].status, "ready");
  assert.equal(during.entries[0].status, "running");
  const final = await promise;
  assert.ok(final.entries.every((entry) => entry.status === "ready"));
  assert.deepEqual(firstSettled, [run.entries[1].id]);
});

test("custom executor isolates failures and timeout-like errors", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "A page", host: "codex", skills: sampleSkills.slice(0, 3) });
  const executor = async ({ dataDir, run: activeRun, entry, index }) => {
    if (index === 0) throw new Error("missing dependency");
    if (index === 1) {
      const error = new Error("deadline");
      error.code = "ETIMEDOUT";
      throw error;
    }
    const site = path.join(entryDir(dataDir, activeRun.id, entry.id), "site");
    await mkdir(site, { recursive: true });
    await writeFile(path.join(site, "index.html"), "<!doctype html><html><body>Healthy entry</body></html>");
  };
  const final = await runEntries({ dataDir: temporary.dir, runId: run.id, concurrency: 3, executor });
  assert.deepEqual(final.entries.map((entry) => entry.status), ["failed", "failed", "ready"]);
  assert.equal(final.entries[1].stage, "Timed out");
});
