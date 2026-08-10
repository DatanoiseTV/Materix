#!/usr/bin/env bash
# Swap the stock crypto WASM for the old-WebView-compatible rebuild (see
# packaging/compat-crypto-wasm/README.md). Run BEFORE the frontend build when
# producing the "compat" APK variant. No-op-safe to run once.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$here/packaging/compat-crypto-wasm"
pkg="$(node -e 'process.stdout.write(require("path").dirname(require.resolve("@matrix-org/matrix-sdk-crypto-wasm/package.json")))')/pkg"
test -f "$src/matrix_sdk_crypto_wasm_bg.wasm" || { echo "compat wasm missing"; exit 1; }
test -d "$pkg" || { echo "crypto-wasm pkg dir not found: $pkg"; exit 1; }
cp "$src/matrix_sdk_crypto_wasm_bg.js"   "$pkg/matrix_sdk_crypto_wasm_bg.js"
cp "$src/matrix_sdk_crypto_wasm_bg.wasm" "$pkg/matrix_sdk_crypto_wasm_bg.wasm"
echo "compat crypto WASM applied to $pkg"
