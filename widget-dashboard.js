// Hardin Trips + Parcel Pickup — combined Scriptable dashboard
//
// One Large home-screen widget carrying what used to take two: the trip
// countdown and outstanding bookings from widget-upcoming.js, the pending
// package count from parcelpending/scriptable-widget.js, and a weather strip
// for Denver, Cleveland, and wherever the phone is when that's somewhere else.
//
// Install:
//   1. Create a new Scriptable script and paste this file in. Name it
//      something like "Trips Dashboard".
//   2. Long-press the home screen → add a Scriptable widget (Large).
//   3. Long-press the widget → Edit Widget → Script: the name from step 1.
//
// Tapping:
//   · the trips or weather area runs the "Hardin Trips" shortcut, which opens
//     the installed PWA — iOS hands any https:// URL to the browser, so going
//     through Shortcuts is what keeps the tap out of Safari. The shortcut has
//     to exist on the phone under exactly the name in SHORTCUT_NAME.
//   · the parcel band re-runs this script in Scriptable, which opens the same
//     menu the parcel widget has: show the barcode full screen, mark a parcel
//     picked up, or open the web app.
//
// The "here" tile needs location access for Scriptable (Settings → Privacy →
// Location Services → Scriptable → While Using). Without it the strip simply
// shows the two standing cities, which is also what it does at home.
//
// A Medium or Small widget falls back to the trip/booking columns alone —
// there's no room for the weather rows at those sizes.

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER_URL     = "https://hardin-trips-ai.erikchardin.workers.dev/widget-upcoming";
const PARCEL_DB_ROOT = "https://parcelpending-e22a5-default-rtdb.firebaseio.com";
const PARCEL_APP_URL = "https://erikhardin.github.io/parcelpending/";
const SHORTCUT_NAME  = "Hardin Trips";  // must match the shortcut's name exactly

const TRIP_COUNT     = 4;   // upcoming trips to show
const BOOK_COUNT     = 3;   // outstanding-booking rows to show
const BOOKING_MONTHS = 12;  // how far ahead to look for outstanding bookings
                            // the app's popup uses 6; the widget looks further out

// The two standing weather tiles. Coordinates rather than names: these never
// change, so there's nothing to geocode and nothing to get wrong.
const CITIES = [
  { label: "Denver",    emoji: "🏠", lat: 39.7392, lon: -104.9903 },
  { label: "Cleveland",              lat: 41.4993, lon:  -81.6944 },
];

// A third tile for where you are now, added only when that's somewhere else —
// within this many miles of a standing tile it would just be a duplicate, so
// the strip drops to two wider ones instead.
const HERE_MIN_MILES = 25;

// Days of forecast beside today. One more than this is requested, because
// index 0 of the daily arrays is today, which each row already shows.
const FORECAST_DAYS = 5;
const FORECAST_DAYS_TIGHT = 3;   // three cities: less width to spend

// Match the web app: JsBarcode encodes the code plus a trailing newline
// (the kiosk scanner treats it as an Enter keypress).
const APPEND_NEWLINE = true;

// Column widths. The large widget is about 305pt of usable width on a current
// iPhone and the gap between the columns is flexible, so these stay put and the
// slack goes down the middle. Medium is narrower per column but the same idea.
const COL_TRIPS_LARGE = 196;
const COL_BOOK_LARGE  = 120;
const COL_TRIPS_MED   = 200;
const COL_BOOK_MED    = 115;

// The parcel band, laid out left to right: the text block, then whatever's
// left goes to the barcode. 136pt puts about 1.2pt in a narrow bar — half the
// stand-alone widget's, which is why the full-screen one stays a tap away.
const PARCEL_TEXT_W = 118;
const BARCODE_W     = 136;
const BARCODE_H     = 34;

// The two fixed flanks of a trip row: four Apple flags at 11pt come to about
// 52pt, and "172d" at 13pt bold to about 30pt.
// A weather row spans the widget: 316pt of content, less 20pt of padding. The
// left block is fixed so every row's forecast starts at the same x — a ragged
// left edge there is what makes a stack of rows look accidental. What's left
// divides into day columns, or into the wider two-line chips the away row uses.
const ROW_LEFT_W = 122;
const DAY_W      = 29;
const CHIP_W     = 44;

const EMOJI_W = 52;
const COUNT_W = 38;

// ── Colors ────────────────────────────────────────────────────────────────────
// The deep sage palette from widget-upcoming.js, kept as the dashboard's single
// theme — the parcel widget's near-black ground would read as a second widget
// pasted into this one. Every pair that carries text clears WCAG AA against the
// surface it sits on.
const BG         = new Color("#333d37");
const TERRACOTTA = new Color("#eb9163");
const INK        = new Color("#eaf0ec");
const MUTED      = new Color("#b0bcb3");
// Only 1.3 against BG, which is deliberate: the cards should read as slightly
// raised surfaces, not outlined boxes.
const SAND       = new Color("#414d45");
// The section rules, on the other hand, have to be seen — SAND is only 1.3
// against BG, which is right for a card and useless for a hairline.
const DIVIDER    = new Color("#5b6b60");

const BOOKING_ICONS = { flights: "✈️", hotel: "🏨", car: "🚗" };

const TRIPS_URL  = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;
const PARCEL_URL = `scriptable:///run/${encodeURIComponent(Script.name())}`;

// ── Data ──────────────────────────────────────────────────────────────────────

// Fetch JSON, falling back to the last good copy on disk. iOS refreshes widgets
// on its own schedule, often with no network at that moment, and a blank panel
// is worse than a slightly stale one.
async function loadJSONCached(url, cacheName) {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.cacheDirectory(), cacheName);
  try {
    const data = await new Request(url).loadJSON();
    // A worker/Firebase error comes back as JSON with a 200-ish shape too —
    // don't overwrite good cached data with it.
    if (data && !data.error) {
      fm.writeString(path, JSON.stringify(data));
      return data;
    }
  } catch (e) {}
  if (fm.fileExists(path)) {
    try { return JSON.parse(fm.readString(path)); } catch (e) {}
  }
  return null;
}

async function fetchTrips() {
  return loadJSONCached(
    `${WORKER_URL}?limit=${TRIP_COUNT}&months=${BOOKING_MONTHS}`,
    "trips-dashboard-trips.json"
  );
}

async function fetchParcels() {
  // Same cache file the stand-alone parcel widget uses, so the two agree when
  // one of them has been offline.
  const data = await loadJSONCached(PARCEL_DB_ROOT + "/parcels.json", "parcelpending-widget.json");
  return data || {};
}

// Pending [key, parcel] entries, newest first.
function pendingEntries(parcels) {
  return Object.entries(parcels)
    .filter(([, p]) => p && !p.done)
    .sort((a, b) => String(b[1].addedAt || "").localeCompare(String(a[1].addedAt || "")));
}

// ── Weather ───────────────────────────────────────────────────────────────────

// Denver and Cleveland always, plus wherever the phone is when that's somewhere
// else. Two tiles is a normal state, not a degraded one: at home the third
// would just repeat Denver, so the strip widens instead of padding itself out.
async function weatherPoints() {
  const points = CITIES.slice();
  const here = await currentPoint();
  if (here && CITIES.every(c => milesBetween(c, here) > HERE_MIN_MILES)) points.push(here);
  return points;
}

// Where the phone is, as a tile. iOS hands a widget a location grudgingly —
// permission may be off, and a refresh in the background can hang — so this
// gives up after a few seconds and falls back to the last fix of the day. That
// keeps the tile steady while travelling instead of flickering in and out.
async function currentPoint() {
  const fm    = FileManager.local();
  const path  = fm.joinPath(fm.cacheDirectory(), "trips-dashboard-here.json");
  const fresh = await withTimeout(locate(), 4000);

  if (fresh) {
    try { fm.writeString(path, JSON.stringify({ ...fresh, at: Date.now() })); } catch (e) {}
    return fresh;
  }
  if (fm.fileExists(path)) {
    try {
      const last = JSON.parse(fm.readString(path));
      if (Date.now() - (last.at || 0) < 12 * 3600 * 1000) return last;
    } catch (e) {}
  }
  return null;
}

async function locate() {
  try {
    // Weather is a city-scale question; the coarse fix is faster and doesn't
    // wake the GPS.
    Location.setAccuracyToThreeKilometers();
    const loc = await Location.current();
    if (!loc) return null;
    let label = "Here";
    try {
      const place = (await Location.reverseGeocode(loc.latitude, loc.longitude))[0];
      label = place?.locality || place?.subAdministrativeArea || place?.administrativeArea || label;
    } catch (e) {}
    return { label, emoji: "📍", lat: loc.latitude, lon: loc.longitude };
  } catch (e) {
    return null;
  }
}

// Scriptable has no cancellable request, so the only way to bound a call that
// may never come back is to stop waiting for it.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(resolve => Timer.schedule(ms, false, () => resolve(null))),
  ]);
}

function milesBetween(a, b) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 7918 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// One request covers every tile: Open-Meteo takes comma-separated coordinates
// and answers with an array (an object, when there's only one point).
async function fetchWeather(points) {
  if (!points.length) return [];
  const url = "https://api.open-meteo.com/v1/forecast"
    + "?latitude="  + points.map(p => p.lat).join(",")
    + "&longitude=" + points.map(p => p.lon).join(",")
    + "&current=temperature_2m,weather_code"
    + "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset"
    + "&temperature_unit=fahrenheit&timezone=auto&forecast_days=" + (FORECAST_DAYS + 1);

  const fm = FileManager.local();
  const path = fm.joinPath(fm.cacheDirectory(), "trips-dashboard-weather.json");
  let raw = null;
  try {
    raw = await new Request(url).loadJSON();
    if (raw) fm.writeString(path, JSON.stringify({ url, raw }));
  } catch (e) {
    // Only reuse the cache when it was built for these same places — the tiles
    // are labelled from `points`, so a stale payload would mislabel them.
    if (fm.fileExists(path)) {
      try {
        const cached = JSON.parse(fm.readString(path));
        if (cached.url === url) raw = cached.raw;
      } catch (e2) {}
    }
  }
  if (!raw) return points.map(p => ({ label: p.label, emoji: p.emoji, ok: false }));

  const list = Array.isArray(raw) ? raw : [raw];
  return points.map((p, i) => {
    const w = list[i];
    const code = w?.current?.weather_code ?? w?.daily?.weather_code?.[0];
    const now  = Math.round(w?.current?.temperature_2m);
    const hi   = Math.round(w?.daily?.temperature_2m_max?.[0]);
    const lo   = Math.round(w?.daily?.temperature_2m_min?.[0]);
    if (code == null || isNaN(now)) return { label: p.label, emoji: p.emoji, ok: false };
    const { emoji: sky, cond } = wxInfo(code);
    return { label: p.label, emoji: p.emoji, ok: true, sky, cond, now, hi, lo,
             sun: sunLabel(w), days: forecastDays(w) };
  });
}

// "↑6:33  ↓7:21" for today. No am/pm: the arrows already say which is which,
// and dropping it buys back the width that lets this share the label's line.
// Empty inside the Arctic Circle in summer, where the API returns no sunrise
// because there isn't one.
function sunLabel(w) {
  const rise = clockLabel(w?.daily?.sunrise?.[0]);
  const set  = clockLabel(w?.daily?.sunset?.[0]);
  return rise && set ? `↑${rise}  ↓${set}` : "";
}

// The times arrive as the city's own local time with no offset attached
// ("2026-09-07T06:33"), so they're read as text. Handing that to `new Date()`
// would re-read it in the phone's timezone and put Cleveland's sunrise two
// hours out — the same trap dowLabel() sidesteps.
function clockLabel(iso) {
  const m = String(iso || "").match(/T(\d{2}):(\d{2})/);
  if (!m) return "";
  return (parseInt(m[1], 10) % 12 || 12) + ":" + m[2];
}

// The days after today. Index 0 of the daily arrays is today, which every row
// already carries as its own high/low, so the forecast starts at 1.
function forecastDays(w) {
  const time = w?.daily?.time || [];
  const out = [];
  for (let i = 1; i < time.length; i++) {
    const hi   = Math.round(w.daily.temperature_2m_max?.[i]);
    const lo   = Math.round(w.daily.temperature_2m_min?.[i]);
    const code = w.daily.weather_code?.[i];
    if (code == null || isNaN(hi) || isNaN(lo)) continue;
    out.push({ dow: dowLabel(time[i]), sky: wxInfo(code).emoji, hi, lo });
  }
  return out;
}

// The API dates each day in the city's own timezone. Anchoring at noon UTC and
// reading it back in UTC is what stops the label sliding a day either way when
// the phone is somewhere else entirely.
function dowLabel(iso) {
  return new Date(iso + "T12:00:00Z")
    .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
    .toUpperCase();
}

// Icon and wording straight from wxInfo() in index.html, so a tile and the
// app's day cards never describe the same sky differently.
function wxInfo(code) {
  if (code === 0)  return { emoji: "☀️",  cond: "Clear" };
  if (code <= 2)   return { emoji: "⛅",  cond: "Partly cloudy" };
  if (code === 3)  return { emoji: "☁️",  cond: "Overcast" };
  if (code <= 49)  return { emoji: "🌫️", cond: "Foggy" };
  if (code <= 57)  return { emoji: "🌦️", cond: "Drizzle" };
  if (code <= 67)  return { emoji: "🌧️", cond: "Rain" };
  if (code <= 77)  return { emoji: "❄️",  cond: "Snow" };
  if (code <= 82)  return { emoji: "🌧️", cond: "Showers" };
  if (code <= 86)  return { emoji: "🌨️", cond: "Snow showers" };
  if (code <= 99)  return { emoji: "⛈️",  cond: "Thunderstorm" };
  return { emoji: "🌡️", cond: "" };
}

// ── Widget ────────────────────────────────────────────────────────────────────

async function buildWidget() {
  const [data, parcels] = await Promise.all([fetchTrips(), fetchParcels()]);

  const trips       = data?.trips || [];
  const outstanding = data?.outstanding || [];
  const isLarge     = config.widgetFamily === "large" || !config.widgetFamily;

  const w = new ListWidget();
  w.backgroundColor = BG;
  w.setPadding(12, 12, 12, 12);
  w.url = TRIPS_URL;
  w.refreshAfterDate = new Date(Date.now() + 20 * 60 * 1000);

  if (!data) {
    centerMessage(w, "⚠️  Can't reach trips");
    return w;
  }

  // Weather is the one section that needs a second round trip, so it only runs
  // where it's actually drawn.
  const weather = isLarge ? await fetchWeather(await weatherPoints()) : [];

  if (!trips.length && !outstanding.length && !pendingEntries(parcels).length) {
    centerMessage(w, "✈️  No upcoming trips");
    return w;
  }

  if (config.widgetFamily === "small") {
    // Single column: one section above the other, and only what fits
    buildColumn(w, "TRIP COUNTDOWN", trips.slice(0, 3), (c, t) => addTripRow(c, t, true));
    if (trips.length && outstanding.length) w.addSpacer(4);
    buildColumn(w, "TO BOOK", outstanding.slice(0, 2), addBookingRow, outstanding.length - 2);
    w.addSpacer();
    return w;
  }

  addColumns(w, trips, outstanding, isLarge);

  if (!isLarge) {
    w.addSpacer();
    return w;
  }

  if (weather.length) {
    addDivider(w);
    addWeatherSection(w, weather);
  }
  addDivider(w);
  addParcelBand(w, parcels);

  return w;
}

// Trips on the left, bookings on the right. Medium is the same height as small
// but twice as wide, so the sections sit side by side rather than stacking —
// which is what makes room for four trips and three bookings at once.
function addColumns(w, trips, outstanding, isLarge) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.topAlignContent();
  row.url = TRIPS_URL;

  const left = row.addStack();
  left.layoutVertically();
  left.size = new Size(isLarge ? COL_TRIPS_LARGE : COL_TRIPS_MED, 0);
  buildColumn(left, "TRIP COUNTDOWN", trips.slice(0, TRIP_COUNT), (c, t) => addTripRow(c, t, !isLarge));

  row.addSpacer();

  const right = row.addStack();
  right.layoutVertically();
  right.size = new Size(isLarge ? COL_BOOK_LARGE : COL_BOOK_MED, 0);
  const shown = outstanding.slice(0, BOOK_COUNT);
  buildColumn(right, "TO BOOK", shown, addBookingRow, outstanding.length - shown.length);
}

// A labelled section: heading, then one row per entry. `extra` puts an overflow
// count on the heading rather than spending a row on it.
function buildColumn(container, label, entries, addRow, extra = 0) {
  if (!entries.length) return;
  addSectionLabel(container, extra > 0 ? `${label}  ·  +${extra}` : label);
  entries.forEach((entry, i) => {
    if (i) container.addSpacer(4);
    addRow(container, entry);
  });
}

// "🇫🇷 France            13d"
// "   Nov 5 – Nov 8"
//
// The large widget has the height for the trip's dates under its name; medium
// doesn't, and passes `compact` to drop them.
//
// lineLimit on the emoji matters: the field often holds several ("🇩🇰🛳️🇬🇧"), and
// left to wrap they take a second line and squash the name into an ellipsis.
function addTripRow(w, trip, compact) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  // Both flanks get a fixed box, so each row's geometry is settled rather than
  // negotiated: a four-flag cluster and a three-digit countdown would otherwise
  // fight the name for the same width, and the loser gets an ellipsis. Inside
  // its box each one scales down instead.
  const emojiBox = row.addStack();
  emojiBox.size = new Size(EMOJI_W, 0);
  emojiBox.centerAlignContent();
  const emojiTxt = emojiBox.addText(trip.emoji || "✈️");
  emojiTxt.font = Font.systemFont(11);
  emojiTxt.lineLimit = 1;
  emojiTxt.minimumScaleFactor = 0.6;

  row.addSpacer(5);

  const text = row.addStack();
  text.layoutVertically();

  const nameTxt = text.addText(trip.name || "Trip");
  nameTxt.font = Font.boldSystemFont(12);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;
  nameTxt.minimumScaleFactor = 0.7;

  if (!compact && trip.dates) {
    const dateTxt = text.addText(trip.dates);
    dateTxt.font = Font.systemFont(9);
    dateTxt.textColor = MUTED;
    dateTxt.lineLimit = 1;
    dateTxt.minimumScaleFactor = 0.8;
  }

  row.addSpacer();

  const countBox = row.addStack();
  countBox.size = new Size(COUNT_W, 0);
  countBox.layoutHorizontally();
  countBox.addSpacer();   // right-aligns the number against the column edge
  const countTxt = countBox.addText(countdownLabel(trip));
  countTxt.font = Font.boldSystemFont(13);
  countTxt.textColor = TERRACOTTA;
  countTxt.lineLimit = 1;
  countTxt.minimumScaleFactor = 0.8;
}

// "Aspen                ✈️🏨"
// "Jan 5-8"
//
// The dates go under the name rather than beside it: the column is only
// COL_BOOK wide, and a second field on the same line would scale both down to
// where neither reads. The box grows taller to fit, so its vertical padding is
// wider than a name-only row would need, and the icons center against the whole
// block instead of riding the first line.
//
// entry.dates is whatever the travel tracker holds ("8/6/26", "Jan 5-8"), shown
// as-is so the widget and the tracker never disagree.
function addBookingRow(w, entry) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.backgroundColor = SAND;
  row.cornerRadius = 6;
  row.setPadding(4, 6, 4, 6);

  const text = row.addStack();
  text.layoutVertically();

  const nameTxt = text.addText(entry.name || "Trip");
  nameTxt.font = Font.mediumSystemFont(10);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;
  nameTxt.minimumScaleFactor = 0.8;

  if (entry.dates) {
    const dateTxt = text.addText(entry.dates);
    dateTxt.font = Font.systemFont(9);
    dateTxt.textColor = MUTED;
    dateTxt.lineLimit = 1;
    dateTxt.minimumScaleFactor = 0.8;
  }

  row.addSpacer();

  const icons = (entry.missing || []).map(f => BOOKING_ICONS[f] || "•").join("");
  const iconTxt = row.addText(icons);
  iconTxt.font = Font.systemFont(10);
  iconTxt.lineLimit = 1;
}

// The weather strip: one full-width row per city, today on the left and the
// days ahead across the right. Three cities can't hold five days at a readable
// size, so the away layout drops to a tighter row and three.
function addWeatherSection(w, weather) {
  addSectionLabel(w, "WEATHER NOW");
  const tight = weather.length > 2;
  weather.forEach((wx, i) => {
    if (i) w.addSpacer(6);
    if (tight) addCityLine(w, wx);
    else       addCityRow(w, wx);
  });
}

// "🏠 DENVER                TUE   WED   THU   FRI   SAT"
// "☁️ 79°  93°/65°          🌦️    ☁️    ☁️    🌦️   🌦️"
// "                         86/64 87/63 91/68 91/73 94/71"
function addCityRow(w, wx) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.backgroundColor = SAND;
  row.cornerRadius = 10;
  row.setPadding(10, 10, 10, 10);
  row.url = TRIPS_URL;

  const left = row.addStack();
  left.layoutVertically();
  left.size = new Size(ROW_LEFT_W, 0);

  // Sun times ride the label's line rather than taking one of their own: at the
  // tallest this widget gets — three weather rows and a parcel waiting — there
  // are only 28pt of slack left, and a third line in each row would spend all
  // of it. The label was the one line with width going spare.
  const head = left.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();

  const label = head.addText(cityLabel(wx));
  label.font = Font.semiboldSystemFont(10);
  label.textColor = MUTED;
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.7;

  if (wx.sun) {
    head.addSpacer();
    const sun = head.addText(wx.sun);
    sun.font = Font.systemFont(8);
    sun.textColor = MUTED;
    sun.lineLimit = 1;
    sun.minimumScaleFactor = 0.7;
  }

  left.addSpacer(3);

  const now = left.addStack();
  now.layoutHorizontally();
  now.centerAlignContent();

  const icon = now.addText(wx.ok ? wx.sky : "—");
  icon.font = Font.systemFont(18);
  icon.lineLimit = 1;

  if (wx.ok) {
    now.addSpacer(5);
    const temp = now.addText(wx.now + "°");
    temp.font = Font.boldSystemFont(24);
    temp.textColor = INK;
    temp.lineLimit = 1;
    temp.minimumScaleFactor = 0.6;

    now.addSpacer(6);
    const range = now.addText(`${wx.hi}°/${wx.lo}°`);
    range.font = Font.systemFont(10);
    range.textColor = MUTED;
    range.lineLimit = 1;
    range.minimumScaleFactor = 0.7;
  }

  row.addSpacer();

  forecastSlots(wx, FORECAST_DAYS).forEach((d, i) => {
    if (i) row.addSpacer(5);
    const col = row.addStack();
    col.layoutVertically();
    col.size = new Size(DAY_W, 0);

    const dow = col.addText(d ? d.dow : " ");
    dow.font = Font.semiboldSystemFont(9);
    dow.textColor = MUTED;
    dow.lineLimit = 1;
    dow.centerAlignText();
    dow.minimumScaleFactor = 0.7;

    col.addSpacer(2);

    const sky = col.addText(d ? d.sky : "—");
    sky.font = Font.systemFont(13);
    sky.textColor = MUTED;
    sky.lineLimit = 1;
    sky.centerAlignText();

    col.addSpacer(2);

    const temps = col.addText(d ? `${d.hi}/${d.lo}` : " ");
    temps.font = Font.systemFont(9);
    temps.textColor = INK;
    temps.lineLimit = 1;
    temps.centerAlignText();
    temps.minimumScaleFactor = 0.7;
  });
}

// The away row: three cities, so today shrinks onto one line and the forecast
// to three two-line chips.
function addCityLine(w, wx) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.backgroundColor = SAND;
  row.cornerRadius = 8;
  row.setPadding(7, 10, 7, 10);
  row.url = TRIPS_URL;

  const head = row.addStack();
  head.layoutVertically();

  const label = head.addText(cityLabel(wx));
  label.font = Font.semiboldSystemFont(9);
  label.textColor = MUTED;
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.7;

  // Under the label here, not beside it: this row is one line of content and
  // has about 11pt of width to spare, nowhere near enough for a second field.
  if (wx.sun) {
    const sun = head.addText(wx.sun);
    sun.font = Font.systemFont(8);
    sun.textColor = MUTED;
    sun.lineLimit = 1;
    sun.minimumScaleFactor = 0.7;
  }

  row.addSpacer(6);

  const icon = row.addText(wx.ok ? wx.sky : "—");
  icon.font = Font.systemFont(15);
  icon.textColor = MUTED;
  icon.lineLimit = 1;

  if (wx.ok) {
    row.addSpacer(4);
    const temp = row.addText(wx.now + "°");
    temp.font = Font.boldSystemFont(16);
    temp.textColor = INK;
    temp.lineLimit = 1;

    row.addSpacer(5);
    const range = row.addText(`${wx.hi}/${wx.lo}`);
    range.font = Font.systemFont(9);
    range.textColor = MUTED;
    range.lineLimit = 1;
  }

  row.addSpacer();

  forecastSlots(wx, FORECAST_DAYS_TIGHT).forEach((d, i) => {
    if (i) row.addSpacer(6);
    const col = row.addStack();
    col.layoutVertically();
    col.size = new Size(CHIP_W, 0);

    const dow = col.addText(d ? d.dow : " ");
    dow.font = Font.semiboldSystemFont(8);
    dow.textColor = MUTED;
    dow.lineLimit = 1;
    dow.centerAlignText();

    const bottom = col.addStack();
    bottom.layoutHorizontally();
    bottom.centerAlignContent();

    const sky = bottom.addText(d ? d.sky : "—");
    sky.font = Font.systemFont(10);
    sky.textColor = MUTED;
    sky.lineLimit = 1;

    bottom.addSpacer(3);

    const temps = bottom.addText(d ? `${d.hi}/${d.lo}` : " ");
    temps.font = Font.systemFont(9);
    temps.textColor = INK;
    temps.lineLimit = 1;
    temps.minimumScaleFactor = 0.7;
  });
}

// A row whose forecast didn't arrive keeps its columns and fills them with a
// dash. Two rows of different heights read as broken; two rows of equal height
// with a gap in one reads as "that bit didn't load", which is the truth.
function forecastSlots(wx, count) {
  const days = (wx.days || []).slice(0, count);
  while (days.length < count) days.push(null);
  return days;
}

function cityLabel(wx) {
  return wx.emoji ? wx.emoji + " " + wx.label.toUpperCase() : wx.label.toUpperCase();
}

// "📦  1 package waiting        [||| ||| |||]  ›"
//     #79360010
//
// The code moves under the count so the barcode gets the whole right-hand side
// rather than the gap left over after it. At this width it reads at a glance
// and scans at close range; the tap-through menu still shows it full screen,
// which is the size to scan from when the kiosk is being difficult.
function addParcelBand(w, parcels) {
  const pending = pendingEntries(parcels).map(([, p]) => p);
  const total   = pending.reduce((s, p) => s + (p.count || 1), 0);

  const band = w.addStack();
  band.layoutHorizontally();
  band.centerAlignContent();
  band.backgroundColor = SAND;
  band.cornerRadius = 8;
  band.setPadding(8, 10, 8, 10);
  band.url = PARCEL_URL;

  const icon = band.addText("📦");
  icon.font = Font.systemFont(14);
  icon.lineLimit = 1;
  band.addSpacer(8);

  if (!pending.length) {
    const msg = band.addText("All picked up 🎉");
    msg.font = Font.mediumSystemFont(12);
    msg.textColor = MUTED;
    msg.lineLimit = 1;
    band.addSpacer();
    return;
  }

  // Fixed width, so a jump from "1 package" to "12 packages" moves nothing —
  // the barcode beside it keeps the same geometry either way.
  const text = band.addStack();
  text.layoutVertically();
  text.size = new Size(PARCEL_TEXT_W, 0);

  const count = text.addText(`${total} package${total !== 1 ? "s" : ""} waiting`);
  count.font = Font.boldSystemFont(13);
  count.textColor = TERRACOTTA;
  count.lineLimit = 1;
  count.minimumScaleFactor = 0.7;

  const code = String(pending[0].code || "");
  const label = text.addText("#" + code + (pending.length > 1 ? "  ·  +" + (pending.length - 1) + " more" : ""));
  label.font = Font.regularMonospacedSystemFont(9);
  label.textColor = MUTED;
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.7;

  band.addSpacer();

  const img = band.addImage(drawBarcode(barcodeText(code), BARCODE_W, BARCODE_H));
  img.imageSize = new Size(BARCODE_W, BARCODE_H);
  img.containerRelativeShape = false;
  img.cornerRadius = 3;

  band.addSpacer(8);

  const chevron = band.addText("›");
  chevron.font = Font.boldSystemFont(13);
  chevron.textColor = MUTED;
}

// ── Small pieces ──────────────────────────────────────────────────────────────

// "Now" while a trip is under way, otherwise days until departure
function countdownLabel(trip) {
  if (trip.status === "active") return "Now";
  const days = trip.daysUntil ?? 0;
  if (days === 0) return "Today";
  if (days === 1) return "1d";
  return `${days}d`;
}

function addSectionLabel(w, text) {
  const txt = w.addText(text);
  txt.font = Font.boldSystemFont(9);
  txt.textColor = MUTED;
  w.addSpacer(3);
}

// A hairline between sections. The spacer is what makes it visible: an empty
// stack has no content to size itself against, so a fixed height alone draws a
// rule of zero width — which is exactly nothing.
function addDivider(w) {
  w.addSpacer();
  const line = w.addStack();
  line.backgroundColor = DIVIDER;
  line.size = new Size(0, 1);
  line.addSpacer();
  w.addSpacer();
}

function centerMessage(w, text) {
  w.addSpacer();
  const txt = w.addText(text);
  txt.font = Font.mediumSystemFont(13);
  txt.textColor = INK;
  txt.centerAlignText();
  w.addSpacer();
}

// ── CODE128 encoding ──────────────────────────────────────────────────────────
// Copied from parcelpending/scriptable-widget.js — the barcode isn't drawn in
// the widget any more, but the tap-through menu still shows it full screen.

// Bar/space module widths for values 0–105, plus the stop pattern (106).
const CODE128_WIDTHS = [
  "212222","222122","222221","121223","121322","131222","122213","122312",
  "132212","221213","221312","231212","112232","122132","122231","113222",
  "123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321",
  "232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321",
  "331121","312113","312311","332111","314111","221411","431111","111224",
  "111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112",
  "421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412",
  "211214","211232","2331112"
];

function barcodeText(code) {
  return APPEND_NEWLINE ? String(code) + "\n" : String(code);
}

function code128CharValue(ch, mode) {
  const c = ch.charCodeAt(0);
  if (mode === "A") return c < 32 ? c + 64 : c - 32;
  return c - 32; // mode B
}

function code128Values(text) {
  const digitRun = (i) => {
    let n = 0;
    while (i + n < text.length && text[i + n] >= "0" && text[i + n] <= "9") n++;
    return n;
  };

  const values = [];
  let mode, i = 0;
  if (digitRun(0) >= 2) { mode = "C"; values.push(105); }
  else                  { mode = "B"; values.push(104); }

  while (i < text.length) {
    const run = digitRun(i);
    if (mode === "C") {
      if (run >= 2) { values.push(parseInt(text.substr(i, 2), 10)); i += 2; continue; }
      mode = text.charCodeAt(i) < 32 ? "A" : "B";
      values.push(mode === "A" ? 101 : 100);
      continue;
    }
    if (run >= 4) {
      if (run % 2 === 1) { values.push(code128CharValue(text[i], mode)); i++; }
      mode = "C"; values.push(99);
      continue;
    }
    const c = text.charCodeAt(i);
    if (mode === "B" && c < 32) { mode = "A"; values.push(101); continue; }
    if (mode === "A" && c > 95) { mode = "B"; values.push(100); continue; }
    values.push(code128CharValue(text[i], mode));
    i++;
  }

  let sum = values[0];
  for (let k = 1; k < values.length; k++) sum += values[k] * k;
  values.push(sum % 103);
  values.push(106);
  return values;
}

function drawBarcode(text, widthPt, heightPt) {
  const values = code128Values(text);
  let modules = 0;
  for (const v of values) {
    for (const d of CODE128_WIDTHS[v]) modules += +d;
  }
  const quiet = 8; // quiet zone (modules) on each side
  const totalModules = modules + quiet * 2;

  const ctx = new DrawContext();
  ctx.size = new Size(widthPt, heightPt);
  ctx.opaque = true;
  ctx.respectScreenScale = true;
  ctx.setFillColor(Color.white());
  ctx.fillRect(new Rect(0, 0, widthPt, heightPt));

  const mw = widthPt / totalModules;
  const pad = 4;
  let x = quiet * mw;
  ctx.setFillColor(Color.black());
  for (const v of values) {
    const pattern = CODE128_WIDTHS[v];
    for (let j = 0; j < pattern.length; j++) {
      const w = +pattern[j] * mw;
      if (j % 2 === 0) ctx.fillRect(new Rect(x, pad, w, heightPt - pad * 2));
      x += w;
    }
  }
  return ctx.getImage();
}

// Bigger barcode image for full-screen viewing, with the code printed below.
function drawBigBarcode(code) {
  const width = 640, height = 260;
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = true;
  ctx.respectScreenScale = true;
  ctx.setFillColor(Color.white());
  ctx.fillRect(new Rect(0, 0, width, height));
  ctx.drawImageInRect(drawBarcode(barcodeText(code), 600, 190), new Rect(20, 10, 600, 190));
  ctx.setTextColor(Color.black());
  ctx.setFont(Font.regularMonospacedSystemFont(28));
  ctx.setTextAlignedCenter();
  ctx.drawTextInRect("#" + code, new Rect(0, 210, width, 40));
  return ctx.getImage();
}

// ── Interactive menu (runs when the parcel band is tapped) ─────────────────────

async function markPickedUp(key) {
  const req = new Request(PARCEL_DB_ROOT + "/parcels/" + encodeURIComponent(key) + ".json");
  req.method = "PATCH";
  req.headers = { "Content-Type": "application/json" };
  req.body = JSON.stringify({ done: true, doneAt: new Date().toISOString() });
  await req.loadJSON();
}

async function showBarcode(code) {
  await QuickLook.present(drawBigBarcode(code), false);
}

async function runMenu() {
  const parcels = await fetchParcels();
  const pending = pendingEntries(parcels);

  if (pending.length === 0) {
    const a = new Alert();
    a.title = "🎉 All picked up";
    a.message = "No pending parcels.";
    a.addAction("Open web app");
    a.addCancelAction("Done");
    if (await a.presentAlert() === 0) Safari.open(PARCEL_APP_URL);
    return;
  }

  // With several pending codes, pick one first.
  let entry;
  if (pending.length === 1) {
    entry = pending[0];
  } else {
    const a = new Alert();
    a.title = "Pending parcels";
    for (const [, p] of pending) {
      a.addAction("#" + p.code + "  ·  " + (p.count || 1) + " pkg");
    }
    a.addCancelAction("Cancel");
    const idx = await a.presentSheet();
    if (idx < 0) return;
    entry = pending[idx];
  }

  const [key, p] = entry;
  const code = String(p.code || key);
  const a = new Alert();
  a.title = "#" + code;
  a.message = (p.count || 1) + " package" + ((p.count || 1) !== 1 ? "s" : "");
  a.addAction("Show barcode");
  a.addAction("✓ Mark picked up");
  a.addAction("Open web app");
  a.addCancelAction("Cancel");
  const idx = await a.presentSheet();

  if (idx === 0) {
    await showBarcode(code);
  } else if (idx === 1) {
    try {
      await markPickedUp(key);
      const ok = new Alert();
      ok.title = "✓ Picked up";
      ok.message = "#" + code + " marked as picked up.\nThe widget will update on its next refresh.";
      ok.addCancelAction("Done");
      await ok.presentAlert();
    } catch (e) {
      const err = new Alert();
      err.title = "Couldn't update";
      err.message = "Check your connection and try again.";
      err.addCancelAction("OK");
      await err.presentAlert();
    }
  } else if (idx === 2) {
    Safari.open(PARCEL_APP_URL);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
// Last in the file, not first: the barcode tables above are `const`, so running
// the script before those statements execute would leave them in the temporal
// dead zone and the tap-through menu would throw on "Show barcode".
if (config.runsInWidget) {
  Script.setWidget(await buildWidget());
} else {
  await runMenu();
}
Script.complete();
