# Run Protocol

## Layout

Runs live under the user-level Design Battle data directory:

```text
runs/<run-id>/
  run.json
  gallery.json
  entries/<entry-id>/
    meta.json
    status.json
    agent.log
    primary-skill/SKILL.md
    site/index.html
```

`site/index.html` must load directly in an iframe. Local assets may exist only under the same `site/` directory.

## Statuses

- `queued`: waiting for an execution slot
- `running`: contestant is actively generating
- `ready`: `site/index.html` exists and passed validation
- `failed`: contestant failed, timed out, or produced an invalid entry
- `cancelled`: execution was intentionally stopped

Write JSON atomically. The gallery polls run state and broadcasts changes over SSE.
Long-running native delegates may refresh `updatedAt` with the `heartbeat` command. Stale `running` entries are marked interrupted during reconciliation.

## Isolation

Stage exactly one selected `SKILL.md` inside each entry so restrictive hosts can read it without access to global Skill directories. Preserve original source paths in metadata. Launch each CLI fallback with its entry directory as the working and writable root. Native sub-agent prompts explicitly prohibit reading sibling entry directories. The HTTP server resolves entry assets through a traversal-safe route.

## Recovery

Starting `serve <run-id>` rescans status. Interrupted `running` entries become `failed`; queued entries with valid output become `ready`. Existing ready and failed entries remain visible.
