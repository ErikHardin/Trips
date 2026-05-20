// Hardin Trips — Driving Overview · Scriptable medium widget
// Shows each day of the active trip with its drive activities and times.
// Install: paste into a new Scriptable script, add a Medium widget to your
// home screen, and select this script.

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER_URL = "https://hardin-trips-ai.erikchardin.workers.dev/widget-driving";

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
widget.setPadding(10, 14, 10, 14);

if (!data || !data.trip) {
  const t = widget.addText("🚗  No active trip");
  t.font = Font.mediumSystemFont(15);
  t.textColor = INK;
} else {
  buildDrivingWidget(widget, data);
}

Script.setWidget(widget);
Script.complete();

// ── Driving overview by day ───────────────────────────────────────────────────
function buildDrivingWidget(w, { trip, days }) {
  const todayISO = new Date().toISOString().slice(0, 10);

  // Header: emoji + trip name
  const hdr = w.addStack();
  hdr.layoutHorizontally();
  hdr.centerAlignContent();

  const emojiTxt = hdr.addText(trip.emoji || "✈️");
  emojiTxt.font = Font.systemFont(16);

  hdr.addSpacer(6);

  const nameTxt = hdr.addText(trip.name);
  nameTxt.font = Font.boldSystemFont(13);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;

  w.addSpacer(6);

  // For active trips show from today onward; for upcoming show all days
  let visible = trip.status === "active"
    ? days.filter(d => d.dateISO >= todayISO)
    : days;
  visible = visible.slice(0, 5);

  if (visible.length === 0) {
    const t = w.addText("Trip complete");
    t.font = Font.systemFont(12);
    t.textColor = MUTED;
    return;
  }

  for (const day of visible) {
    const isToday = day.dateISO === todayISO;
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();

    // Date label
    const dateTxt = row.addText(day.dateLabel);
    dateTxt.font = isToday ? Font.boldSystemFont(11) : Font.systemFont(11);
    dateTxt.textColor = isToday ? TERRACOTTA : MUTED;
    dateTxt.lineLimit = 1;

    row.addSpacer(10);

    if (day.drives.length > 0) {
      const drive = day.drives[0];

      const contentRow = row.addStack();
      contentRow.layoutHorizontally();
      contentRow.centerAlignContent();

      const driveTxt = contentRow.addText("🚗  " + (drive.text || "Drive"));
      driveTxt.font = Font.systemFont(11);
      driveTxt.textColor = INK;
      driveTxt.lineLimit = 1;

      if (drive.time) {
        contentRow.addSpacer(6);
        const timeTxt = contentRow.addText(drive.time);
        timeTxt.font = Font.systemFont(10);
        timeTxt.textColor = TERRACOTTA;
        timeTxt.lineLimit = 1;
      }
    } else {
      // No drive activity — show the day's city/location dimmed
      const cityTxt = row.addText(cleanCity(day.city) || "—");
      cityTxt.font = Font.systemFont(11);
      cityTxt.textColor = MUTED;
      cityTxt.lineLimit = 1;
    }

    w.addSpacer(4);
  }
}

function cleanCity(str) {
  if (!str) return "";
  // Strip leading emoji characters
  return str.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\s]+/gu, "").trim();
}
