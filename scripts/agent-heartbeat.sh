#!/usr/bin/env bash
# PostToolUse heartbeat: logs a tiny row to public.agent_activity so the Cowork
# Command Center "Agent Room" can show live Claude Code / Ghostty sessions.
#
# Contract: NEVER break or block a session. Fire-and-forget, hard 2s timeout,
# exits 0 no matter what. No secrets/PII in the payload — tool name + a short
# detail (file basename or truncated command) only. The service-role key is
# read from gitignored env files, never hardcoded.
set +e

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"

# Load env from gitignored files (.env.local wins, then .env). Keys we need:
# a URL (SUPABASE_URL or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
for envfile in "$REPO_ROOT/.env.local" "$REPO_ROOT/.env"; do
  [ -f "$envfile" ] || continue
  # shellcheck disable=SC1090
  set -a; . "$envfile" >/dev/null 2>&1; set +a
done

URL="${SUPABASE_URL:-$VITE_SUPABASE_URL}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

# Missing config → silent no-op. The hook must never surface an error.
[ -n "$URL" ] && [ -n "$KEY" ] || exit 0

# Throttle: skip if the last heartbeat fired < 10s ago.
STAMP="/tmp/agent-heartbeat-last"
NOW=$(date +%s)
if [ -f "$STAMP" ]; then
  LAST=$(cat "$STAMP" 2>/dev/null || echo 0)
  [ $((NOW - LAST)) -lt 10 ] && exit 0
fi
echo "$NOW" > "$STAMP" 2>/dev/null

# Read hook JSON from stdin; pull tool_name and a short detail.
PAYLOAD=$(cat 2>/dev/null)
TOOL=$(printf '%s' "$PAYLOAD" | RR="$REPO_ROOT" /usr/bin/python3 -c '
import sys, json, os
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); sys.exit(0)
tool = d.get("tool_name", "") or ""
ti = d.get("tool_input", {}) or {}
detail = ""
if tool in ("Edit", "Write", "Read", "NotebookEdit"):
    p = ti.get("file_path") or ti.get("notebook_path") or ""
    # 4g: repo-relative path (not just basename) so the Command Center can infer
    # what the session is working on from the directories it touches. No PII.
    rr = os.environ.get("RR", "")
    if rr and p.startswith(rr.rstrip("/") + "/"):
        detail = p[len(rr.rstrip("/")) + 1:][-80:]
    else:
        detail = os.path.basename(p)
elif tool == "Bash":
    detail = (ti.get("command", "") or "")[:40]
# Emit two lines: tool, then detail (kept free of newlines).
print(tool)
print(detail.replace("\n", " ").strip())
' 2>/dev/null)

TOOL_NAME=$(printf '%s\n' "$TOOL" | sed -n '1p')
DETAIL=$(printf '%s\n' "$TOOL" | sed -n '2p')
[ -n "$TOOL_NAME" ] || exit 0

SESSION_LABEL="$(basename "$REPO_ROOT")-$(date +%H%M)"

# 4g identity: current git branch + optional AGENT_NAME env var. If Ethan exports
# AGENT_NAME="Marketing revamp" in a Ghostty tab, the Command Center room shows
# that as the character's name. Both are optional and never block the heartbeat.
BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)

# JSON-escape the string fields via python to stay safe with quotes/paths.
BODY=$(SL="$SESSION_LABEL" TL="$TOOL_NAME" DT="$DETAIL" BR="$BRANCH" AN="${AGENT_NAME:-}" /usr/bin/python3 -c '
import json, os
row = {
    "session_label": os.environ["SL"],
    "tool": os.environ["TL"],
    "detail": os.environ["DT"],
}
if os.environ.get("BR"): row["branch"] = os.environ["BR"][:80]
if os.environ.get("AN"): row["agent_name"] = os.environ["AN"][:60]
print(json.dumps(row))
' 2>/dev/null)
[ -n "$BODY" ] || exit 0

curl -s -m 2 -X POST "$URL/rest/v1/agent_activity" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY" >/dev/null 2>&1 &

exit 0
