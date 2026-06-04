#!/usr/bin/env bash
# workflow-qa-validate.sh
# Smoke test: validates that the "Spec Dev PR" workflow pipeline is reproducible
# for a given ticket. Checks ticket status and the presence of the expected
# final deliverables (spec + code).
#
# Usage: bash scripts/workflow-qa-validate.sh <ticket-id>

set -euo pipefail

TICKET_ID="${1:-}"

if [[ -z "$TICKET_ID" ]]; then
  echo "Usage: $0 <ticket-id>" >&2
  exit 1
fi

echo "==> [1/3] Checking ticket status..."
STATUS=$(fleex ticket show "$TICKET_ID" --format json 2>/dev/null | jq -r '.status')
if [[ "$STATUS" != "doing" ]]; then
  echo "FAIL: expected status 'doing', got '$STATUS'" >&2
  exit 1
fi
echo "     status=$STATUS ✓"

echo "==> [2/3] Checking for spec deliverable (final)..."
SPEC_COUNT=$(fleex ticket deliverable list "$TICKET_ID" --format json 2>/dev/null \
  | jq '[.[] | select(.type=="spec" and .status=="final")] | length')
if [[ "$SPEC_COUNT" -lt 1 ]]; then
  echo "FAIL: no final spec deliverable found" >&2
  exit 1
fi
echo "     spec deliverables (final)=$SPEC_COUNT ✓"

echo "==> [3/3] Checking for code deliverable (final)..."
CODE_COUNT=$(fleex ticket deliverable list "$TICKET_ID" --format json 2>/dev/null \
  | jq '[.[] | select(.type=="code" and .status=="final")] | length')
if [[ "$CODE_COUNT" -lt 1 ]]; then
  echo "FAIL: no final code deliverable found" >&2
  exit 1
fi
echo "     code deliverables (final)=$CODE_COUNT ✓"

echo ""
echo "✅ All checks passed — workflow QA ticket #$TICKET_ID is reproducible."
