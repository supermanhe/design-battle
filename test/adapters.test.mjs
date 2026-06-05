import assert from "node:assert/strict";
import test from "node:test";
import { HOSTS, getHostAdapter } from "../src/adapters.mjs";
import { buildEntryPrompt } from "../src/prompt.mjs";
import { prepareBattle } from "../src/orchestrator.mjs";
import { sampleSkills, temporaryDirectory, writeSkill } from "./helpers.mjs";

test("all four host adapters expose native and CLI fallback contracts", () => {
  assert.deepEqual(Object.keys(HOSTS), ["codex", "claude", "hermes", "openclaw"]);
  for (const host of Object.keys(HOSTS)) {
    const adapter = getHostAdapter(host);
    assert.ok(adapter.command);
    assert.ok(adapter.native);
    assert.ok(adapter.args("/entry", "prompt").length > 0);
  }
  const openClawArgs = HOSTS.openclaw.args("/runs/run-one/entries/entry-one", "prompt");
  assert.deepEqual(openClawArgs.slice(0, 3), ["agent", "--session-key", "design-battle-run-one-entry-one"]);
  assert.deepEqual(HOSTS.hermes.args("/entry", "prompt", { hostProvider: "copilot", hostModel: "gpt-4.1" }).slice(-4), ["--provider", "copilot", "--model", "gpt-4.1"]);
});

test("entry prompt enforces one skill, standalone output, and sibling isolation", () => {
  const prompt = buildEntryPrompt({
    brief: "Build a launch page",
    skill: { path: "/skills/one/SKILL.md" },
    entryDir: "/runs/one/entries/a"
  });
  assert.match(prompt, /exactly one primary design skill/);
  assert.match(prompt, /site\/index\.html/);
  assert.match(prompt, /Do not read or access sibling contestant directories/);
});

test("prepared runs preserve host provider and model overrides", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  await writeSkill(temporary.dir, "minimal", sampleSkills[2].name, sampleSkills[2].description);
  const run = await prepareBattle({
    brief: "Provider override",
    host: "hermes",
    dataDir: temporary.dir,
    skillRoots: [temporary.dir],
    count: 1,
    hostProvider: "copilot",
    hostModel: "gpt-4.1"
  });
  assert.equal(run.options.hostProvider, "copilot");
  assert.equal(run.options.hostModel, "gpt-4.1");
});
