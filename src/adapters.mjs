import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { entryDir } from "./paths.mjs";
import { buildEntryPrompt } from "./prompt.mjs";
import { loadRun } from "./state.mjs";

export const HOSTS = {
  codex: {
    command: "codex",
    args: (dir, _prompt, options = {}) => [
      "exec", "-", "--skip-git-repo-check", "--ephemeral", "--sandbox", "workspace-write", "-C", dir,
      ...(options.hostModel ? ["--model", options.hostModel] : [])
    ],
    stdin: true,
    native: "multi-agent",
    windowsLaunch: (env) => {
      const script = path.join(env.APPDATA || "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
      return existsSync(script) ? { command: process.execPath, prefix: [script] } : null;
    }
  },
  claude: {
    command: "claude",
    args: (_dir, _prompt, options = {}) => [
      "-p", "--no-session-persistence", "--permission-mode", "acceptEdits",
      ...(options.hostModel ? ["--model", options.hostModel] : [])
    ],
    stdin: true,
    native: "background agents/worktree",
    windowsLaunch: (env) => {
      const executable = path.join(env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
      return existsSync(executable) ? { command: executable, prefix: [] } : null;
    }
  },
  hermes: {
    command: "hermes",
    args: (_dir, prompt, options = {}) => [
      "--oneshot", prompt,
      ...(options.hostProvider ? ["--provider", options.hostProvider] : []),
      ...(options.hostModel ? ["--model", options.hostModel] : [])
    ],
    stdin: false,
    native: "delegate_task"
  },
  openclaw: {
    command: "openclaw",
    args: (dir, prompt) => {
      const runId = path.basename(path.dirname(path.dirname(dir)));
      const entryId = path.basename(dir);
      return ["agent", "--session-key", `design-battle-${runId}-${entryId}`, "--message", prompt, "--json"];
    },
    stdin: false,
    native: "sessions_spawn",
    windowsShell: true
  }
};

export function getHostAdapter(host) {
  const adapter = HOSTS[host];
  if (!adapter) throw new Error(`Unsupported host: ${host}`);
  return adapter;
}

export async function runCliEntry({ dataDir, run, entry, timeoutMs, env = process.env }) {
  const dir = entryDir(dataDir, run.id, entry.id);
  const prompt = buildEntryPrompt({ brief: run.brief, skill: entry.skill, entryDir: dir });
  const adapter = getHostAdapter(run.host);
  const logFile = path.join(dir, "agent.log");
  await writeFile(logFile, `Design Battle ${run.id} / ${entry.id}\nHost: ${run.host}\nSkill: ${entry.skill.path}\n\n`, "utf8");
  return new Promise((resolve, reject) => {
    const commandArgs = adapter.args(dir, prompt, run.options);
    const child = spawnSpec(adapter, commandArgs, env);
    const processHandle = spawn(child.command, child.args, {
      cwd: dir,
      env: { ...env, DESIGN_BATTLE_ENTRY_DIR: dir, DESIGN_BATTLE_SKILL: entry.skill.path },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32"
    });
    const append = (chunk) => appendFile(logFile, chunk).catch(() => {});
    processHandle.stdout.on("data", append);
    processHandle.stderr.on("data", append);
    if (adapter.stdin) processHandle.stdin.end(prompt);
    else processHandle.stdin.end();
    let settled = false;
    let timer;
    let cancellationPoll;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (cancellationPoll) clearInterval(cancellationPoll);
      callback(value);
    };
    processHandle.on("error", (error) => finish(reject, error));
    timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(cancellationPoll);
      await terminateProcessTree(processHandle);
      const error = new Error(`Timed out after ${timeoutMs}ms`);
      error.code = "ETIMEDOUT";
      reject(error);
    }, timeoutMs);
    cancellationPoll = setInterval(async () => {
      if (settled) return;
      const current = await loadRun(dataDir, run.id).catch(() => null);
      const status = current?.entries.find((candidate) => candidate.id === entry.id)?.status;
      if (status !== "cancelled") return;
      settled = true;
      clearTimeout(timer);
      clearInterval(cancellationPoll);
      await terminateProcessTree(processHandle);
      const error = new Error("Entry was cancelled.");
      error.code = "ECANCELLED";
      reject(error);
    }, 250);
    cancellationPoll.unref?.();
    processHandle.on("exit", (code, signal) => {
      if (code === 0) finish(resolve, { code, signal });
      else finish(reject, new Error(`Agent exited with code ${code}${signal ? ` (${signal})` : ""}`));
    });
  });
}

export async function terminateProcessTree(child, {
  platform = process.platform,
  kill = process.kill,
  spawnProcess = spawn
} = {}) {
  if (!child.pid) return;
  if (platform !== "win32") {
    try {
      kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    return;
  }
  await new Promise((resolve) => {
    const killer = spawnProcess("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.once("exit", resolve);
    killer.once("error", resolve);
  });
}

function spawnSpec(adapter, args, env) {
  if (process.platform !== "win32") return { command: adapter.command, args };
  const direct = adapter.windowsLaunch?.(env);
  if (direct) return { command: direct.command, args: [...direct.prefix, ...args] };
  if (!adapter.windowsShell) return { command: adapter.command, args };
  const commandLine = [adapter.command, ...args].map(quoteWindowsArgument).join(" ");
  return { command: env.ComSpec || process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", commandLine] };
}

function quoteWindowsArgument(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:=+-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
