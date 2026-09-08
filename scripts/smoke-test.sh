#!/usr/bin/env bash
# End-to-end smoke test against a running API on :3001
set -euo pipefail
API="${API_URL:-http://localhost:3001}"

TOKEN=$(curl -s -X POST "$API/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

echo "Logged in OK"

KEY="smoke-$(date +%s)"

echo "1) Ref-code match (BET4821 / N\$100)…"
# Re-seed may have already fulfilled BET4821; create a fresh top-up if needed
REF=$(python3 - <<'PY'
import random
print(f"BET{random.randint(5000,9999)}")
PY
)
USER_ID=$(curl -s "$API/api/users?q=Anna" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])')
TOPUP=$(curl -s -X POST "$API/api/topups" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"expectedAmount\":100,\"refCode\":\"$REF\"}")
echo "  created top-up $REF"

R1=$(curl -s -X POST "$API/api/capture/sms" \
  -H "X-Api-Key: dev-device-paypulse-key-001" \
  -H 'Content-Type: application/json' \
  -d "{\"messages\":[{\"rawMessage\":\"PayPulse: You have received N\$100.00 from 0811111111. Ref: $REF. Balance N\$1.00\",\"receivedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"idempotencyKey\":\"$KEY-ref\",\"senderAddress\":\"PayPulse\"}]}")
echo "  $R1"
echo "$R1" | python3 -c 'import sys,json; r=json.load(sys.stdin)["results"][0]; assert r["matchStatus"]=="MATCHED" and r["credited"], r; print("  PASS ref match")'

echo "2) Unmatched deposit…"
R2=$(curl -s -X POST "$API/api/capture/sms" \
  -H "X-Api-Key: dev-device-paypulse-key-001" \
  -H 'Content-Type: application/json' \
  -d "{\"messages\":[{\"rawMessage\":\"PayPulse: You have received N\$12.34 from 0810000001.\",\"receivedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"idempotencyKey\":\"$KEY-unmatched\",\"senderAddress\":\"PayPulse\"}]}")
echo "$R2" | python3 -c 'import sys,json; r=json.load(sys.stdin)["results"][0]; assert r["matchStatus"]=="UNMATCHED", r; print("  PASS unmatched")'

echo "3) Device heartbeat…"
curl -s -X POST "$API/api/capture/heartbeat" \
  -H "X-Api-Key: dev-device-paypulse-key-001" \
  -H 'Content-Type: application/json' -d '{}' \
  | python3 -c 'import sys,json; assert json.load(sys.stdin)["ok"]; print("  PASS heartbeat")'

echo "4) Idempotent re-send…"
R4=$(curl -s -X POST "$API/api/capture/sms" \
  -H "X-Api-Key: dev-device-paypulse-key-001" \
  -H 'Content-Type: application/json' \
  -d "{\"messages\":[{\"rawMessage\":\"PayPulse: You have received N\$100.00 from 0811111111. Ref: $REF. Balance N\$1.00\",\"receivedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"idempotencyKey\":\"$KEY-ref\",\"senderAddress\":\"PayPulse\"}]}")
echo "$R4" | python3 -c 'import sys,json; r=json.load(sys.stdin)["results"][0]; assert r["created"] is False, r; print("  PASS idempotency")'

echo ""
echo "All smoke checks passed. Open http://localhost:5174"
