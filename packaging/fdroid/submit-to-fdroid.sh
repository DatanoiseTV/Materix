#!/usr/bin/env bash
#
# Submit the Materix recipe to F-Droid's fdroiddata as a merge request, entirely
# via the GitLab REST API. It forks fdroiddata to your namespace, commits
# metadata/org.materix.app.yml to a new branch, and opens the MR.
#
# ---------------------------------------------------------------------------
# BEFORE YOU RUN THIS, the app should be ready or the MR will be closed:
#   [ ] The APK has been installed and RUN on a real device / emulator and works
#       (login, send/receive, no crash on launch). "Builds" is not "works".
#   [ ] It builds in F-Droid's OWN environment, not just GitHub Actions:
#         git clone https://gitlab.com/fdroid/fdroiddata && cd fdroiddata
#         cp ../Materix/packaging/fdroid/org.materix.app.yml metadata/
#         fdroid build -v -l org.materix.app        # uses F-Droid's buildserver
#   [ ] versionCode/versionName in the recipe match the tag you want packaged.
# Skipping these wastes reviewer time; F-Droid expects submitters to have done
# them. See https://f-droid.org/docs/Submitting_to_F-Droid_Quick_Start/
# ---------------------------------------------------------------------------
#
# Usage:
#   export GITLAB_TOKEN=glpat-xxxxxxxx      # PAT with 'api' scope
#   CONFIRM=yes ./packaging/fdroid/submit-to-fdroid.sh
#
set -euo pipefail

: "${GITLAB_TOKEN:?Set GITLAB_TOKEN to a GitLab personal access token with 'api' scope}"
if [ "${CONFIRM:-}" != "yes" ]; then
  echo "Refusing to submit without CONFIRM=yes (read the readiness checklist at the top)." >&2
  exit 1
fi

API="https://gitlab.com/api/v4"
UPSTREAM_ID=36528                 # fdroid/fdroiddata
BRANCH="materix"
RECIPE="$(cd "$(dirname "$0")" && pwd)/org.materix.app.yml"
AUTH=(-H "PRIVATE-TOKEN: ${GITLAB_TOKEN}")

[ -f "$RECIPE" ] || { echo "recipe not found: $RECIPE" >&2; exit 1; }

echo "==> Resolving your GitLab identity"
NS=$(curl -sf "${AUTH[@]}" "$API/user" | python3 -c 'import sys,json;print(json.load(sys.stdin)["username"])')
echo "    user: $NS"
FORK_PATH="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote('$NS/fdroiddata', safe=''))")"

echo "==> Forking fdroid/fdroiddata (skips if it already exists)"
curl -s "${AUTH[@]}" -X POST "$API/projects/$UPSTREAM_ID/fork" >/dev/null || true
echo -n "    waiting for the fork to be ready"
for _ in $(seq 1 60); do
  if curl -sf "${AUTH[@]}" "$API/projects/$FORK_PATH" >/dev/null 2>&1; then echo " ok"; break; fi
  echo -n "."; sleep 3
done

echo "==> Committing metadata/org.materix.app.yml to branch '$BRANCH' on your fork"
python3 - "$RECIPE" "$API" "$FORK_PATH" "$BRANCH" "$GITLAB_TOKEN" <<'PY'
import json, sys, urllib.request
recipe, api, fork, branch, token = sys.argv[1:6]
content = open(recipe).read()
# delete the branch first so re-runs are clean (ignore failure)
try:
    req = urllib.request.Request(f"{api}/projects/{fork}/repository/branches/{branch}",
                                 method="DELETE", headers={"PRIVATE-TOKEN": token})
    urllib.request.urlopen(req)
except Exception:
    pass
body = json.dumps({
    "branch": branch, "start_branch": "master",
    "commit_message": "New app: Materix (org.materix.app)",
    "actions": [{"action": "create", "file_path": "metadata/org.materix.app.yml", "content": content}],
}).encode()
req = urllib.request.Request(f"{api}/projects/{fork}/repository/commits", data=body,
                             headers={"PRIVATE-TOKEN": token, "Content-Type": "application/json"})
print("    commit:", json.load(urllib.request.urlopen(req))["short_id"])
PY

echo "==> Opening the merge request against fdroid/fdroiddata:master"
DESC='New app: **Materix** (`org.materix.app`) — an Apache-2.0 multi-account Matrix client (Tauri + Rust).

- Source: https://github.com/DatanoiseTV/Materix
- Builds an unsigned universal APK via `tauri android build --apk` (recipe uses `tauri android init` as a prebuild step).

Checklist:
- [ ] Tested on a device
- [ ] `fdroid build -l org.materix.app` passes in the F-Droid build environment'
python3 - "$API" "$FORK_PATH" "$BRANCH" "$UPSTREAM_ID" "$GITLAB_TOKEN" "$DESC" <<'PY'
import json, sys, urllib.request
api, fork, branch, upstream, token, desc = sys.argv[1:7]
body = json.dumps({
    "source_branch": branch, "target_project_id": int(upstream), "target_branch": "master",
    "title": "New app: Materix (org.materix.app)", "description": desc,
    "remove_source_branch": True,
}).encode()
req = urllib.request.Request(f"{api}/projects/{fork}/merge_requests", data=body,
                             headers={"PRIVATE-TOKEN": token, "Content-Type": "application/json"})
mr = json.load(urllib.request.urlopen(req))
print("    MR opened:", mr["web_url"])
PY

echo "Done."
