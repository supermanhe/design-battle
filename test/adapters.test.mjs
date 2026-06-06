import assert from "node:assert/strict";
import test from "node:test";
import { HOSTS, getHostAdapter, runCliEntry, terminateProcessTree } from "../src/adapters.mjs";
import { buildEntryPrompt } from "../src/prompt.mjs";
import { prepareBattle } from "../src/orchestrator.mjs";
import { createRun, updateEntry } from "../src/state.mjs";
import { sampleSkills, temporaryDirectory, writeSkill } from "./helpers.mjs";

test("all five host adapters expose native and CLI fallback contracts", () => {
  assert.deepEqual(Object.keys(HOSTS), ["codex", "claude", "hermes", "opencode", "openclaw"]);
  for (const host of Object.keys(HOSTS)) {
    const adapter = getHostAdapter(host);
    assert.ok(adapter.command);
    assert.ok(adapter.native);
    assert.ok(adapter.args("/entry", "prompt").length > 0);
  }
  const openClawArgs = HOSTS.openclaw.args("/runs/run-one/entries/entry-one", "prompt");
  assert.deepEqual(openClawArgs.slice(0, 3), ["agent", "--session-key", "design-battle-run-one-entry-one"]);
  assert.deepEqual(HOSTS.hermes.args("/entry", "prompt", { hostProvider: "copilot", hostModel: "gpt-4.1" }).slice(-4), ["--provider", "copilot", "--model", "gpt-4.1"]);
  assert.deepEqual(HOSTS.opencode.args("/entry", "prompt", { hostProvider: "zai", hostModel: "glm-5" }), ["run", "prompt", "--dir", "/entry", "--dangerously-skip-permissions", "--model", "zai/glm-5"]);
  assert.deepEqual(HOSTS.opencode.args("/entry", "prompt", { hostModel: "anthropic/claude-sonnet-4" }).slice(-2), ["--model", "anthropic/claude-sonnet-4"]);
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

test("POSIX process tree termination signals the contestant process group", async () => {
  const signals = [];
  await terminateProcessTree({ pid: 4321 }, {
    platform: "linux",
    kill: (pid, signal) => signals.push({ pid, signal })
  });
  assert.deepEqual(signals, [{ pid: -4321, signal: "SIGTERM" }]);
});

test("CLI fallback terminates its process when the entry is cancelled", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Cancel process", host: "codex", skills: sampleSkills.slice(0, 1) });
  const entry = run.entries[0];
  const adapter = HOSTS.codex;
  const original = { command: adapter.command, args: adapter.args, stdin: adapter.stdin, windowsLaunch: adapter.windowsLaunch };
  Object.assign(adapter, {
    command: process.execPath,
    args: () => ["-e", "setInterval(() => {}, 1000)"],
    stdin: false,
    windowsLaunch: undefined
  });
  t.after(() => Object.assign(adapter, original));
  await updateEntry(temporary.dir, run.id, entry.id, { status: "running", stage: "Running test process" });
  const running = runCliEntry({ dataDir: temporary.dir, run, entry, timeoutMs: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await updateEntry(temporary.dir, run.id, entry.id, { status: "cancelled", stage: "Cancelled" });
  await assert.rejects(running, (error) => error.code === "ECANCELLED");
});
