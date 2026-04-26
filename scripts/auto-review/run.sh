#!/usr/bin/env bash
# run.sh — entry for the SyncLink Auto-Reviewer.
#
# Usage:
#   bash scripts/auto-review/run.sh <prompt-name> [--dry-run]
#
# Where <prompt-name> is the basename of a file under prompts/, e.g.:
#   bash scripts/auto-review/run.sh daily-review
#   bash scripts/auto-review/run.sh test-fix
#   bash scripts/auto-review/run.sh cost-monitor
#   bash scripts/auto-review/run.sh issue-triage
#
# `--dry-run` makes Claude output to stdout only and never modifies files.
# Default behaviour is whatever the prompt's contract permits.
#
# Triggered by:
#   - macOS LaunchAgent (~/Library/LaunchAgents/io.synclink.autoreview.*.plist)
#   - GitHub Actions (.github/workflows/auto-review.yml)
#   - LEAD manually for ad-hoc runs
#
# Sprint 19 — see docs/architecture/AUTO_REVIEW.md.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${LOG_FILE:-$HOME/Library/Logs/synclink-auto-review.log}"
mkdir -p "$(dirname "$LOG_FILE")"

# shellcheck source=guardrails.sh
source "$SCRIPT_DIR/guardrails.sh"

PROMPT_NAME="${1:-daily-review}"
DRY_RUN=false
if [[ "${2:-}" == "--dry-run" ]]; then DRY_RUN=true; fi

PROMPT_FILE="$SCRIPT_DIR/prompts/${PROMPT_NAME}.md"
if [[ ! -f "$PROMPT_FILE" ]]; then
  log "ERR: unknown prompt '$PROMPT_NAME' (no $PROMPT_FILE)"
  exit 64
fi

# ── Pre-flight guards ────────────────────────────────────────────────────
guard_kill_switch || exit 0
guard_call_cap "$PROMPT_NAME" 5 || exit 0

log "===== START $PROMPT_NAME (dry-run=$DRY_RUN) ====="

# ── Build the actual prompt fed to Claude ───────────────────────────────
TMP_PROMPT="$(mktemp -t auto-review-prompt.XXXXXX)"
trap 'rm -f "$TMP_PROMPT"' EXIT

{
  printf '<!-- runtime context -->\n'
  printf 'REVIEW_DATE=%s\n' "$(date +%Y-%m-%d)"
  printf 'TODAY=%s\n'       "$(date +%Y-%m-%d)"
  printf 'DRY_RUN=%s\n'     "$DRY_RUN"
  printf '\n---\n\n'
  cat "$PROMPT_FILE"
} > "$TMP_PROMPT"

# ── Pick the Claude invocation form ──────────────────────────────────────
if ! command -v claude >/dev/null 2>&1; then
  log "WARN: 'claude' CLI not on PATH. Writing prompt to stdout for inspection."
  cat "$TMP_PROMPT"
  log "===== ABORT $PROMPT_NAME (no CLI) ====="
  exit 0
fi

# ── Execute ──────────────────────────────────────────────────────────────
cd "$PROJECT_ROOT"
set +e
claude \
  --print \
  --output-format text \
  --max-turns 30 \
  < "$TMP_PROMPT" \
  >> "$LOG_FILE" 2>&1
EXIT="$?"
set -e

# ── Post-flight guards ───────────────────────────────────────────────────
if ! guard_output_sanity; then
  log "GUARD: output sanity failed — see git log for revert action."
fi
guard_surface_escalation

log "===== END   $PROMPT_NAME (exit=$EXIT) ====="
exit "$EXIT"
