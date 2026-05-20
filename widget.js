// Hardin Trips — Scriptable home screen widget
// Install: paste this into a new Scriptable script, then add a Large widget
// to your home screen and select this script.

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER_URL = "https://hardin-trips-ai.erikchardin.workers.dev/widget-data";
const NAV_APP    = "google"; // "google" or "waze"

// ── Colors ────────────────────────────────────────────────────────────────────
const BG         = new Color("#faf8f4");
const TERRACOTTA = new Color("#c06a3d");
const INK        = new Color("#2a2520");
const MUTED      = new Color("#8a7f76");
const SAND       = new Color("#ede5d8");

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
widget.setPadding(12, 14, 12, 14);

if (!data || !data.trip) {
  const t = widget.addText("✈️  No upcoming trips");
  t.font = Font.mediumSystemFont(16);
  t.textColor = INK;
} else if (data.trip.status === "upcoming") {
  buildCountdownWidget(widget, data.trip);
} else {
  buildItineraryWidget(widget, data);
}

Script.setWidget(widget);
Script.complete();

// ── Pre-trip: countdown + outbound flights ────────────────────────────────────
function buildCountdownWidget(w, trip) {
  // ── Header: emoji + name ──────────────────────────────────────────────────
  const hdr = w.addStack();
  hdr.layoutHorizontally();
  hdr.centerAlignContent();

  const emojiTxt = hdr.addText(trip.emoji || "✈️");
  emojiTxt.font = Font.systemFont(26);

  hdr.addSpacer(10);

  const nameTxt = hdr.addText(trip.name);
  nameTxt.font = Font.boldSystemFont(15);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;

  w.addSpacer(8);

  // ── Countdown number ──────────────────────────────────────────────────────
  const days = trip.daysUntil ?? 0;
  const countStack = w.addStack();
  countStack.layoutHorizontally();
  countStack.centerAlignContent();
  countStack.addSpacer();

  const numCol = countStack.addStack();
  numCol.layoutVertically();
  numCol.centerAlignContent();

  const numTxt = numCol.addText(String(days));
  numTxt.font = Font.boldSystemFont(38);
  numTxt.textColor = TERRACOTTA;

  const labelTxt = numCol.addText(days === 1 ? "day until departure" : "days until departure");
  labelTxt.font = Font.systemFont(11);
  labelTxt.textColor = MUTED;

  countStack.addSpacer();

  w.addSpacer(8);

  // ── Outbound flights ──────────────────────────────────────────────────────
  if (trip.flightOut) {
    const flightHeader = w.addStack();
    flightHeader.layoutHorizontally();
    flightHeader.centerAlignContent();

    const ftitle = flightHeader.addText("✈️  Outbound" + (trip.flightOutDate ? "  ·  " + trip.flightOutDate : ""));
    ftitle.font = Font.boldSystemFont(11);
    ftitle.textColor = MUTED;

    w.addSpacer(4);

    for (const leg of trip.flightOut.split("\n").filter(Boolean)) {
      const row = w.addStack();
      row.layoutHorizontally();
      row.backgroundColor = SAND;
      row.cornerRadius = 8;
      row.setPadding(5, 8, 5, 8);
      row.centerAlignContent();

      // Bold flight code, then rest of string
      const spaceIdx = leg.indexOf(" ");
      const code = spaceIdx > -1 ? leg.slice(0, spaceIdx) : leg;
      const detail = spaceIdx > -1 ? leg.slice(spaceIdx + 1) : "";

      const codeTxt = row.addText(code);
      codeTxt.font = Font.boldSystemFont(12);
      codeTxt.textColor = TERRACOTTA;

      if (detail) {
        row.addSpacer(6);
        const detTxt = row.addText(detail);
        detTxt.font = Font.systemFont(12);
        detTxt.textColor = INK;
        detTxt.lineLimit = 1;
      }

      w.addSpacer(3);
    }
  }
}

// ── Active trip: today's location + activities ────────────────────────────────
function buildItineraryWidget(w, { trip, today }) {
  // Use device local time to pick "next" activity
  const now = new Date();
  const nowSort = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

  const allActs = today?.activities || [];
  const nextIdx  = allActs.findIndex(a => a.timeSort >= nowSort);
  const next     = nextIdx >= 0 ? allActs[nextIdx] : (allActs.length ? allActs[allActs.length - 1] : null);
  const upcoming = nextIdx >= 0 ? allActs.slice(nextIdx + 1, nextIdx + 4) : [];

  // Tapping the widget opens directions to the next activity
  if (next?.location) {
    const q = encodeURIComponent(next.location);
    w.url = NAV_APP === "waze"
      ? `https://waze.com/ul?q=${q}&navigate=yes`
      : `https://maps.google.com/?q=${q}`;
  }

  // ── Header: emoji  name  status ───────────────────────────────────────────
  const hdr = w.addStack();
  hdr.layoutHorizontally();
  hdr.centerAlignContent();

  const emojiTxt = hdr.addText(trip.emoji || "✈️");
  emojiTxt.font = Font.systemFont(26);

  hdr.addSpacer(10);

  const nameCol = hdr.addStack();
  nameCol.layoutVertically();

  const nameTxt = nameCol.addText(trip.name);
  nameTxt.font = Font.boldSystemFont(15);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;

  const sLabel = statusLabel(trip);
  if (sLabel) {
    const sTxt = nameCol.addText(sLabel);
    sTxt.font = Font.systemFont(11);
    sTxt.textColor = TERRACOTTA;
  }

  w.addSpacer(10);

  // ── Today's location ───────────────────────────────────────────────────────
  if (today?.description) {
    const locTxt = w.addText("📍  " + today.description);
    locTxt.font = Font.mediumSystemFont(12);
    locTxt.textColor = MUTED;
    locTxt.lineLimit = 1;
    w.addSpacer(8);
  }

  // ── Next activity (highlighted row) ───────────────────────────────────────
  if (next) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.backgroundColor = SAND;
    row.cornerRadius = 10;
    row.setPadding(8, 10, 8, 10);
    row.centerAlignContent();

    const timeTxt = row.addText(next.time || "");
    timeTxt.font = Font.boldSystemFont(12);
    timeTxt.textColor = TERRACOTTA;
    timeTxt.lineLimit = 1;

    row.addSpacer(6);

    const actTxt = row.addText((next.emoji || "📌") + "  " + next.text);
    actTxt.font = Font.mediumSystemFont(13);
    actTxt.textColor = INK;
    actTxt.lineLimit = 1;

    row.addSpacer();

    const arrow = row.addText("→");
    arrow.font = Font.boldSystemFont(14);
    arrow.textColor = TERRACOTTA;

    w.addSpacer(6);
  }

  // ── Remaining activities (up to 3) ────────────────────────────────────────
  for (const act of upcoming) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();

    const txt = row.addText(act.time + "   " + (act.emoji || "📌") + "  " + act.text);
    txt.font = Font.systemFont(12);
    txt.textColor = MUTED;
    txt.lineLimit = 1;

    w.addSpacer(4);
  }
}

function statusLabel(trip) {
  if (trip.status === "active") return "🟢  In Progress";
  if (trip.daysUntil == null)   return "";
  if (trip.daysUntil === 0)     return "Departs today!";
  if (trip.daysUntil === 1)     return "Departs tomorrow";
  return trip.daysUntil + " days away";
}
