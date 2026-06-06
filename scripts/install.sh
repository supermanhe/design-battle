#!/usr/bin/env sh
set -eu

MODE="${1:-auto}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(dirname "$SCRIPT_DIR")
INSTALL_HOME="${DESIGN_BATTLE_INSTALL_HOME:-$HOME}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required before installing Design Battle." >&2
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18+ is required before installing Design Battle." >&2
  exit 1
fi

install_skill() {
  name="$1"
  root="$2"
  target="$root/design-battle"
  mkdir -p "$root"
  if [ -e "$target" ] || [ -L "$target" ]; then
    echo "$name: already installed at $target"
    return
  fi
  if [ "$MODE" != "copy" ] && ln -s "$REPO" "$target" 2>/dev/null; then
    echo "$name: linked $target"
  elif [ "$MODE" = "link" ]; then
    echo "$name: link failed" >&2
    exit 1
  else
    cp -R "$REPO" "$target"
    rm -rf -- "$target/.git"
    echo "$name: copied $target"
  fi
}

check_host() {
  name="$1"
  command="$2"
  root="$3"
  if command -v "$command" >/dev/null 2>&1 || [ -d "$root" ]; then
    install_skill "$name" "$root"
  else
    echo "$name: unavailable, skipped"
  fi
}

check_host "Codex" codex "$INSTALL_HOME/.codex/skills"
check_host "Claude Code" claude "$INSTALL_HOME/.claude/skills"
check_host "Hermes" hermes "$INSTALL_HOME/.hermes/skills"
check_host "OpenCode" opencode "$INSTALL_HOME/.config/opencode/skills"
check_host "OpenClaw" openclaw "$INSTALL_HOME/.openclaw/skills"
install_skill "Shared Agent Skills" "$INSTALL_HOME/.agents/skills"
node "$REPO/bin/design-battle.mjs" doctor
