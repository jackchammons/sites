#!/usr/bin/env bash
# Preflight credential probe for agent workflows.
#
# The Claude Code action hides the SDK's output, so an auth or billing failure
# surfaces only as is_error:true with no cost and no model usage. This probe
# turns that into the actual API error before minutes of retries.
#
# Reads ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN from the environment
# (the API key wins, matching the SDK's credential chain). Exits 1 only on a
# definitive answer: 401/403, the credential is rejected, or a 404
# not_found_error, the model id is unknown, retired or not available to this
# credential. The agent would fail on its first turn in either case.
#
# A 429 is inconclusive: the request was turned away before it could show
# anything about the credential or the model. A subscription token routinely
# gets one here, so it is a notice; a warning on every run would bury the real
# ones. A 5xx, a failed connection or anything else unexpected warns and
# continues -- the agent has its own retries, so those must not fail the run.
#
# Usage: preflight.sh <model>   (the id the agent is about to run)
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "::error::preflight.sh: no model id given. Usage: preflight.sh <model>"
  exit 1
fi
MODEL="$1"

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

# A fresh file per run, so a request that never got a response cannot be
# described with an earlier run's error body.
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

# curl prints 000 itself when the request fails before any status arrives.
code=$(curl -sS -o "$BODY" -w '%{http_code}' \
  https://api.anthropic.com/v1/messages \
  -H "$AUTH_HEADER" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  ${EXTRA[@]+"${EXTRA[@]}"} \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":\"reply with OK\"}]}") || true
code="${code:-000}"
echo "Preflight HTTP $code (auth: $AUTH, model: $MODEL)"

TYPE=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('error',{}).get('type','?'))" "$BODY" 2>/dev/null || echo '?')
MSG=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('error',{}).get('message','?'))" "$BODY" 2>/dev/null || echo '?')

unexpected() {
  echo "::warning::Preflight did not get a clean 200 (HTTP $code, $TYPE: $MSG). The credential is not rejected, so continuing — the agent will retry."
}

case "$code" in
  200)
    echo "Credential is valid and $MODEL is reachable." ;;
  401|403)
    # Definitively bad: wrong secret, revoked key, no access to the model.
    echo "::error::Credential rejected — HTTP $code, $TYPE: $MSG"
    exit 1 ;;
  404)
    # The endpoint exists, so not_found_error is about the model id. Any other
    # 404 (a proxy's page, say) proves nothing.
    if [ "$TYPE" = "not_found_error" ]; then
      echo "::error::Model $MODEL not found — HTTP 404, $TYPE: $MSG. The id is unknown, retired or not available to this credential."
      exit 1
    fi
    unexpected ;;
  429)
    echo "::notice::Preflight was inconclusive (HTTP 429, $TYPE: $MSG): the probe was rate-limited before it could show whether the credential or $MODEL works. Continuing."
    ;;
  *)
    unexpected ;;
esac
