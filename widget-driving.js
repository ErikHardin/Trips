// Hardin Trips — Driving Overview · Scriptable medium widget
// Install: paste into Scriptable, add a Medium widget to your home screen.

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
} catch(e) {}

// ── Build widget ──────────────────────────────────────────────────────────────
const widget = new ListWidget();
widget.backgroundColor = BG;
widget.setPadding(10, 14, 10, 14);

if (!data?.trip) {
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

  const titleTxt = w.addText("Drive Times 🚗");
  titleTxt.font = Font.boldSystemFont(13);
  titleTxt.textColor = INK;
  w.addSpacer(7);

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

  let rowCount = 0;
  for (const day of driveDays) {
    if (rowCount >= 8) break;
    const isToday = day.dateISO === todayISO;

    // Day header: "Thu 28 - Total Drive   2h 30m"
    const hdr = w.addStack();
    hdr.layoutHorizontally();
    hdr.centerAlignContent();

    const dateTxt = hdr.addText(day.dateLabel + " - Total Drive");
    dateTxt.font = Font.boldSystemFont(11);
    dateTxt.textColor = isToday ? TERRACOTTA : INK;
    dateTxt.lineLimit = 1;

    if (day.totalDrive) {
      hdr.addSpacer();
      const totalTxt = hdr.addText(day.totalDrive);
      totalTxt.font = Font.boldSystemFont(11);
      totalTxt.textColor = TERRACOTTA;
      totalTxt.lineLimit = 1;
    }

    w.addSpacer(3);
    rowCount++;

    // Activity rows
    for (let i = 0; i < day.drives.length; i++) {
      if (rowCount >= 8) break;
      const drive = day.drives[i];

      const row = w.addStack();
      row.layoutHorizontally();
      row.centerAlignContent();
      row.addSpacer(14);

      const driveTxt = row.addText(drive.text || "Drive");
      driveTxt.font = Font.systemFont(11);
      driveTxt.textColor = MUTED;
      driveTxt.lineLimit = 1;

      const legDur = day.legTimes?.[i];
      if (legDur) {
        row.addSpacer();
        const legTxt = row.addText(legDur);
        legTxt.font = Font.boldSystemFont(10);
        legTxt.textColor = TERRACOTTA;
        legTxt.lineLimit = 1;
      }

      w.addSpacer(3);
      rowCount++;
    }

    w.addSpacer(2);
  }
}
