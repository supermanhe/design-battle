import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const galleryRoot = path.join(repoRoot, "assets", "gallery");

export function defaultDataDir(env = process.env, platform = process.platform) {
  if (env.DESIGN_BATTLE_HOME) return path.resolve(env.DESIGN_BATTLE_HOME);
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA || env.APPDATA || os.homedir(), "design-battle");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "design-battle");
  }
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "design-battle");
}

export function runsDir(dataDir) {
  return path.join(dataDir, "runs");
}

export function runDir(dataDir, runId) {
  assertPathSegment(runId, "run id");
  return path.join(runsDir(dataDir), runId);
}

export function entryDir(dataDir, runId, entryId) {
  assertPathSegment(entryId, "entry id");
  return path.join(runDir(dataDir, runId), "entries", entryId);
}

export function safeJoin(root, requested) {
  const target = path.resolve(root, requested);
  const relative = path.relative(path.resolve(root), target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

export function assertPathSegment(value, label = "path segment") {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}
