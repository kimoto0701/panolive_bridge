#!/bin/bash

# Get the script directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "--- Starting Relay Server ---"
cd "$ROOT_DIR/relay-server" && node index.js &

echo "--- Starting V-Side Bridge ---"
cd "$ROOT_DIR/v-side-bridge" && node index.js &

echo "--- Starting L-Side Console ---"
cd "$ROOT_DIR/l-side-console" && npm run dev &

wait
