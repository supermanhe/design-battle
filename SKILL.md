---
name: design-battle
description: Run isolated frontend design skills against the same new standalone single-page brief and progressively present their results in a live local gallery. Use when a user asks for a design battle, wants several installed frontend/UI/design skills compared side by side, requests multiple visual directions for one page, or wants a live gallery of parallel design variants without modifying an existing project.
---

# Design Battle

Create a run outside the user's project, select distinct installed design Skills, dispatch one isolated contestant per Skill, and show results as they finish.

## Rules

- Generate only new standalone single-page entries. Do not modify the current project.
- Compare design Skills within the current host. Do not mix Agent hosts as contestants.
- Give each contestant exactly one primary design Skill.
- Permit normal coding and browser verification tools, but no additional design Skills.
- Treat the repository Node orchestrator and its file protocol as the control plane.
- Keep failed contestants isolated; never stop healthy contestants because one failed.

## Locate The Orchestrator

Resolve this `SKILL.md` directory as `DESIGN_BATTLE_ROOT`. Invoke:

```sh
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" <command>
```

Node.js 18+ is the only required runtime.

## Choose Execution Path

Prefer the current host's native parallel delegation when it is callable. Read [references/hosts.md](references/hosts.md) for the exact host workflow.

Use the CLI fallback when native delegation is unavailable:

```sh
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" run "<brief>" --host <codex|claude|hermes|openclaw>
```

Useful overrides:

```sh
--skills frontend-design,minimalist-ui
--count 4
--concurrency 2
--timeout 900
--provider copilot
--model gpt-4.1
--no-open
```

## Native Parallel Workflow

1. Prepare a run and retain its JSON output:

```sh
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" prepare "<brief>" --host <host>
```

2. Start the persistent gallery. It opens after the first `ready` entry, or after all entries fail/cancel:

```sh
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" open <run-id>
```

3. For each entry, obtain its isolated prompt. This also marks it `running`:

```sh
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" task <run-id> <entry-id>
```

4. Dispatch prompts in parallel with the current host's native sub-agent feature. Do not alter the prompt's Skill or directory constraints.

5. As each sub-agent finishes, validate immediately:

```sh
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" validate <run-id> <entry-id>
```

6. If a sub-agent fails or times out, record it without stopping the others:

```sh
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" fail <run-id> <entry-id> --error "<summary>"
```

For long-running native tasks, refresh the status heartbeat or cancel explicitly:

```sh
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" heartbeat <run-id> <entry-id> --stage "<phase>"
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" cancel <run-id> <entry-id> --reason "<summary>"
```

Do not wait for all entries before validating completed work. Progressive validation drives the live gallery.

## Operations

```sh
# Inspect relevant installed Skills
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" scan

# Check hosts, Node, Skill discovery, and history
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" doctor

# List or reopen historical runs
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" list
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" open <run-id>
node "$DESIGN_BATTLE_ROOT/bin/design-battle.mjs" clean <run-id>
```

Read [references/protocol.md](references/protocol.md) only when integrating another host or debugging run files.
