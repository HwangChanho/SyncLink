#!/usr/bin/env bash
# guardrails.sh — pre-flight + post-flight safety checks for auto-review.
#
# Sourced (not executed) by run.sh so all functions stay available.
# Every guard is a function returning 0 (allow) or non-zero (block).
#
# Sprint 19 — autonomous self-reviewer (docs/architecture/AUTO_REVIEW.md).

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_FILE="${LOG_FILE:-$HOME/Library/Logs/synclink-auto-review.log}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

# ─── kill switch ─────────────────────────────────────────────────────────
guard_kill_switch() {
  if [[ -f "$PROJECT_ROOT/.auto-review-disabled" ]]; then
    log "GUARD: kill switch present (.auto-review-disabled) — aborting."
    return 1
  fi
  return 0
}

# ─── daily call cap ──────────────────────────────────────────────────────
# Each prompt has its own counter file under tmp; reset at midnight.
guard_call_cap() {
  local prompt_name="$1"
  local cap="${2:-5}"
  local today
  today="$(date +%Y%m%d)"
  local counter="$PROJECT_ROOT/.auto-review-counter-$prompt_name-$today"
  local count=0
  if [[ -f "$counter" ]]; then count="$(cat "$counter")"; fi
  if (( count >= cap )); then
    log "GUARD: daily cap ($cap) reached for $prompt_name — aborting."
    return 1
  fi
  echo $((count + 1)) > "$counter"
  # Garbage-collect previous days' counters.
  find "$PROJECT_ROOT" -maxdepth 1 -name '.auto-review-counter-*' -mtime +1 -delete 2>/dev/null || true
  return 0
}

# ─── output sanity ───────────────────────────────────────────────────────
# After Claude finishes, scan its commits / files for forbidden patterns.
# Run BEFORE we trust the run as successful.
guard_output_sanity() {
  # Forbidden patterns the agent should never have introduced into a real
  # code change. Each is scoped to a "real shell context" via word
  # boundaries / start-of-line where possible to reduce false positives
  # from markdown prose that *talks about* the patterns (this very file
  # being the canonical example).
  local patterns=(
    '^[^#"]*git push --force'
    '^[^#"]*git reset --hard'
    'rm -rf /[^a-zA-Z]'
    'DROP TABLE [a-zA-Z_]'
    'DELETE FROM (users|auth\.)'
    'service_role[^"]*JWT'
    'AuthKey_[A-Z0-9]{8,}\.p8'
  )

  # Paths whose entire purpose is to describe the forbidden patterns to
  # Claude. Skipped from the scan so we don't self-trip.
  local self_paths_re='^(scripts/auto-review/|docs/architecture/AUTO_REVIEW\.md$|\.github/workflows/auto-review\.yml$)'

  # New / modified files in the working tree (uncommitted).
  local files_dirty
  files_dirty="$(cd "$PROJECT_ROOT" && git diff --name-only; cd "$PROJECT_ROOT" && git diff --cached --name-only)"

  for f in $files_dirty; do
    [[ -f "$PROJECT_ROOT/$f" ]] || continue
    # Block any change to credentials/ or .env*.
    if [[ "$f" == credentials/* || "$f" == .env* ]]; then
      log "GUARD: agent attempted to modify $f — reverting."
      (cd "$PROJECT_ROOT" && git checkout -- "$f" 2>/dev/null || true)
      return 1
    fi
    # Skip our own self-describing files.
    if [[ "$f" =~ $self_paths_re ]]; then continue; fi
    # Pattern scan.
    for p in "${patterns[@]}"; do
      if grep -qE "$p" "$PROJECT_ROOT/$f" 2>/dev/null; then
        log "GUARD: forbidden pattern '$p' in $f — reverting all dirty files."
        (cd "$PROJECT_ROOT" && git checkout -- . 2>/dev/null || true)
        return 1
      fi
    done
  done

  # Recent commits (last 5 minutes) — per-file scan that honours the
  # same self-path skip, so a legitimate commit touching auto-review/'s
  # own files never trips the guard.
  local recent_commits
  recent_commits="$(cd "$PROJECT_ROOT" && git log --since='5 minutes ago' --pretty='%H')"
  for sha in $recent_commits; do
    local files_in_commit
    files_in_commit="$(cd "$PROJECT_ROOT" && git show --name-only --pretty='' "$sha")"
    for f in $files_in_commit; do
      if [[ "$f" =~ $self_paths_re ]]; then continue; fi
      local file_diff
      file_diff="$(cd "$PROJECT_ROOT" && git show "$sha" -- "$f")"
      for p in "${patterns[@]}"; do
        if echo "$file_diff" | grep -qE "$p"; then
          log "GUARD: forbidden pattern '$p' in commit $sha (file $f) — reverting."
          (cd "$PROJECT_ROOT" && git revert --no-edit "$sha") || true
          return 1
        fi
      done
    done
  done

  return 0
}

# ─── escalation surface ──────────────────────────────────────────────────
# After every run, check if a new escalation appeared and prepend a
# one-line notice to the most recent inbox file so LEAD sees it.
guard_surface_escalation() {
  local latest_esc
  latest_esc="$(ls -1t "$PROJECT_ROOT/docs/escalations/"*.md 2>/dev/null | head -1 || true)"
  [[ -z "$latest_esc" ]] && return 0
  local age
  age="$(( ( $(date +%s) - $(stat -f %m "$latest_esc") ) / 60 ))"
  if (( age < 60 )); then
    log "ESCALATION: new escalation (age ${age}m) — $latest_esc"
  fi
  return 0
}
