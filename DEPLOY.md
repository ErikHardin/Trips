# Deploying

**The app** (`index.html`) is a static page on GitHub Pages — pushing to `main`
publishes it.

**The Worker** (`worker.js`) deploys to Cloudflare via **Workers Builds**, its
native GitHub integration. Pushing to `main` redeploys it.

That means `main` *is* the deployed Worker. It used to be pasted into the
Cloudflare dashboard by hand, which drifted: at one point production served a
`/verify-pin` route that had never been committed, so the repo copy would have
silently deleted it. Don't go back to pasting — see "After setup" below.

`wrangler.toml` in the repo root is what makes this work.

---

## One-time setup

### 1. Check the variables first

This is the step that breaks things if skipped.

Cloudflare dashboard → the `hardin-trips-ai` Worker → **Settings → Variables and
Secrets**. Each entry is either an encrypted **Secret** or a plain-text
**Variable**:

- **Encrypted secrets survive a deploy untouched.** Nothing to do.
- **Plain-text variables do not.** `wrangler.toml` is authoritative for them, so
  any plain-text variable not declared in a `[vars]` block is *removed* on
  deploy.

`FIREBASE_URL` is the likely candidate — its value isn't sensitive, so it may
well have been set as a plain Variable. If so, uncomment the `[vars]` block at
the bottom of `wrangler.toml` before the first build. Getting this wrong makes
every widget endpoint return `FIREBASE_URL not configured`.

While you're on that screen, note the **compatibility date** (Settings →
Runtime) and match it in `wrangler.toml` if it differs from what's there.

The Worker reads: `ANTHROPIC_KEY`, `FIREBASE_URL`, `FIREBASE_SECRET`,
`AERODATABOX_KEY`, `NTFY_TOPIC`, `NTFY_TOKEN`, `ADMIN_PIN`, `ADMIN_PIN_2`.

### 2. Connect the repo

Dashboard → **Workers & Pages** → `hardin-trips-ai` → **Settings** tab → **Builds**
in the right-hand sub-nav (alongside Observability, Runtime, Triggers, General).

Under **Git repository**, **Connect** and authorise the Cloudflare GitHub app for
`ErikHardin/Trips`.

**Build configuration:**

| Field | Value |
|---|---|
| Build command | *empty* |
| Deploy command | `npx wrangler@4 deploy` |
| Version command | `npx wrangler@4 versions upload` |
| Root directory | `/` |

The major version is pinned so a future wrangler release can't change deploy
behaviour without an explicit bump here.

**Branch control:** production branch `main`.

*Builds for non-production branches* controls whether pushes to other branches
also build. When on, those run the **version command** — uploading a preview
version rather than deploying to production, so it is safe, but it means every
push to every branch consumes build minutes. Off is the quieter default; on is
useful while first proving the connection works.

### 3. Narrow the build triggers

Under **Build watch paths**, set **Include paths** to `worker.js` and
`wrangler.toml`. Most pushes to this repo only touch `index.html`, and without
this every one of them starts a build.

Set this *after* you've confirmed the first build runs — with watch paths in
place, a docs-only commit won't trigger anything, which makes a broken
connection harder to tell apart from a correctly skipped build.

### 4. Confirm the first deploy

```
curl https://hardin-trips-ai.erikchardin.workers.dev/version
```

```json
{
  "version": "2026-09-06",
  "routes": ["/version", "/widget-data", "/widget-upcoming",
             "/verify-pin", "/flight-lookup", "/ntfy-config"],
  "firebase": { "urlConfigured": true, "secretConfigured": true, "status": 200, "ok": true }
}
```

- `/version` responding at all means the build landed.
- A route you expect but don't see means the deployed build is stale.
- `firebase.ok: false` means the credential is rejected — widgets will error or
  come back empty no matter which build is deployed.

---

## "This project is disconnected from your Git account"

A banner saying this can appear in the Builds section even when the repository
is filled in and the setup looks complete. It has been reported against both
Workers and Pages, sometimes as a stale warning that builds fine anyway, and
sometimes as a genuinely broken link after a repository transfer or a lapsed
authorisation.

Don't guess which it is — push a commit and watch the Builds section. A build
appearing is the answer.

If no build starts, or it fails on repository access: **Git repository** →
**Manage** → re-authorise the Cloudflare app for `ErikHardin/Trips` on GitHub.
Check <https://github.com/settings/installations> and, for an org-owned
repository, use **Switch settings context** to reach the org's copy of that
page.

## After setup

**Don't edit the Worker in the Cloudflare dashboard again.** Dashboard edits are
overwritten by the next push and reintroduce exactly the drift this replaces.
Change `worker.js`, push to `main`, let the build run.

Rolling back is a `git revert` and a push, or a previous version promoted from
the Worker's **Deployments** tab.

Bump `WORKER_VERSION` in `worker.js` when you want the deployed build to be
identifiable by more than its route list.

## Not used here

A `cloudflare/wrangler-action` GitHub Actions workflow is the alternative to
Workers Builds. Don't add one alongside this — both connected means every push
deploys the Worker twice.
