import assert from "node:assert/strict";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { scanSkills, selectSkills } from "../src/skills.mjs";
import { temporaryDirectory, writeSkill } from "./helpers.mjs";

test("scanSkills merges identical copies and preserves their real sources", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const first = await writeSkill(temporary.dir, "codex/frontend", "frontend-design", "Frontend website interface design");
  const duplicateDir = path.join(temporary.dir, "claude", "frontend");
  await mkdir(duplicateDir, { recursive: true });
  await copyFile(first, path.join(duplicateDir, "SKILL.md"));
  await writeSkill(temporary.dir, "codex/writing", "writer", "Rewrite prose");

  const skills = await scanSkills({ roots: [temporary.dir] });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "frontend-design");
  assert.equal(skills[0].sources.length, 2);
});

test("selectSkills ranks against the brief and keeps contestant names distinct", () => {
  const skills = [
    { name: "same-ui", description: "frontend website", path: "/one", designScore: 4 },
    { name: "same-ui", description: "dashboard interface", path: "/two", designScore: 4 },
    { name: "motion-ui", description: "animated frontend portfolio", path: "/three", designScore: 4 }
  ];
  const selected = selectSkills(skills, "animated portfolio website", { count: 2 });
  assert.equal(selected.length, 2);
  assert.equal(new Set(selected.map((skill) => skill.name)).size, 2);
  assert.equal(selected[0].name, "motion-ui");
});

test("selectSkills honors explicit names and reports missing overrides", () => {
  const skills = [
    { name: "one", path: "/one", root: "/", designScore: 2 },
    { name: "two", path: "/two", root: "/", designScore: 2 }
  ];
  assert.deepEqual(selectSkills(skills, "", { count: 1, overrides: ["two"] }).map((skill) => skill.name), ["two"]);
  assert.throws(() => selectSkills(skills, "", { overrides: ["missing"] }), /not found/);
});

test("scan and selection reject non-frontend design skills and the orchestrator itself", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  await writeSkill(temporary.dir, "brand", "brandkit", "Premium logo and brand identity design");
  await writeSkill(temporary.dir, "guides", "guidelines", "Design guidelines and questions for presentations");
  await writeSkill(temporary.dir, "battle", "design-battle", "Compare frontend UI design skills");
  await writeSkill(temporary.dir, "web", "web-ui", "Responsive frontend website interface design");
  const skills = await scanSkills({ roots: [temporary.dir] });
  assert.deepEqual(skills.map((skill) => skill.name), ["web-ui"]);
  assert.deepEqual(selectSkills(skills, "landing page", { count: 4 }).map((skill) => skill.name), ["web-ui"]);
});
