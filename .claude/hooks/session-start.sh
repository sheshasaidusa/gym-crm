#!/bin/bash
# Runs at the start of Claude Code on the web sessions: installs the graphify CLI and builds its graph.
# Safe to run repeatedly. The ponytail plugin is enabled in .claude/settings.json.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"

# PyPI package "graphifyy" (double y) is the official Graphify-Labs/graphify CLI.
if ! command -v graphify >/dev/null 2>&1; then
  uv tool install graphifyy
fi

# Build the code knowledge graph (AST only, no API cost, about 10 seconds). Not fatal if it fails.
(cd "${CLAUDE_PROJECT_DIR:-.}" && graphify update . >/dev/null 2>&1) || echo "graphify update failed; continuing" >&2

# Make `graphify` available to later commands in the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi
