#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$(dirname "$SCRIPT_DIR")/bin/design-battle.mjs" doctor
