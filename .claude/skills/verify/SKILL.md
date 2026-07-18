---
name: verify
description: How to run and drive this app locally for verification without touching the production Firebase database.
---

# Verifying Trips changes

The whole app is `index.html` (vanilla JS) backed by a **production** Firebase
Realtime Database (`hardin-trips`). Never let a local run write to it.

## Recipe that works

1. Serve the repo: `python3 -m http.server 8901 --bind 127.0.0.1` (from repo root).
2. Drive with `playwright-core` (npm install in scratchpad) + the preinstalled
   Chromium at `/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell`.
3. **Block all non-127.0.0.1 requests** with `page.route('**/*', ...)` so the
   Firebase CDN modules and prod DB are unreachable.
4. In `page.evaluate`, replace the Firebase boundary with an in-memory fake:
   override `window._db/_ref/_get/_set/_remove/_push`. The fake store MUST be
   **hierarchical** (path segments nested like RTDB) — the app writes child
   paths (`trips/t1/logistics/hotelsBooked`) and reads parents
   (`trips/t1/logistics`), so a flat path→value map silently breaks re-renders.
5. Top-level `let` globals (`allTrips`, `adminUser`, `currentUser`) are in the
   page's global lexical scope — assignable from `page.evaluate` without
   `window.`. Seed `allTrips = { t1: {...} }` before calling render functions.
6. To view a tab panel standalone, hide `.screen` elements and force the panel
   (e.g. `#tripLogisticsPanel`) visible with fixed positioning, then call its
   render function directly (e.g. `renderLogisticsPanel('t1')`).
7. Toggles/adds do a full async re-render — wait ~300–400ms after each click
   before asserting.

## Gotchas

- `showConfirmDialog` buttons are `#confirmDialogYes` / `#confirmDialogNo`.
- The service worker registration 404s under a plain http.server (registers
  `/Trips/sw.js`); harmless, ignore.
- Change log writes go through `window._push` — stub it to return unique paths.
