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
             "/verify-pin", "/flight-lookup", "/ntfy-config", "/booking-parse"],
  "firebase": { "urlConfigured": true, "secretConfigured": true, "status": 200, "ok": true }
}
```

- `/version` responding at all means the build landed.
- A route you expect but don't see means the deployed build is stale.
- `firebase.ok: false` means the credential is rejected — widgets will error or
  come back empty no matter which build is deployed.

---

## Booking inbox (email-in)

Forwarding a flight, hotel, rental-car or activity (restaurant, tour, tickets)
confirmation to an inbox address
queues it in the app under **Admin → Booking Inbox**. From there you pick the
trip it belongs to. The Worker's `email()` handler receives the mail, reads it
with Claude (`ANTHROPIC_KEY`) and writes it to `bookingInbox/` in Firebase
(`FIREBASE_URL` / `FIREBASE_SECRET`). Nothing new goes in `wrangler.toml`: the
routing is set up in the dashboard, once.

Email Routing needs a domain whose DNS is on Cloudflare. A `workers.dev`
address can't receive mail.

1. Dashboard → your domain → **Email → Email Routing** → **Enable**. Let it add
   the MX and TXT records it offers.
2. **Routing rules → Custom addresses → Create address**, e.g.
   `trips@yourdomain.com`. For **Action**, choose **Send to a Worker** and pick
   `hardin-trips-ai`.
3. In the app, open **Admin → Booking Inbox** and enter that address in
   **Inbox address**. It is only shown there as a reminder.
4. Deploy `database.rules.json` to the Realtime Database. It adds the
   admin-only `bookingInbox` rule, and the Worker's secret bypasses it.

**Who can send:** mail is accepted from an address in User Access with the
`admin` or `user` role, and from any address in **Booking Inbox → Approved
senders**. Use that list for personal addresses you book from that have no app
account; it's stored at `config/bookingInboxSenders`. The Worker checks the
envelope sender, the `From` header, and
the account Gmail names in `X-Forwarded-For` when auto-forwarding. Anything
else is bounced with "Sender not allowed". This keeps junk out of the queue but
isn't strong authentication, so keep the address to yourselves.

**Confirmation reply (off):** the Worker has code to email a confirmation back
to whoever forwarded the booking, but `BOOKING_SEND_REPLY` in `worker.js` keeps
it switched off. Cloudflare refuses a direct reply to a forwarded (threaded)
email ("original email is not repliable"). Sending a fresh email instead needs
either each recipient verified under Email Routing, or a sending service (Resend,
or Cloudflare Email Service on the Workers Paid plan).

**Using it:** forward the confirmation email as is. It lands in the inbox
within a few seconds, with a trip already suggested from its dates. If
`NTFY_TOPIC` is set, a push notification is sent too. **Add to Trip** writes
the booking into the trip:

- **Flights** go into the outbound, return or in-trip flight lists that Edit
  Trip shows.
- **Hotels** go onto each night's hotel, plus a check-in activity.
- **Rental cars** become pick-up and return activities.
- **Activities** (restaurant reservations, tours, tastings, tickets) become an
  activity on their day, with the time and a Booked or Paid status. If the day
  already has a matching activity, such as a planned "Dinner at Soma", that one
  is updated instead of a duplicate being added.

Each flight, hotel and car also becomes a checked line, with its confirmation number, on the
trip's Logistics booking checklist. **Paste a confirmation instead** does the
same thing for a booking that only exists in an app.

## Sign-in options (Google, Apple, email and password)

The login screen offers Google, Apple, and email and password. Access is still
decided by **Admin → User Access**, keyed by email, so whichever way someone
signs in, their email has to be on that list. Firebase setup, once:

1. Firebase console → **Authentication → Sign-in method**:
   - **Email/Password:** enable it. Leave "Email link" off.
   - **Apple:** enable it. Fill in the fields from step 2.
2. Apple Developer → **Certificates, Identifiers & Profiles**:
   - **Identifiers → App IDs →** `com.erikhardin.trips`: tick **Sign in with Apple**.
   - **Identifiers → + → Services IDs:** create one, e.g. `com.erikhardin.trips.web`.
     Turn on Sign in with Apple for it. Domain: `hardin-trips.firebaseapp.com`.
     Return URL: `https://hardin-trips.firebaseapp.com/__/auth/handler`.
   - **Keys → +:** tick **Sign in with Apple** and download the `.p8` key.
   - Back in Firebase's Apple provider, enter the Services ID, your Team ID, the
     Key ID, and the key's contents.
3. Authentication → **Settings → Authorized domains**: make sure
   `ech-technicalsolutions.com` is listed. It already is if Google sign-in works.
4. Deploy `database.rules.json`. The rules require a verified email, which
   Google and Apple always provide. Password accounts get one after clicking the
   verification email. The rules also let people delete their own User Access
   entry (**🔒 → Delete account**).
   Someone who signs in without being on the list leaves a request under
   `accessRequests/`. Admins approve it in **User Access → Waiting for access**.
   A new request also posts to the ntfy topic (`NTFY_TOPIC`).
5. iOS app: add the Sign in with Apple capability (see `ios-app/IOS.md`) and
   upload a new TestFlight build.

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
