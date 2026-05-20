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

  if (driveDays.length === 0) {
    const t = w.addText("No upcoming drives");
    t.font = Font.systemFont(12);
    t.textColor = MUTED;
    return;
  }

  // Flatten all drives across days into individual rows; date shown only on
  // the first drive of each day.
  let rowCount = 0;
  for (const day of driveDays) {
    if (rowCount >= 7) break;
    const isToday = day.dateISO === todayISO;

    for (let i = 0; i < day.drives.length; i++) {
      if (rowCount >= 7) break;
      const drive = day.drives[i];
      const row = w.addStack();
      row.layoutHorizontally();
      row.centerAlignContent();

      // Date label only on the first drive of the day
      const dateStr = i === 0 ? day.dateLabel : "";
      const dateTxt = row.addText(dateStr);
      dateTxt.font = isToday ? Font.boldSystemFont(11) : Font.systemFont(11);
      dateTxt.textColor = isToday ? TERRACOTTA : MUTED;
      dateTxt.minimumScaleFactor = 1.0;

      row.addSpacer(10);

      // Drive description
      const driveTxt = row.addText(drive.text || "Drive");
      driveTxt.font = Font.systemFont(11);
      driveTxt.textColor = INK;
      driveTxt.lineLimit = 1;

      // Time right-aligned
      if (drive.time) {
        row.addSpacer();
        const timeTxt = row.addText(drive.time);
        timeTxt.font = Font.boldSystemFont(10);
        timeTxt.textColor = TERRACOTTA;
        timeTxt.lineLimit = 1;
      }

      w.addSpacer(4);
      rowCount++;
    }
  }
}
