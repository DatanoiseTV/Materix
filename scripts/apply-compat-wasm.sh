#!/usr/bin/env bash
# Swap the stock crypto WASM for the old-WebView-compatible rebuild (see
# packaging/compat-crypto-wasm/README.md). Run BEFORE the frontend build when
# producing the "compat" APK variant. No-op-safe to run once.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$here/packaging/compat-crypto-wasm"
# Resolve the (pnpm-symlinked) installed package dir, then its pkg/ folder.
link="$here/node_modules/@matrix-org/matrix-sdk-crypto-wasm"
test -e "$link" || { echo "crypto-wasm package not installed at $link"; exit 1; }
pkg="$(readlink -f "$link")/pkg"
test -f "$src/matrix_sdk_crypto_wasm_bg.wasm" || { echo "compat wasm missing in $src"; exit 1; }
test -d "$pkg" || { echo "crypto-wasm pkg dir not found: $pkg"; exit 1; }
cp "$src/matrix_sdk_crypto_wasm_bg.js"   "$pkg/matrix_sdk_crypto_wasm_bg.js"
cp "$src/matrix_sdk_crypto_wasm_bg.wasm" "$pkg/matrix_sdk_crypto_wasm_bg.wasm"
echo "compat crypto WASM applied to $pkg"
