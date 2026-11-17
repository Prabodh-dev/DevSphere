#!/usr/bin/env bash
# Checks a running DevSphere: waits for /readyz, then registers and logs in.
# Usage: scripts/smoke-test.sh [base-url]   (default http://127.0.0.1:5000)
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:5000}"
TIMEOUT="${SMOKE_TIMEOUT_SECONDS:-120}"

fail() {
  echo "smoke test failed: $*" >&2
  exit 1
}

# Wait until the app reports that it is ready.
deadline=$((SECONDS + TIMEOUT))
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/readyz" || true)" = "200" ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    fail "not ready after ${TIMEOUT}s ($BASE_URL/readyz)"
  fi
  sleep 1
done
echo "ready: $BASE_URL/readyz"

# A throwaway account, different on every run.
suffix="$(date +%s)$RANDOM"
username="smoke${suffix}"
email="${username}@example.test"
password="Smoke-test-${suffix}-pw"
headers="$(mktemp)"
trap 'rm -f "$headers"' EXIT

token_of() {
  sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

register="$(curl -s -D "$headers" -w '\n%{http_code}' -X POST "$BASE_URL/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$username\",\"email\":\"$email\",\"password\":\"$password\"}")"
[ "$(printf '%s' "$register" | tail -n1)" = "201" ] || fail "register: $register"
echo "registered $username"

login="$(curl -s -D "$headers" -w '\n%{http_code}' -X POST "$BASE_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"$password\"}")"
[ "$(printf '%s' "$login" | tail -n1)" = "200" ] || fail "login: $login"

token="$(printf '%s' "$login" | head -n1 | token_of)"
[ -n "$token" ] || fail "login returned no access token"
grep -qi '^set-cookie: refresh_token=.*HttpOnly' "$headers" || fail "login set no refresh cookie"
echo "logged in"

# The access token works on a protected route.
status="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/v1/chat" \
  -H "Authorization: Bearer $token")"
[ "$status" = "200" ] || fail "GET /api/v1/chat answered $status"

echo "smoke test passed"
