// Hardin Trips — Scriptable home screen widget
// Install: paste this into a new Scriptable script, then add a Medium widget
// to your home screen and select this script.

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER_URL = "https://hardin-trips-ai.erikchardin.workers.dev/widget-data";
const NAV_APP    = "google"; // "google" or "waze"

// ── Colors ────────────────────────────────────────────────────────────────────
const BG         = new Color("#e8ddd0");
const TERRACOTTA = new Color("#c06a3d");
const INK        = new Color("#2a2520");
const MUTED      = new Color("#8a7f76");
const SAND       = new Color("#d9cbb8");

// ── Fetch data ────────────────────────────────────────────────────────────────
let data = null;
try {
  data = await new Request(WORKER_URL).loadJSON();
} catch (e) {
  data = null;
}

// Fetch weather for today's city (Open-Meteo, free, no API key)
let weather = null;
if (data?.today?.city) {
  weather = await fetchWeather(data.today.city);
}

// ── Build widget ──────────────────────────────────────────────────────────────
const widget = new ListWidget();
widget.backgroundColor = BG;
widget.setPadding(8, 14, 10, 14);

if (!data || !data.trip) {
  const t = widget.addText("✈️  No upcoming trips");
  t.font = Font.mediumSystemFont(15);
  t.textColor = INK;
} else if (data.trip.status === "upcoming" && isPastDeparture(data.trip)) {
  buildItineraryWidget(widget, data);
} else if (data.trip.status === "upcoming") {
  buildCountdownWidget(widget, data.trip);
} else {
  buildItineraryWidget(widget, data);
}

Script.setWidget(widget);
Script.complete();

// ── Pre-trip: header row with countdown top-right, flights below ──────────────
function buildCountdownWidget(w, trip) {
  const days = trip.daysUntil ?? 0;

  // On departure day, show hours/minutes until first flight instead of "0 days"
  let countNum, countLabel;
  if (days === 0) {
    const dep = parseFirstDepTime(trip.flightOut);
    if (dep) {
      const now = new Date();
      const flightDate = new Date();
      flightDate.setHours(dep.h, dep.min, 0, 0);
      const diffMs = flightDate - now;
      if (diffMs > 3600000) {
        const hrs  = Math.floor(diffMs / 3600000);
        const mins = Math.floor((diffMs % 3600000) / 60000);
        countNum   = String(hrs);
        countLabel = `hr${hrs !== 1 ? "s" : ""} ${mins}m until`;
      } else {
        countNum   = "✈️";
        countLabel = "Bon voyage!";
      }
    } else {
      countNum   = "🛫";
      countLabel = "Departs today!";
    }
  } else {
    countNum   = String(days);
    countLabel = days === 1 ? "day until" : "days until";
  }

  // Top row: emoji + name on left, countdown on right
  const topRow = w.addStack();
  topRow.layoutHorizontally();
  topRow.centerAlignContent();

  const emojiTxt = topRow.addText(trip.emoji || "✈️");
  emojiTxt.font = Font.systemFont(18);

  topRow.addSpacer(7);

  const nameTxt = topRow.addText(trip.name);
  nameTxt.font = Font.boldSystemFont(14);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;

  topRow.addSpacer();

  // Countdown column — right side of header row
  const countCol = topRow.addStack();
  countCol.layoutVertically();

  const numTxt = countCol.addText(countNum);
  numTxt.font = Font.boldSystemFont(28);
  numTxt.textColor = TERRACOTTA;

  const labelTxt = countCol.addText(countLabel);
  labelTxt.font = Font.systemFont(10);
  labelTxt.textColor = MUTED;

  w.addSpacer(10);

  // Flights below the header row
  if (trip.flightOut) {
    const fhdr = w.addStack();
    const ftitle = fhdr.addText("✈️  Outbound" + (trip.flightOutDate ? "  ·  " + trip.flightOutDate : ""));
    ftitle.font = Font.boldSystemFont(10);
    ftitle.textColor = MUTED;

    w.addSpacer(3);

    for (const leg of trip.flightOut.split("\n").filter(Boolean)) {
      const row = w.addStack();
      row.layoutHorizontally();
      row.backgroundColor = SAND;
      row.cornerRadius = 7;
      row.setPadding(4, 8, 4, 8);
      row.centerAlignContent();

      const spaceIdx = leg.indexOf(" ");
      const code   = spaceIdx > -1 ? leg.slice(0, spaceIdx) : leg;
      const detail = spaceIdx > -1 ? leg.slice(spaceIdx + 1) : "";

      const codeTxt = row.addText(code);
      codeTxt.font = Font.boldSystemFont(11);
      codeTxt.textColor = TERRACOTTA;

      if (detail) {
        row.addSpacer(5);
        const detTxt = row.addText(detail);
        detTxt.font = Font.systemFont(11);
        detTxt.textColor = INK;
        detTxt.lineLimit = 1;
      }

      w.addSpacer(3);
    }
  }
}

// ── Active trip: today's location + activities ────────────────────────────────
function buildItineraryWidget(w, { trip, today }) {
  const now     = new Date();
  const nowSort = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

  const allActs = today?.activities || [];

  // Anchor on the last timed activity that has already passed; everything
  // after it is still ahead. Timeless activities are never "passed", so they
  // stay visible until a later timed activity pushes the anchor forward.
  let nextIdx = 0;
  for (let i = 0; i < allActs.length; i++) {
    if (allActs[i].timeSort && allActs[i].timeSort < nowSort) nextIdx = i + 1;
  }
  if (nextIdx >= allActs.length) nextIdx = allActs.length - 1;
  const next     = allActs[nextIdx] || null;
  const upcoming = next ? allActs.slice(nextIdx + 1, nextIdx + 5) : [];

  if (next?.location) {
    const q = encodeURIComponent(next.location);
    w.url = NAV_APP === "waze"
      ? `https://waze.com/ul?q=${q}&navigate=yes`
      : `https://maps.google.com/?q=${q}`;
  }

  // Header: emoji + name
  const hdr = w.addStack();
  hdr.layoutHorizontally();
  hdr.centerAlignContent();

  const emojiTxt = hdr.addText(trip.emoji || "✈️");
  emojiTxt.font = Font.systemFont(20);

  hdr.addSpacer(7);

  const nameTxt = hdr.addText(trip.name);
  nameTxt.font = Font.boldSystemFont(14);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;

  w.addSpacer(3);

  // Today's location + weather
  if (today?.description) {
    const locRow = w.addStack();
    locRow.layoutHorizontally();
    locRow.centerAlignContent();
    const locTxt = locRow.addText("📍  " + today.description);
    locTxt.font = Font.mediumSystemFont(11);
    locTxt.textColor = MUTED;
    locTxt.lineLimit = 1;
    if (weather) {
      locRow.addSpacer();
      const wxTxt = locRow.addText(weather.emoji + " " + weather.hi + "°/" + weather.lo + "°");
      wxTxt.font = Font.systemFont(11);
      wxTxt.textColor = MUTED;
    }
    w.addSpacer(3);
  }

  // Next activity — highlighted
  if (next) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.backgroundColor = SAND;
    row.cornerRadius = 8;
    row.setPadding(6, 10, 6, 10);
    row.centerAlignContent();

    const timeTxt = row.addText(next.time || "");
    timeTxt.font = Font.boldSystemFont(11);
    timeTxt.textColor = TERRACOTTA;
    timeTxt.lineLimit = 1;

    row.addSpacer(5);

    const actTxt = row.addText((next.emoji || "📌") + "  " + next.text);
    actTxt.font = Font.mediumSystemFont(12);
    actTxt.textColor = INK;
    actTxt.lineLimit = 1;

    row.addSpacer();

    const arrow = row.addText("→");
    arrow.font = Font.boldSystemFont(12);
    arrow.textColor = TERRACOTTA;

    w.addSpacer(3);
  }

  // Remaining activities (up to 4)
  for (const act of upcoming) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();

    const txt = row.addText(act.time + "   " + (act.emoji || "📌") + "  " + act.text);
    txt.font = Font.systemFont(11);
    txt.textColor = MUTED;
    txt.lineLimit = 1;

    w.addSpacer(2);
  }
}

// True when it's departure day and we're more than 1 hour past the first flight time
function isPastDeparture(trip) {
  if ((trip.daysUntil ?? 1) !== 0) return false;
  const dep = parseFirstDepTime(trip.flightOut);
  if (!dep) return false;
  const flightDate = new Date();
  flightDate.setHours(dep.h, dep.min, 0, 0);
  return (new Date() - flightDate) > 3600000;
}

// Parse the first departure time from a flightOut string like "UA27 DEN → LHR · 5:35pm – 9:40am"
function parseFirstDepTime(flightOut) {
  if (!flightOut) return null;
  const m = flightOut.match(/·\s*(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  const ampm = m[3].toLowerCase();
  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return { h, min };
}

// Geocode city → fetch today's high/low + WMO weather code from Open-Meteo
async function fetchWeather(city) {
  try {
    const geoResp = await new Request(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
    ).loadJSON();
    const loc = geoResp.results?.[0];
    if (!loc) return null;
    const wxResp = await new Request(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`
    ).loadJSON();
    const code = wxResp.daily?.weathercode?.[0];
    const hi   = Math.round(wxResp.daily?.temperature_2m_max?.[0]);
    const lo   = Math.round(wxResp.daily?.temperature_2m_min?.[0]);
    if (code == null || isNaN(hi) || isNaN(lo)) return null;
    return { emoji: wxEmoji(code), hi, lo };
  } catch (e) {
    return null;
  }
}

function wxEmoji(code) {
  if (code === 0)  return "☀️";
  if (code <= 2)   return "⛅";
  if (code === 3)  return "☁️";
  if (code <= 49)  return "🌫️";
  if (code <= 57)  return "🌦️";
  if (code <= 67)  return "🌧️";
  if (code <= 77)  return "❄️";
  if (code <= 82)  return "🌧️";
  if (code <= 86)  return "🌨️";
  return "⛈️";
}
