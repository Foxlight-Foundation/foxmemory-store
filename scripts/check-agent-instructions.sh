#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "No commits yet; skipping instruction consistency check."
  exit 0
fi

changed_files="$(git diff --name-only HEAD~1..HEAD 2>/dev/null || true)"

needs_sync=false
if echo "$changed_files" | grep -Eq '(^|/)AGENTS\.md$'; then
  needs_sync=true
fi
if echo "$changed_files" | grep -Eq '(^|/)CLAUDE\.md$|(^|/)CODEX\.md$|(^|/)\.github/copilot-instructions\.md$|(^|/)\.cursor/rules/00-read-agents\.mdc$'; then
  needs_sync=true
fi

if [ "$needs_sync" = true ]; then
  missing=()
  for f in AGENTS.md CLAUDE.md CODEX.md .github/copilot-instructions.md .cursor/rules/00-read-agents.mdc; do
    [ -f "$f" ] || missing+=("$f")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "Missing required instruction files: ${missing[*]}"
    exit 1
  fi

  grep -q 'canonical' AGENTS.md || { echo "AGENTS.md should declare canonical guidance"; exit 1; }
  grep -q 'AGENTS.md' CLAUDE.md || { echo "CLAUDE.md must point to AGENTS.md"; exit 1; }
  grep -q 'AGENTS.md' CODEX.md || { echo "CODEX.md must point to AGENTS.md"; exit 1; }
  grep -q 'AGENTS.md' .github/copilot-instructions.md || { echo "Copilot instructions must point to AGENTS.md"; exit 1; }
fi

echo "Agent instruction consistency check passed."
