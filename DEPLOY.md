# Deploying

The app (`index.html`) is a static page served by GitHub Pages — pushing to
`main` publishes it.

The Cloudflare Worker (`worker.js`) is separate, and has historically been
deployed by pasting the file into the Cloudflare dashboard. That drifts: at one
point the deployed Worker served a `/verify-pin` route that had never been
committed, so the repo copy would have silently deleted it. Connecting the
Worker to GitHub removes that whole class of problem — `main` becomes the
deployed build by definition.

`wrangler.toml` in the repo root is what makes either option below work.

## Before the first automated deploy

Open the Worker in the Cloudflare dashboard → **Settings → Variables and
Secrets**, and check whether each entry is an encrypted **Secret** or a
plain-text **Variable**.

- **Encrypted secrets survive a deploy untouched.** Nothing to do.
- **Plain-text variables do not.** `wrangler.toml` is authoritative for them, so
  any plain-text variable not listed in a `[vars]` block is removed on deploy.

`FIREBASE_URL` is the likely candidate. If it shows as a plain Variable,
uncomment the `[vars]` block at the bottom of `wrangler.toml` before deploying.
Getting this wrong makes every widget endpoint return
`FIREBASE_URL not configured`.

Also note the **compatibility date** (Settings → Runtime) and match it in
`wrangler.toml` if it differs.

## Option A — Workers Builds (recommended)

Cloudflare's built-in GitHub integration. No API tokens to manage, no workflow
file.

1. Cloudflare dashboard → **Workers & Pages** → `hardin-trips-ai` → **Settings**
   → **Build**.
2. **Connect** to GitHub, authorise the `ErikHardin/Trips` repository.
3. Branch: `main`. Root directory: repo root.
4. Build command: leave empty. Deploy command: `npx wrangler deploy`.

Every push to `main` that touches the Worker redeploys it. Build watch paths can
be narrowed to `worker.js` and `wrangler.toml` so unrelated `index.html` pushes
don't trigger a build.

## Option B — GitHub Actions

Use this instead if you'd rather keep deploys in the repo. Requires a Cloudflare
API token with the **Edit Cloudflare Workers** template, stored as the
`CLOUDFLARE_API_TOKEN` repository secret (plus `CLOUDFLARE_ACCOUNT_ID`).

```yaml
# .github/workflows/deploy-worker.yml
name: Deploy Worker
on:
  push:
    branches: [main]
    paths: ['worker.js', 'wrangler.toml']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

**Pick one.** Enabling both deploys the Worker twice on every push.

## Confirming a deploy landed

```
curl https://hardin-trips-ai.erikchardin.workers.dev/version
```

Returns the build marker, the routes the deployed build serves, and whether the
Firebase credential still works:

```json
{
  "version": "2026-09-06",
  "routes": ["/version", "/widget-data", "/widget-upcoming",
             "/verify-pin", "/flight-lookup", "/ntfy-config"],
  "firebase": { "urlConfigured": true, "secretConfigured": true, "status": 200, "ok": true }
}
```

A route you expect but don't see means the deployed Worker is stale.
`firebase.ok: false` means the credential is rejected — the widgets will come
back empty or error regardless of which build is deployed.
