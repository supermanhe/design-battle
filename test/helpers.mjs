import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function temporaryDirectory(name = "design-battle-") {
  const dir = await mkdtemp(path.join(os.tmpdir(), name));
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

export async function writeSkill(root, folder, name, description, body = "") {
  const dir = path.join(root, folder);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  await writeFile(file, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`, "utf8");
  return file;
}

export async function waitFor(predicate, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

export const sampleSkills = [
  { name: "editorial-ui", description: "Editorial frontend website design", path: "/skills/editorial/SKILL.md", sources: ["/skills/editorial/SKILL.md"] },
  { name: "brutalist-ui", description: "Raw brutalist interface and dashboard design", path: "/skills/brutalist/SKILL.md", sources: ["/skills/brutalist/SKILL.md"] },
  { name: "minimalist-ui", description: "Minimal frontend landing page design", path: "/skills/minimal/SKILL.md", sources: ["/skills/minimal/SKILL.md"] },
  { name: "motion-ui", description: "Animated frontend visual design", path: "/skills/motion/SKILL.md", sources: ["/skills/motion/SKILL.md"] }
];
