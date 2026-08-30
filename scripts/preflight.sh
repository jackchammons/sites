#!/usr/bin/env bash
# Preflight credential probe for agent workflows.
#
# The Claude Code action hides the SDK's output, so an auth or billing failure
# surfaces only as is_error:true with no cost and no model usage. This probe
# turns that into the actual API error before minutes of retries.
#
# Reads ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN from the environment
# (the API key wins, matching the SDK's credential chain). Exits 1 only when
# the credential is definitively rejected (401/403); 429s and 5xx mean the
# credential authenticated and something transient got in the way -- the agent
# has its own retries, so those must not fail the run.
#
# Usage: preflight.sh [model]   (default claude-opus-5)
set -euo pipefail

MODEL="${1:-claude-opus-5}"

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  AUTH="api"
  AUTH_HEADER="x-api-key: $ANTHROPIC_API_KEY"
  EXTRA=()
elif [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  AUTH="subscription"
  AUTH_HEADER="Authorization: Bearer $CLAUDE_CODE_OAUTH_TOKEN"
  EXTRA=(-H "anthropic-beta: oauth-2025-04-20")
else
  echo "::error::preflight.sh: neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set."
  exit 1
fi

code=$(curl -sS -o /tmp/probe.json -w '%{http_code}' \
  https://api.anthropic.com/v1/messages \
  -H "$AUTH_HEADER" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  ${EXTRA[@]+"${EXTRA[@]}"} \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":\"reply with OK\"}]}" || echo 000)
echo "Preflight HTTP $code (auth: $AUTH, model: $MODEL)"

TYPE=$(python3 -c "import json;print(json.load(open('/tmp/probe.json')).get('error',{}).get('type','?'))" 2>/dev/null || echo '?')
MSG=$(python3 -c "import json;print(json.load(open('/tmp/probe.json')).get('error',{}).get('message','?'))" 2>/dev/null || echo '?')

case "$code" in
  200)
    echo "Credential is valid and $MODEL is reachable." ;;
  401|403)
    # Definitively bad: wrong secret, revoked key, no access to the model.
    echo "::error::Credential rejected — HTTP $code, $TYPE: $MSG"
    exit 1 ;;
  *)
    echo "::warning::Preflight did not get a clean 200 (HTTP $code, $TYPE: $MSG). The credential is not rejected, so continuing — the agent will retry."
    ;;
esac
