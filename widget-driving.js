// Hardin Trips — Driving Overview · Scriptable medium widget
// Shows only days with drives, with computed duration per drive.
// Install: paste into a new Scriptable script, add a Medium widget to your
// home screen, and select this script.

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER_URL = "https://hardin-trips-ai.erikchardin.workers.dev/widget-driving";

// ── Colors ────────────────────────────────────────────────────────────────────
const BG         = new Color("#e8ddd0");
const TERRACOTTA = new Color("#c06a3d");
const INK        = new Color("#2a2520");
const MUTED      = new Color("#8a7f76");

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

// ── Drive days list ───────────────────────────────────────────────────────────
function buildDrivingWidget(w, { trip, days }) {
  const todayISO = new Date().toISOString().slice(0, 10);

  // Title
  const titleTxt = w.addText("Drive Times 🚗");
  titleTxt.font = Font.boldSystemFont(13);
  titleTxt.textColor = INK;

  w.addSpacer(7);

  // Only days that have at least one drive activity
  let driveDays = days.filter(d => d.drives.length > 0);
  if (trip.status === "active") {
    driveDays = driveDays.filter(d => d.dateISO >= todayISO);
  }
  driveDays = driveDays.slice(0, 7);

  if (driveDays.length === 0) {
    const t = w.addText("No upcoming drives");
    t.font = Font.systemFont(12);
    t.textColor = MUTED;
    return;
  }

  for (const day of driveDays) {
    const isToday = day.dateISO === todayISO;
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();

    // Date label — terracotta if today
    const dateTxt = row.addText(day.dateLabel);
    dateTxt.font = isToday ? Font.boldSystemFont(11) : Font.systemFont(11);
    dateTxt.textColor = isToday ? TERRACOTTA : MUTED;
    dateTxt.lineLimit = 1;

    row.addSpacer(10);

    // Drive description
    const drive = day.drives[0];
    const driveTxt = row.addText(drive.text || "Drive");
    driveTxt.font = Font.systemFont(11);
    driveTxt.textColor = INK;
    driveTxt.lineLimit = 1;

    // Duration right-aligned
    const dur = toDuration(drive.time);
    if (dur) {
      row.addSpacer();
      const durTxt = row.addText(dur);
      durTxt.font = Font.boldSystemFont(11);
      durTxt.textColor = TERRACOTTA;
      durTxt.lineLimit = 1;
    }

    w.addSpacer(4);
  }
}

// Convert a time string to a duration string.
// "10:00am–11:30am" → "1h 30m"   "9am–12pm" → "3h"   "45 min" → "45m"
function toDuration(time) {
  if (!time) return "";
  const t = String(time).trim();

  // Already formatted as duration
  if (/^\d+h(\s*\d+m)?$/.test(t) || /^\d+m(in)?$/.test(t)) return t.replace("min", "m");

  // Range like "10:00am–11:30am" or "9am-12:30pm"
  const rng = t.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)[\s–\-]+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (!rng) return "";

  const toMin = s => {
    const m = String(s).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2] || "0", 10);
    const ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && h !== 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return h * 60 + min;
  };

  let start = toMin(rng[1]);
  let end   = toMin(rng[2]);
  if (start === null || end === null) return "";
  if (end < start) end += 12 * 60;
  const diff = end - start;
  if (diff <= 0) return "";

  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h === 0) return m + "m";
  if (m === 0) return h + "h";
  return h + "h " + m + "m";
}
