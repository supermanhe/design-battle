# Host Execution

All hosts use the same `prepare`, `task`, `validate`, and `fail` commands. The gallery never consumes proprietary host events.

## Codex

Prefer Codex multi-agent tools. Spawn one agent per entry using the exact prompt printed by `task`. Each agent must use its assigned entry directory as its only writable workspace. Wait for agents independently and call `validate` as each one finishes.

Fallback:

```sh
design-battle run "<brief>" --host codex
```

The fallback invokes `codex exec` in each isolated entry directory.

## Claude Code

Prefer background agents or isolated worktree agents. Give each background agent the exact `task` prompt and entry directory. Call `validate` or `fail` when each background agent reports.

Fallback:

```sh
design-battle run "<brief>" --host claude
```

The fallback invokes non-interactive `claude -p`.

## Hermes

Prefer a batched `delegate_task` call with one task per entry. Preserve each task's Skill and directory constraints. Process delegated results independently.

Fallback:

```sh
design-battle run "<brief>" --host hermes
```

The fallback invokes Hermes one-shot mode. A locally installed but unauthenticated Hermes may exit without producing an entry; validation records that contestant as failed.

Override an exhausted or unsuitable configured provider without changing the user's Hermes defaults:

```sh
design-battle run "<brief>" --host hermes --provider copilot --model gpt-4.1
```

## OpenClaw

Prefer `sessions_spawn` with one isolated session per entry. Preserve the output protocol and finalize entries independently.

Spawn each entry with its exact task prompt plus:

```json
{
  "taskName": "<entry-id>",
  "cwd": "<entry-directory>",
  "runtime": "subagent",
  "sandbox": "require",
  "context": "isolated",
  "mode": "run"
}
```

Treat spawn acceptance as asynchronous, then use `sessions_yield` for completion events rather than polling. Call `validate` or `fail` independently for each announcement. See the official [Sub-Agents](https://docs.openclaw.ai/tools/subagents) and [Multi-Agent Sandbox](https://docs.openclaw.ai/tools/multi-agent-sandbox-tools) references.

Fallback:

```sh
design-battle run "<brief>" --host openclaw
```

The fallback invokes `openclaw agent --session-key <run-entry> --message <prompt> --json`, following the official [Agent CLI](https://docs.openclaw.ai/cli/agent) contract.

When OpenClaw is unavailable, use `--executor mock` only for adapter contract tests. Do not claim a real OpenClaw run.

## OpenCode

Prefer OpenCode agent or session delegation when the current OpenCode environment exposes it. Give each delegated agent the exact `task` prompt and isolated entry directory, then validate results independently.

Fallback:

```sh
design-battle run "<brief>" --host opencode
```

The fallback invokes `opencode run <prompt> --dir <entry-directory> --dangerously-skip-permissions`. This is limited to the contestant's isolated entry directory so non-interactive tool calls can complete. Override the model with OpenCode's `provider/model` format:

```sh
design-battle run "<brief>" --host opencode --model zai/glm-5
```

Alternatively, pass provider and model separately and Design Battle combines them:

```sh
design-battle run "<brief>" --host opencode --provider zai --model glm-5
```
