# Compat crypto WASM (for old Android System WebViews)

`matrix_sdk_crypto_wasm_bg.{wasm,js}` here are a rebuild of
`@matrix-org/matrix-sdk-crypto-wasm` **18.3.1** with WebAssembly
**reference-types** and **multi-value** DISABLED
(`RUSTFLAGS="-C target-feature=-reference-types,-multivalue,+bulk-memory"`,
wasm-bindgen `--target bundler` without externref), so the crypto engine
instantiates on old Chromium WebViews (~Chromium 83, e.g. LineageOS 18.1 /
Android 11). The stock build needs Chromium 96+ (reference-types) / 85+
(multi-value) and fails to compile below that.

Used ONLY by the "compat" build variant (env `MATERIX_COMPAT=1`), which
`scripts/apply-compat-wasm.sh` swaps into node_modules before the frontend build.
The modern build keeps the stock upstream WASM untouched. Verified: compiles +
runs the OlmMachine + sends verification requests on Chromium 83.

Version pinned to the installed matrix-sdk-crypto-wasm; if that dependency is
bumped, this must be rebuilt from the matching tag or the glue ABI will mismatch.
