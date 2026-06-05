import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { entryDir } from "../src/paths.mjs";
import { cleanRun, createRun, loadRun, recoverRun, updateEntry, validateAndMarkReady } from "../src/state.mjs";
import { sampleSkills, temporaryDirectory } from "./helpers.mjs";

test("validation marks missing entry failed and a standalone page ready", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "A page", host: "codex", skills: sampleSkills.slice(0, 2) });

  const failed = await validateAndMarkReady(temporary.dir, run.id, run.entries[0].id);
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /index\.html/);

  const site = path.join(entryDir(temporary.dir, run.id, run.entries[1].id), "site");
  await mkdir(site, { recursive: true });
  await writeFile(path.join(site, "index.html"), "this is long enough to pass a size-only check");
  const invalid = await validateAndMarkReady(temporary.dir, run.id, run.entries[1].id);
  assert.equal(invalid.status, "failed");
  assert.match(invalid.error, /standalone HTML/);
  await writeFile(path.join(site, "index.html"), "<!doctype html><html><body>Standalone entry</body></html>");
  const ready = await validateAndMarkReady(temporary.dir, run.id, run.entries[1].id);
  assert.equal(ready.status, "ready");
});

test("validation rejects missing local assets and preserves cancellation", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Assets", host: "codex", skills: sampleSkills.slice(0, 2) });
  const firstSite = path.join(entryDir(temporary.dir, run.id, run.entries[0].id), "site");
  await writeFile(path.join(firstSite, "index.html"), '<!doctype html><html><body><img src="missing.png"></body></html>');
  const invalid = await validateAndMarkReady(temporary.dir, run.id, run.entries[0].id);
  assert.equal(invalid.status, "failed");
  assert.match(invalid.error, /missing\.png/);

  const secondSite = path.join(entryDir(temporary.dir, run.id, run.entries[1].id), "site");
  await writeFile(path.join(secondSite, "index.html"), "<!doctype html><html><body>Late</body></html>");
  await updateEntry(temporary.dir, run.id, run.entries[1].id, { status: "cancelled", stage: "Cancelled" });
  assert.equal((await validateAndMarkReady(temporary.dir, run.id, run.entries[1].id)).status, "cancelled");
});

test("recovery preserves fresh running entries and fails stale interrupted entries", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "A page", host: "codex", skills: sampleSkills.slice(0, 1) });
  const entryId = run.entries[0].id;
  await updateEntry(temporary.dir, run.id, entryId, { status: "running", stage: "Building" });
  assert.equal((await recoverRun(temporary.dir, run.id)).entries[0].status, "running");
  assert.equal((await recoverRun(temporary.dir, run.id, { staleMs: 0 })).entries[0].status, "failed");
  assert.equal((await loadRun(temporary.dir, run.id)).entries[0].stage, "Interrupted");
});

test("recovery promotes output left by an interrupted running contestant", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Recover output", host: "codex", skills: sampleSkills.slice(0, 1) });
  const entry = run.entries[0];
  await updateEntry(temporary.dir, run.id, entry.id, { status: "running", stage: "Building" });
  const site = path.join(entryDir(temporary.dir, run.id, entry.id), "site");
  await mkdir(site, { recursive: true });
  await writeFile(path.join(site, "index.html"), "<!doctype html><html><body>Recovered output</body></html>");
  assert.equal((await recoverRun(temporary.dir, run.id, { staleMs: 0 })).entries[0].status, "ready");
});

test("concurrent entry updates do not collide or lose state", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Parallel", host: "codex", skills: sampleSkills });
  await Promise.all(run.entries.map((entry, index) => updateEntry(temporary.dir, run.id, entry.id, {
    status: index % 2 ? "failed" : "running",
    stage: `Stage ${index}`
  })));
  const updated = await loadRun(temporary.dir, run.id);
  assert.deepEqual(updated.entries.map((entry) => entry.stage), ["Stage 0", "Stage 1", "Stage 2", "Stage 3"]);
});

test("createRun stages exactly one readable primary Skill inside each entry", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Staged skill", host: "claude", skills: sampleSkills.slice(0, 1) });
  const entry = run.entries[0];
  assert.match(entry.skill.stagedPath, /primary-skill[\\/]SKILL\.md$/);
  assert.match(await readFile(entry.skill.stagedPath, "utf8"), /name: editorial-ui/);
  assert.equal(entry.skill.path, sampleSkills[0].path);
});

test("cleanRun removes one valid historical run and rejects traversal", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Cleanup", host: "codex", skills: sampleSkills.slice(0, 1) });
  assert.equal((await cleanRun(temporary.dir, run.id)).id, run.id);
  assert.equal(await loadRun(temporary.dir, run.id), null);
  await assert.rejects(() => cleanRun(temporary.dir, ".."), /Invalid run id/);
});

test("createRun rejects unsafe explicit run ids", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  await assert.rejects(() => createRun({
    dataDir: temporary.dir,
    brief: "Unsafe",
    host: "codex",
    skills: sampleSkills.slice(0, 1),
    options: { runId: "../outside" }
  }), /Invalid run id/);
});

test("all five contract statuses can be persisted", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Statuses", host: "codex", skills: sampleSkills });
  for (const [index, status] of ["queued", "running", "ready", "failed"].entries()) {
    await updateEntry(temporary.dir, run.id, run.entries[index].id, { status, stage: status });
  }
  await updateEntry(temporary.dir, run.id, run.entries[0].id, { status: "cancelled", stage: "Cancelled" });
  const current = await loadRun(temporary.dir, run.id);
  assert.deepEqual(current.entries.map((entry) => entry.status), ["cancelled", "running", "ready", "failed"]);
});

test("loadRun merges per-entry metadata and status over a stale run summary", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Authority", host: "codex", skills: sampleSkills.slice(0, 1) });
  const entry = run.entries[0];
  await updateEntry(temporary.dir, run.id, entry.id, { favorite: true });
  await updateEntry(temporary.dir, run.id, entry.id, { status: "running", stage: "Independent status" });
  const stale = { ...run, entries: run.entries.map((item) => ({ ...item, favorite: false, status: "queued", stage: "Stale" })) };
  await writeFile(path.join(temporary.dir, "runs", run.id, "run.json"), `${JSON.stringify(stale)}\n`);
  const loaded = await loadRun(temporary.dir, run.id);
  assert.equal(loaded.entries[0].favorite, true);
  assert.equal(loaded.entries[0].status, "running");
  assert.equal(loaded.entries[0].stage, "Independent status");
});

test("conditional updates cannot overwrite a cancelled terminal state", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Terminal", host: "codex", skills: sampleSkills.slice(0, 1) });
  const entryId = run.entries[0].id;
  await updateEntry(temporary.dir, run.id, entryId, { status: "cancelled", stage: "Cancelled" });
  const result = await updateEntry(
    temporary.dir,
    run.id,
    entryId,
    { status: "failed", stage: "Late failure" },
    { unlessStatuses: ["cancelled"] }
  );
  assert.equal(result.status, "cancelled");
  assert.equal((await loadRun(temporary.dir, run.id)).entries[0].stage, "Cancelled");
});
