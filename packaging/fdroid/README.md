# Publishing Materix on F-Droid (Android)

**You do not need an Android signing certificate.** F-Droid compiles the app
from a git tag on its own build servers and signs it with the F-Droid key. Your
only jobs are: (1) make an Android build that works, and (2) submit a recipe.

## Status: the Android build works; on-device testing is the remaining gap

The Android build now succeeds. The [`android.yml`](../../.github/workflows/android.yml)
workflow runs `tauri android init` + `tauri android build --apk` on GitHub's
infra and produces an **unsigned universal APK** at
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`
(~46 MB) — exactly the output F-Droid expects, since F-Droid signs it itself.

What has **not** been done yet:

- **Run it on a device or emulator.** "Builds" is not "works" — the mobile
  layout, WebView behavior, permissions, and calls need a real on-device pass.
  Build a debug (auto-signed) APK to test locally: `pnpm tauri android build
  --apk --debug`, or `pnpm tauri android dev` with an emulator/device attached.
- **The fdroiddata merge request** (below) — that submission is on GitLab and
  has to come from you.

## Steps

1. **Initialize and build Android locally** (needs Android Studio / SDK + NDK,
   and the Android Rust targets):

   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi \
     i686-linux-android x86_64-linux-android
   export ANDROID_HOME=$HOME/Android/Sdk
   export NDK_HOME=$ANDROID_HOME/ndk/26.3.11579264
   pnpm install
   pnpm tauri android init
   pnpm tauri android build --apk
   ```

   Expect to fix issues here — WebView features, permissions in the generated
   `AndroidManifest.xml`, icon sizes, and the mobile layout all need a real
   device/emulator pass. The `.github/workflows/android.yml` workflow runs this
   same sequence on GitHub's infrastructure (Actions -> "Android build" ->
   "Run workflow") so you can iterate without a local Android SDK.

2. **Commit what F-Droid needs.** Either commit the generated `gen/android`
   Gradle project, or keep the recipe's `pnpm tauri android init` prebuild step
   (used in [`org.materix.app.yml`](org.materix.app.yml)).

3. **Add store metadata.** F-Droid reads
   [`fastlane/metadata/android/en-US/`](../../fastlane/metadata/android/en-US/):
   `title.txt`, `short_description.txt`, `full_description.txt`, `changelogs/`.
   Still missing: `icon.png` (512x512), `featureGraphic.png` (1024x500), and
   `phoneScreenshots/*.png`. Add those for a complete listing.

4. **Tag a release:** `git tag -a v0.1.0 -m ... && git push --tags`. The recipe's
   `versionCode` (integer) must increase every release; `versionName` mirrors the
   tag.

5. **Submit the recipe.** Fork https://gitlab.com/fdroid/fdroiddata, add this
   file as `metadata/org.materix.app.yml`, run `fdroid build -v -l org.materix.app`
   to confirm it builds in their environment, and open a merge request.

## IzzyOnDroid (faster Android path)

[IzzyOnDroid](https://apt.izzysoft.de/fdroid/) is an F-Droid-compatible repo
that's quicker to get into: attach a **self-signed** release APK (a key you make
yourself for free with `keytool`, not a Google account) to a GitHub release, add
the fastlane metadata above, and request inclusion. It still needs a working
Android build first — do step 1 either way.

## Verification status

The Android APK **builds** successfully in CI (verified: unsigned universal
APK, ~46 MB). It has **not** been run on a device or emulator, and the
fdroiddata merge request has not been filed. Those two are the outstanding
work before F-Droid can ship Materix.
