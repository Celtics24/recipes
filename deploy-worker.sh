#!/bin/bash
# Deploy the recipes Worker to the user's Cloudflare account (run only after approval).
# Usage: CF_TOKEN_FILE=<path to token file> bash deploy-worker.sh
# Reads the token from the file without printing it. Creates KV namespace
# "recipes-store", deploys worker "recipes" with a KV binding RECIPES,
# enables the workers.dev subdomain, and verifies the deployment.
set -euo pipefail

CF_TOKEN="$(cat "$CF_TOKEN_FILE")"
ACC="471a9a46bc062fff0d7448a704ef8283"
API="https://api.cloudflare.com/client/v4/accounts/$ACC"
AUTH="Authorization: Bearer $CF_TOKEN"

echo "== create KV namespace recipes-store =="
KV_JSON=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"title":"recipes-store"}' "$API/storage/kv/namespaces")
echo "$KV_JSON" | head -c 300; echo
KV_ID=$(echo "$KV_JSON" | jq -r '.result.id // empty')
if [ -z "$KV_ID" ]; then
  KV_ID=$(curl -s -H "$AUTH" "$API/storage/kv/namespaces" | jq -r '.result[] | select(.title=="recipes-store") | .id')
fi
echo "KV_ID=$KV_ID"
[ -n "$KV_ID" ] || { echo "FAILED: no KV id"; exit 1; }

echo "== deploy worker script =="
META=$(jq -n --arg kv "$KV_ID" '{
  main_module: "worker.js",
  compatibility_date: "2026-11-01",
  bindings: [{ type: "kv_namespace", name: "RECIPES", namespace_id: $kv }]
}')
curl -s -X PUT -H "$AUTH" \
  -F "metadata=$META;type=application/json" \
  -F "worker.js=@worker.js;type=application/javascript+module" \
  "$API/workers/scripts/recipes" | head -c 300; echo

echo "== enable workers.dev subdomain =="
SUB=$(curl -s -X PUT -H "$AUTH" -H "Content-Type: application/json" -d '{"enabled":true}' "$API/workers/scripts/recipes/subdomain")
echo "$SUB" | head -c 300; echo
if ! echo "$SUB" | jq -e '.success' >/dev/null 2>&1; then
  curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" -d '{"enabled":true}' "$API/workers/scripts/recipes/subdomain" | head -c 300; echo
fi

echo "== verify =="
sleep 3
curl -s -H "Origin: https://celtics24.github.io" -H "X-Recipes-Client: 1" \
  "https://recipes.y0546367987.workers.dev/api/recipes" | head -c 200; echo
