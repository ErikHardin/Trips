// Hardin Trips — Scriptable home screen widget
// Install: paste this into a new Scriptable script, then add a Medium widget
// to your home screen and select this script.

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER_URL    = "https://hardin-trips-ai.erikchardin.workers.dev/widget-data";
const FIREBASE_URL  = "https://hardin-trips-default-rtdb.firebaseio.com";
const NAV_APP       = "google";        // "google" or "waze"
const DEST_TIMEZONE = "Europe/Paris";  // IANA timezone of destination
const DEST_CITY     = "Lyon";          // display name shown next to the time

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

// Pre-fetch tomorrow's data so the widget can roll over once today's last activity ends
const tomorrowISO = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
let tomorrowData = null;
try {
  const td = await new Request(WORKER_URL + "?date=" + tomorrowISO).loadJSON();
  tomorrowData = td?.today ?? null;
  if (tomorrowData) tomorrowData.dateISO = tomorrowISO;
} catch (e) {
  tomorrowData = null;
}

// Fetch weather for today's and tomorrow's city in parallel
let weather = null;
let tomorrowWeather = null;
[weather, tomorrowWeather] = await Promise.all([
  data?.today?.city       ? fetchWeather(data.today.city)         : Promise.resolve(null),
  tomorrowData?.description ? fetchWeather(tomorrowData.description) : Promise.resolve(null),
]);

// Fetch spend total directly from Firebase
let spendAmt = null;
if (data?.trip) {
  spendAmt = await fetchSpend();
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
  buildItineraryWidget(widget, { ...data, tomorrow: tomorrowData });
} else if (data.trip.status === "upcoming") {
  buildCountdownWidget(widget, data.trip);
} else {
  buildItineraryWidget(widget, { ...data, tomorrow: tomorrowData });
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

  // Destination local time
  if (DEST_TIMEZONE) {
    const destTime = new Date().toLocaleTimeString("en-US", {
      timeZone: DEST_TIMEZONE, hour: "numeric", minute: "2-digit", hour12: true
    });
    w.addSpacer(4);
    const dtTxt = w.addText("🕐  " + (DEST_CITY ? DEST_CITY + "  " : "") + destTime);
    dtTxt.font = Font.systemFont(11);
    dtTxt.textColor = MUTED;
  }
}

// ── Active trip: today's location + activities ────────────────────────────────
function buildItineraryWidget(w, { trip, today, tomorrow }) {
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

  // Once all of today's activities have passed, roll over to tomorrow after 30 min
  let showTomorrow = false;
  if (nextIdx >= allActs.length) {
    const lastAct = allActs[allActs.length - 1];
    if (lastAct?.timeSort && tomorrow?.activities?.length) {
      if (nowSort >= addMinsToSort(lastAct.timeSort, 30)) showTomorrow = true;
    }
    nextIdx = allActs.length - 1;
  }

  const acts = showTomorrow ? tomorrow.activities : allActs;
  const idx  = showTomorrow ? 0 : nextIdx;
  const next     = acts[idx] || null;
  const upcoming = next ? acts.slice(idx + 1, idx + 5) : [];

  if (next?.location) {
    const q = encodeURIComponent(next.location);
    w.url = NAV_APP === "waze"
      ? `https://waze.com/ul?q=${q}&navigate=yes`
      : `https://maps.google.com/?q=${q}`;
  }

  // Header: emoji + name + spend (right)
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

  if (spendAmt) {
    hdr.addSpacer();
    const spendTxt = hdr.addText("💰 " + spendAmt);
    spendTxt.font = Font.systemFont(11);
    spendTxt.textColor = MUTED;
  }

  w.addSpacer(3);

  // Location row — show tomorrow's city when rolled over
  const locDesc = showTomorrow ? tomorrow?.description : today?.description;
  if (locDesc) {
    const locRow = w.addStack();
    locRow.layoutHorizontally();
    locRow.centerAlignContent();
    const locTxt = locRow.addText("📍  " + locDesc);
    locTxt.font = Font.mediumSystemFont(11);
    locTxt.textColor = MUTED;
    locTxt.lineLimit = 1;
    const wx = showTomorrow ? tomorrowWeather : weather;
    if (wx) {
      locRow.addSpacer();
      const wxTxt = locRow.addText(wx.emoji + " " + wx.hi + "°/" + wx.lo + "°");
      wxTxt.font = Font.systemFont(11);
      wxTxt.textColor = MUTED;
    }
    w.addSpacer(3);
  }

  // Date label when showing tomorrow's activities
  if (showTomorrow && tomorrow?.dateISO) {
    const d = new Date(tomorrow.dateISO + 'T12:00:00Z');
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const dateRow = w.addStack();
    const dateTxt = dateRow.addText("Tomorrow  ·  " + label);
    dateTxt.font = Font.mediumSystemFont(10);
    dateTxt.textColor = MUTED;
    w.addSpacer(2);
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

// Add minutes to a "HH:MM" sort string
function addMinsToSort(timeSort, mins) {
  const [h, m] = timeSort.split(':').map(Number);
  const total = h * 60 + m + mins;
  return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
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

// Fetch trip spend total directly from Firebase and convert to USD
async function fetchSpend() {
  const CURRENCY_CODE_MAP = { '€':'EUR','$':'USD','£':'GBP','¥':'JPY','₩':'KRW','A$':'AUD','C$':'CAD','CHF':'CHF','kr':'SEK','zł':'PLN','₺':'TRY','₹':'INR','R':'ZAR' };
  try {
    const trips = await new Request(FIREBASE_URL + "/trips.json").loadJSON();
    if (!trips) return null;
    const entries = Object.values(trips);
    let chosen = entries.find(t => t.status === 'active');
    if (!chosen) {
      chosen = entries
        .filter(t => t.status === 'upcoming' && t.startDateISO)
        .sort((a, b) => a.startDateISO.localeCompare(b.startDateISO))[0] || null;
    }
    if (!chosen?.days) return null;
    const tracked = Object.values(chosen.days).filter(d => d.dailySpend != null);
    if (!tracked.length) return null;
    const currency = chosen.currency || '';
    const total = tracked.reduce((s, d) => s + (Number(d.dailySpend) || 0), 0);
    if (currency === '$' || currency === 'USD') return "$" + Math.round(total).toLocaleString();
    const code = CURRENCY_CODE_MAP[currency];
    if (code) {
      const rateResp = await new Request('https://open.er-api.com/v6/latest/USD').loadJSON();
      const rate = rateResp?.rates?.[code];
      if (rate) return "$" + Math.round(total / rate).toLocaleString();
    }
    return (currency || '') + total.toLocaleString();
  } catch (e) {
    return null;
  }
}
