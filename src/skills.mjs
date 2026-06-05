import { access, readdir, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const DESIGN_TERMS = [
  "frontend", "front-end", "ui", "ux", "website", "web app", "landing page",
  "design", "visual", "interface", "html", "css", "dashboard", "portfolio",
  "minimalist", "brutalist", "editorial", "motion"
];
const FRONTEND_TERMS = [
  "frontend", "front-end", "ui", "ux", "website", "web app", "landing page",
  "interface", "html", "css", "dashboard", "portfolio", "responsive"
];
const NON_CONTESTANT_NAMES = new Set([
  "design-battle", "diagram-design", "game-design-kb", "imagegen", "playwright",
  "redesign-existing-projects", "web-shader-extractor"
]);
const NON_CONTESTANT_PREFIXES = ["gsap-", "browser:", "build-web-apps:"];

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "build", "by", "create", "for", "from",
  "in", "is", "it", "of", "on", "or", "page", "single", "that", "the", "to",
  "use", "with", "网站", "页面", "一个", "的", "和", "为"
]);

export function defaultSkillRoots(env = process.env) {
  const home = os.homedir();
  return [
    env.CODEX_HOME && path.join(env.CODEX_HOME, "skills"),
    path.join(home, ".codex", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".hermes", "skills"),
    path.join(home, ".openclaw", "skills")
  ].filter(Boolean);
}

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function walkForSkills(root, output, depth = 0) {
  if (depth > 7 || !(await exists(root))) return;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
    output.push(path.join(root, "SKILL.md"));
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !["node_modules", ".git", "runs"].includes(entry.name))
    .map((entry) => walkForSkills(path.join(root, entry.name), output, depth + 1)));
}

export function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = text.slice(3, end).replace(/\r/g, "");
  const result = {};
  let activeKey = null;
  for (const line of block.split("\n")) {
    const match = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
    if (match) {
      activeKey = match[1];
      const value = match[2].trim();
      result[activeKey] = value === "|" || value === ">" ? "" : value.replace(/^["']|["']$/g, "");
    } else if (activeKey && /^\s+/.test(line)) {
      result[activeKey] = `${result[activeKey]} ${line.trim()}`.trim();
    }
  }
  return result;
}

export async function scanSkills({ roots = defaultSkillRoots(), includeAll = false } = {}) {
  const files = [];
  await Promise.all([...new Set(roots.map((root) => path.resolve(root)))].map((root) => walkForSkills(root, files)));
  const deduped = new Map();
  const byContent = new Map();
  for (const file of files) {
    let canonical;
    try {
      canonical = await realpath(file);
    } catch {
      canonical = path.resolve(file);
    }
    const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
    if (deduped.has(key)) continue;
    const text = await readFile(file, "utf8");
    const frontmatter = parseFrontmatter(text);
    const skill = {
      name: frontmatter.name || path.basename(path.dirname(file)),
      description: frontmatter.description || "",
      path: canonical,
      sources: [canonical],
      root: path.dirname(canonical),
      designScore: designRelevance(`${frontmatter.name || ""} ${frontmatter.description || ""}`)
    };
    if (!includeAll && !isContestantSkill(skill.name)) continue;
    if (includeAll || skill.designScore > 0) {
      const contentKey = createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
      const duplicate = byContent.get(contentKey);
      if (duplicate) duplicate.sources.push(canonical);
      else {
        deduped.set(key, skill);
        byContent.set(contentKey, skill);
      }
    }
  }
  return [...deduped.values()].sort((a, b) => b.designScore - a.designScore || a.name.localeCompare(b.name));
}

export function isContestantSkill(name) {
  const normalized = String(name).toLowerCase();
  return !NON_CONTESTANT_NAMES.has(normalized) && !NON_CONTESTANT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function tokenize(value) {
  return [...new Set(String(value).toLowerCase().match(/[\p{L}\p{N}-]+/gu) || [])]
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function designRelevance(value) {
  const normalized = String(value).toLowerCase();
  if (!FRONTEND_TERMS.some((term) => containsTerm(normalized, term))) return 0;
  return DESIGN_TERMS.reduce((score, term) => score + (containsTerm(normalized, term) ? 2 : 0), 0);
}

function containsTerm(normalized, term) {
  if (term.length > 3) return normalized.includes(term);
  return new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(normalized);
}

export function rankSkills(skills, brief) {
  const briefTokens = new Set(tokenize(brief));
  return skills.map((skill) => {
    const corpus = `${skill.name} ${skill.description}`.toLowerCase();
    const overlap = tokenize(corpus).reduce((score, token) => score + (briefTokens.has(token) ? 4 : 0), 0);
    const nameBonus = briefTokens.has(skill.name.toLowerCase()) ? 10 : 0;
    return { ...skill, score: skill.designScore + overlap + nameBonus };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function selectSkills(skills, brief, { count = 4, overrides = [] } = {}) {
  if (!overrides.length) {
    const uniqueNames = [];
    for (const skill of rankSkills(skills, brief)) {
      if (!uniqueNames.some((candidate) => candidate.name.toLowerCase() === skill.name.toLowerCase())) uniqueNames.push(skill);
    }
    return uniqueNames.slice(0, count);
  }
  const requested = overrides.map((item) => item.toLowerCase());
  const matches = [];
  for (const wanted of requested) {
    const match = skills.find((skill) =>
      skill.name.toLowerCase() === wanted ||
      skill.path.toLowerCase() === wanted ||
      skill.root.toLowerCase() === wanted
    );
    if (!match) throw new Error(`Requested skill not found: ${wanted}`);
    if (!matches.some((skill) => skill.path === match.path)) matches.push(match);
  }
  return matches.slice(0, count);
}
