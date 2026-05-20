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

// ── Build widget ──────────────────────────────────────────────────────────────
const widget = new ListWidget();
widget.backgroundColor = BG;
widget.setPadding(24, 14, 18, 14);

if (!data || !data.trip) {
  const t = widget.addText("✈️  No upcoming trips");
  t.font = Font.mediumSystemFont(15);
  t.textColor = INK;
} else if (data.trip.status === "upcoming") {
  buildCountdownWidget(widget, data.trip);
} else {
  buildItineraryWidget(widget, data);
}

Script.setWidget(widget);
Script.complete();

// ── Pre-trip: full-width header, flights, countdown bottom-right ──────────────
function buildCountdownWidget(w, trip) {
  // Full-width header: emoji + name
  const hdr = w.addStack();
  hdr.layoutHorizontally();
  hdr.centerAlignContent();

  hdr.addSpacer();

  const emojiTxt = hdr.addText(trip.emoji || "✈️");
  emojiTxt.font = Font.systemFont(18);

  hdr.addSpacer(7);

  const nameTxt = hdr.addText(trip.name);
  nameTxt.font = Font.boldSystemFont(14);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;

  hdr.addSpacer();

  w.addSpacer(10);

  // Flights directly under header
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

  // Flexible spacer — countdown floats to bottom, top padding pushes content down
  w.addSpacer();

  // Countdown number — bottom right
  const days = trip.daysUntil ?? 0;

  const numRow = w.addStack();
  numRow.layoutHorizontally();
  numRow.addSpacer();
  const numTxt = numRow.addText(String(days));
  numTxt.font = Font.boldSystemFont(28);
  numTxt.textColor = TERRACOTTA;
  numRow.addSpacer(22);

  const labelRow = w.addStack();
  labelRow.layoutHorizontally();
  labelRow.addSpacer();
  const labelTxt = labelRow.addText(days === 1 ? "day until" : "days until");
  labelTxt.font = Font.systemFont(11);
  labelTxt.textColor = MUTED;
  labelRow.addSpacer(22);
}

// ── Active trip: today's location + activities ────────────────────────────────
function buildItineraryWidget(w, { trip, today }) {
  const now     = new Date();
  const nowSort = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

  const allActs = today?.activities || [];
  const nextIdx  = allActs.findIndex(a => a.timeSort >= nowSort);
  const next     = nextIdx >= 0 ? allActs[nextIdx] : (allActs.length ? allActs[allActs.length - 1] : null);
  const upcoming = nextIdx >= 0 ? allActs.slice(nextIdx + 1, nextIdx + 3) : [];

  if (next?.location) {
    const q = encodeURIComponent(next.location);
    w.url = NAV_APP === "waze"
      ? `https://waze.com/ul?q=${q}&navigate=yes`
      : `https://maps.google.com/?q=${q}`;
  }

  // Header: emoji + name + status
  const hdr = w.addStack();
  hdr.layoutHorizontally();
  hdr.centerAlignContent();

  const emojiTxt = hdr.addText(trip.emoji || "✈️");
  emojiTxt.font = Font.systemFont(20);

  hdr.addSpacer(7);

  const nameCol = hdr.addStack();
  nameCol.layoutVertically();

  const nameTxt = nameCol.addText(trip.name);
  nameTxt.font = Font.boldSystemFont(14);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;

  const sLabel = statusLabel(trip);
  if (sLabel) {
    const sTxt = nameCol.addText(sLabel);
    sTxt.font = Font.systemFont(10);
    sTxt.textColor = TERRACOTTA;
  }

  w.addSpacer(5);

  // Today's location
  if (today?.description) {
    const locTxt = w.addText("📍  " + today.description);
    locTxt.font = Font.mediumSystemFont(11);
    locTxt.textColor = MUTED;
    locTxt.lineLimit = 1;
    w.addSpacer(4);
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

    w.addSpacer(4);
  }

  // Remaining activities (up to 2 for medium)
  for (const act of upcoming) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();

    const txt = row.addText(act.time + "   " + (act.emoji || "📌") + "  " + act.text);
    txt.font = Font.systemFont(11);
    txt.textColor = MUTED;
    txt.lineLimit = 1;

    w.addSpacer(3);
  }
}

function statusLabel(trip) {
  if (trip.status === "active") return "🟢  In Progress";
  if (trip.daysUntil == null)   return "";
  if (trip.daysUntil === 0)     return "Departs today!";
  if (trip.daysUntil === 1)     return "Departs tomorrow";
  return trip.daysUntil + " days away";
}
