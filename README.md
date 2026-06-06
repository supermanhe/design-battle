# Design Battle

Design Battle runs several installed frontend design Skills against the same standalone page brief, isolates every contestant, and presents results progressively in a local live gallery.

## Requirements

- Node.js 18+
- At least one supported host CLI: Codex, Claude Code, Hermes, OpenCode, or OpenClaw
- Installed frontend design Skills

## Quick Start

```sh
node ./bin/design-battle.mjs doctor
node ./bin/design-battle.mjs run "Create a launch page for a focused writing app" --host codex
```

Use native host delegation when available:

```sh
node ./bin/design-battle.mjs prepare "Create a launch page" --host codex
node ./bin/design-battle.mjs open <run-id>
node ./bin/design-battle.mjs task <run-id> <entry-id>
node ./bin/design-battle.mjs validate <run-id> <entry-id>
node ./bin/design-battle.mjs close <run-id>
```

See [SKILL.md](SKILL.md) for the complete workflow and [references/protocol.md](references/protocol.md) for the run-file contract.

For a visual Chinese walkthrough aimed at designers, open [docs/designer-guide.html](docs/designer-guide.html).

## Development

```sh
npm test
npm run doctor
npm pack --dry-run
```

The test suite covers Skill discovery, all host adapter contracts, native delegation protocol, concurrent execution, cancellation, recovery, validation, gallery APIs, SSE updates, and path traversal protection.

## Safety

- Contestants write only inside isolated run entry directories.
- Exactly one primary design Skill is staged per contestant.
- Gallery entry pages render in sandboxed iframes without same-origin access.
- Local entry assets are traversal-checked and validated before an entry becomes ready.
- Failed and cancelled contestants do not stop healthy contestants.

## License

MIT
