import assert from "node:assert/strict";
import test from "node:test";
import { writeJson } from "../src/json.mjs";
import { launchGallery } from "../src/orchestrator.mjs";
import { runDir } from "../src/paths.mjs";
import { createRun } from "../src/state.mjs";
import { sampleSkills, temporaryDirectory } from "./helpers.mjs";
import path from "node:path";

test("launchGallery ignores metadata left by an earlier gallery process", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Reopen gallery", host: "codex", skills: sampleSkills.slice(0, 1) });
  const galleryFile = path.join(runDir(temporary.dir, run.id), "gallery.json");
  await writeJson(galleryFile, { url: "http://127.0.0.1:1/stale", pid: -1, startedAt: "2000-01-01T00:00:00.000Z" });

  const gallery = await launchGallery({ dataDir: temporary.dir, runId: run.id, noOpen: true });
  t.after(() => {
    try {
      process.kill(gallery.pid);
    } catch {
      // The detached gallery may already have exited.
    }
  });

  assert.notEqual(gallery.pid, -1);
  assert.notEqual(gallery.url, "http://127.0.0.1:1/stale");
  assert.ok(Date.parse(gallery.startedAt) > Date.parse("2000-01-01T00:00:00.000Z"));
});
