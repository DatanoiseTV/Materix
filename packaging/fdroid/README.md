# Publishing Materix on F-Droid (Android)

**You do not need an Android signing certificate.** F-Droid compiles the app
from a git tag on its own build servers and signs it with the F-Droid key. Your
only jobs are: (1) make an Android build that works, and (2) submit a recipe.

## The catch: there is no Android build yet

Materix is a Tauri app. Tauri can target Android, but this repo has **not** been
initialized for mobile — there is no `src-tauri/gen/android`. Getting the app to
build for Android is the real work here, and it needs iteration on a machine (or
CI) with the Android SDK + NDK. This is bleeding-edge: very few Tauri apps are on
F-Droid's main repo today.

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

The recipe and metadata are scaffolds. The Android build has **not** been
produced or verified — that is the outstanding work before either F-Droid or
IzzyOnDroid can accept Materix.
