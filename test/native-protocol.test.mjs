import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { entryDir } from "../src/paths.mjs";
import { buildEntryPrompt } from "../src/prompt.mjs";
import { createRun, loadRun, updateEntry, validateAndMarkReady } from "../src/state.mjs";
import { sampleSkills, temporaryDirectory } from "./helpers.mjs";

for (const host of ["codex", "claude", "hermes", "opencode", "openclaw"]) {
  test(`${host} native delegation uses the shared file protocol`, async (t) => {
    const temporary = await temporaryDirectory();
    t.after(temporary.cleanup);
    const run = await createRun({ dataDir: temporary.dir, brief: "Native protocol", host, skills: sampleSkills.slice(0, 1) });
    const entry = run.entries[0];
    const prompt = buildEntryPrompt({ brief: run.brief, skill: entry.skill, entryDir: entryDir(temporary.dir, run.id, entry.id) });
    assert.match(prompt, new RegExp(entry.skill.stagedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await updateEntry(temporary.dir, run.id, entry.id, { status: "running", stage: `Running via ${host}` });
    const site = path.join(entryDir(temporary.dir, run.id, entry.id), "site");
    await mkdir(site, { recursive: true });
    await writeFile(path.join(site, "index.html"), `<!doctype html><html><body>${host}</body></html>`);
    await validateAndMarkReady(temporary.dir, run.id, entry.id);
    assert.equal((await loadRun(temporary.dir, run.id)).entries[0].status, "ready");
  });
}
