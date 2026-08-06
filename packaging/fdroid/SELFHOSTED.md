# Self-hosted F-Droid repository (Threema-style)

Instead of (or alongside) submitting to the official F-Droid catalog, Materix
ships its **own** F-Droid repository — just like Threema's
`https://releases.threema.ch/fdroid/repo/`. It's static files on GitHub Pages,
signed with our own key. No GitLab, no review: users add the URL and get
installs + auto-updates.

**Repository URL (once published):**

```
https://datanoisetv.github.io/Materix/fdroid/repo/?fingerprint=27c03fd5e8c4e36e7e372d2e54ef0f1be15f57fedcec9f41ea22be33fa97e749
```

## How it works

The [`fdroid-repo.yml`](../../.github/workflows/fdroid-repo.yml) workflow, on a
published release (or manual dispatch):

1. builds the Android APK (`tauri android build --apk`),
2. signs it with our release key (`apksigner`, PKCS12 keystore from secrets),
3. builds the F-Droid index with `fdroidserver` (`fdroid update`),
4. deploys the `fdroid/repo/` tree to GitHub Pages.

## The signing key

A PKCS12 keystore was generated (alias `materix`, RSA-4096, 10000-day cert) and
backed up to **`~/materix-signing/`** on the machine that set this up:

```
~/materix-signing/materix-release.p12      the keystore
~/materix-signing/keystore-password.txt    its password
~/materix-signing/fingerprint.txt          27c03fd5...e749
```

> **Back this folder up somewhere safe and keep it.** This key is the permanent
> identity of the app in this repo. If it's lost or changed, everyone who added
> the repo has to remove and re-add it, and existing installs can't update. The
> fingerprint in the URL above is derived from it.

## One-time setup (run these yourself)

These touch account-level settings (Actions secrets + Pages), so they're not
automated. From the repo, with `gh` logged in as the repo owner:

```bash
# 1. Load the signing key into Actions secrets (values are not printed):
base64 -i ~/materix-signing/materix-release.p12 \
  | gh secret set FDROID_KEYSTORE_B64 --repo DatanoiseTV/Materix
printf %s "$(cat ~/materix-signing/keystore-password.txt)" \
  | gh secret set FDROID_KEYSTORE_PASS --repo DatanoiseTV/Materix
printf materix \
  | gh secret set FDROID_KEY_ALIAS --repo DatanoiseTV/Materix

# 2. Turn on GitHub Pages with the Actions source:
gh api --method POST repos/DatanoiseTV/Materix/pages -f build_type=workflow

# 3. Publish the repo:
gh workflow run fdroid-repo.yml --ref main
```

Watch it with `gh run watch`. When it's green, the repo is live at the URL above.

## Before you share the URL widely

The APK **builds** but has not been run on a device yet. Install it from your
own repo (or `pnpm tauri android build --apk --debug`) and confirm it actually
works — login, send/receive, no crash — before advertising the repo.

## Verification status

The pipeline is wired but **not yet run** (secrets/Pages are the manual steps
above, and `fdroidserver` + PKCS12 signing haven't been exercised in CI). Expect
to iterate the first run or two, same as the initial Android build.
