#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "node not found on PATH" >&2
  exit 1
fi
echo "Node runtime: $NODE_BIN"

node --experimental-sea-config sea-config.json

mkdir -p ../dist
OUT="../dist/dsh-web"
cp "$NODE_BIN" "$OUT"
chmod +x "$OUT"

npx --yes postject "$OUT" NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# postject invalidates the code signature; re-sign ad-hoc or macOS refuses to run it
if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$OUT"
  echo "Ad-hoc signed: $OUT"
fi

# Optional setup menu (macOS)
cp setup/setup.sh ../dist/setup.sh
chmod +x ../dist/setup.sh

echo ""
echo "Built: $OUT"
echo "Portable layout: $OUT + setup.sh + launcher.json + runtime/ (dsh package and dsh-home)."
