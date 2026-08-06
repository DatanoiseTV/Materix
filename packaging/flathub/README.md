# Publishing Materix on Flathub (Linux desktop)

Flathub builds and signs the app on its own infrastructure, so **no signing
certificate is required from you**. What Flathub needs is a working, fully
offline Flatpak build.

## What's here

- [`org.materix.app.yml`](org.materix.app.yml) — the flatpak manifest (scaffold).
- [`../org.materix.app.metainfo.xml`](../org.materix.app.metainfo.xml) — AppStream metadata.
- [`../org.materix.app.desktop`](../org.materix.app.desktop) — desktop entry.

## Remaining work before submission

1. **Add real screenshots.** Put PNGs under `docs/screenshots/` and update the
   `<screenshots>` URLs in the metainfo. Flathub fetches these at build time.

2. **Generate offline source lists.** Flathub builds have no network, so the
   Rust crates and npm packages must be vendored as generated JSON:

   ```bash
   # Rust crates -> cargo-sources.json
   pip install aiohttp toml
   curl -O https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/master/cargo/flatpak-cargo-generator.py
   python3 flatpak-cargo-generator.py src-tauri/Cargo.lock -o packaging/flathub/cargo-sources.json

   # npm packages -> node-sources.json (from the lockfile)
   # Use flatpak-builder-tools/node with the pnpm/npm lockfile, or switch the
   # manifest to `npm ci` with a committed package-lock.json and generate with
   # flatpak-node-generator.
   ```

   Then uncomment the `cargo-sources.json` / `node-sources.json` entries in the
   manifest, remove the `--share=network` build arg, and rebuild.

   > Note: this project uses pnpm. Flathub's node tooling is smoothest with an
   > npm `package-lock.json`; either commit one for packaging or use the
   > pnpm path of `flatpak-node-generator`.

3. **Build and validate locally:**

   ```bash
   flatpak install flathub org.gnome.Platform//47 org.gnome.Sdk//47 \
     org.freedesktop.Sdk.Extension.rust-stable org.freedesktop.Sdk.Extension.node20
   flatpak-builder --user --install --force-clean build-dir packaging/flathub/org.materix.app.yml
   flatpak run org.materix.app
   appstreamcli validate packaging/org.materix.app.metainfo.xml
   ```

4. **Submit.** Fork https://github.com/flathub/flathub, add
   `org.materix.app.yml` (plus the generated sources), and open a pull request
   on a new branch named `org.materix.app`. Flathub reviewers take it from there.

## Verification status

The manifest is a scaffold shaped for Tauri-on-Flathub. It has **not** been
built here (no Flatpak toolchain in this environment). The offline source lists
must be generated and a local `flatpak-builder` run must pass before submitting.
