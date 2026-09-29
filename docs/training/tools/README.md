# Regenerating the training-guide screenshots

These scripts drive the app in headless Chromium and write the PNGs in `../img/`.

**They never touch the production Firebase database.** The Firebase SDK imports are replaced with `fakefb.js`, an in-memory fake seeded from `seed.js`. All network traffic is blocked except static assets: Leaflet, Google Fonts, CARTO map tiles, and Open-Meteo weather. The AI worker, ntfy and the geocoders are all blocked.

## Run

```sh
# from the repo root
python3 -m http.server 8901 --bind 127.0.0.1 &
cd docs/training/tools
npm install --no-save playwright-core
node shoot.js            # all screenshots
node shoot.js 09         # only files whose name starts with "09"
```

Environment overrides:

- `CHROME_PATH`: the Chromium binary (defaults to the preinstalled `/opt/pw-browsers` build).
- `SHOOT_CACHE`: where downloaded assets are cached (defaults to the system temp dir).

## Files

- `seed.js`: the sample trips, users and settings shown in the screenshots. Edit this to change what appears.
- `shoot.js`: the list of screens to capture and how to reach each one.
- `lib.js`: browser launch, request blocking, and fake-Firebase injection.
- `fakefb.js`: the fake Firebase modules (database, auth, storage).
