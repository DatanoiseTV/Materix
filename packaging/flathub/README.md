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

2. **Offline source lists.** Flathub builds have no network, so dependencies
   must be vendored as generated JSON.

   - **Rust crates — DONE.** `cargo-sources.json` (985 crates) is committed and
     referenced by the manifest. Regenerate it on any dependency bump:
     ```bash
     python3 -m venv venv && venv/bin/pip install aiohttp tomlkit
     curl -O https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/master/cargo/flatpak-cargo-generator.py
     venv/bin/python flatpak-cargo-generator.py src-tauri/Cargo.lock \
       -o packaging/flathub/cargo-sources.json
     ```

   - **npm packages — STILL NEEDED.** This project uses pnpm, and the classic
     `flatpak-node-generator` targets npm/yarn. Either commit an npm
     `package-lock.json` for packaging and generate `node-sources.json` from it,
     or use the pnpm path of the newer node tooling. Until this exists the
     manifest keeps `--share=network` in `build-args`; remove it once node is
     vendored so the build is fully offline as Flathub requires.

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
