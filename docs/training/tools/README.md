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

# rebuild the admin, user and guest PDFs from ../README.md and the screenshots
npm install --no-save marked marked-gfm-heading-id
node build-pdf.js
```

Environment overrides:

- `CHROME_PATH`: the Chromium binary (defaults to the preinstalled `/opt/pw-browsers` build).
- `SHOOT_CACHE`: where downloaded assets are cached (defaults to the system temp dir).

## Files

- `seed.js`: the sample trips, users and settings shown in the screenshots. Edit this to change what appears.
- `shoot.js`: the list of screens to capture and how to reach each one.
- `build-pdf.js`: renders `../README.md` into three PDFs, one per role (`Hardin-Trips-Admin-Guide.pdf`, `-User-Guide.pdf`, `-Guest-Guide.pdf`), with a cover page and side-by-side screenshots. `node build-pdf.js guest` builds just one.

## Role markers in the guide

`../README.md` is the complete guide (the admin edition). HTML comments in it, which GitHub doesn't show, choose what goes in each role's PDF:

- `<!-- only: admin user -->` … `<!-- /only -->`: shown on GitHub, and only in the listed roles' PDFs. These can nest, and can sit inside a sentence.
- `<!-- for: guest` on one line, the text, then `-->` on its own line: hidden on GitHub, and added to the listed roles' PDFs. Use it for wording or screenshots that differ by role. The text inside can't contain `-->`.
- `<!-- only: readme -->` … `<!-- /only -->`: GitHub only, never in a PDF.

Sections that drop out are renumbered, along with the contents list and "section N" references. The build fails if a PDF links to a section it no longer has.
- `lib.js`: browser launch, request blocking, and fake-Firebase injection.
- `fakefb.js`: the fake Firebase modules (database, auth, storage).
