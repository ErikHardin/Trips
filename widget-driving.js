// Hardin Trips — Driving Overview · Scriptable medium widget
// Fetches trip data + coords from Firebase, routes via OSRM for real drive durations.
// Install: paste into Scriptable, add a Medium widget to your home screen.

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER_URL = "https://hardin-trips-ai.erikchardin.workers.dev/widget-driving";
const FB_URL     = "https://hardin-trips-default-rtdb.firebaseio.com";
// Firebase database secret — find it in Firebase Console → Project Settings →
// Service accounts → Database secrets. Required for drive duration computation.
const FB_SECRET  = "";

// ── Colors ────────────────────────────────────────────────────────────────────
const BG         = new Color("#e8ddd0");
const TERRACOTTA = new Color("#c06a3d");
const INK        = new Color("#2a2520");
const MUTED      = new Color("#8a7f76");

// ── Curated coords (mirrors KNOWN_COORDS in index.html) ──────────────────────
const KNOWN_COORDS = {
  'lyon':[45.75,4.85],'luberon':[43.83,5.38],'burgundy':[47.05,4.85],
  'alsace':[48.32,7.44],'champagne':[49.26,4.03],'paris':[48.85,2.35],
  'loire valley':[47.35,0.68],'amboise':[47.41,0.98],
  'bandol':[43.13,5.75],'cannes':[43.55,7.01],'cassis':[43.21,5.54],
  'marseille':[43.30,5.37],'aix-en-provence':[43.53,5.45],
  'gordes':[43.91,5.20],'roussillon':[43.90,5.29],'bonnieux':[43.84,5.31],
  'lourmarin':[43.76,5.36],'apt':[43.88,5.40],'menerbes':[43.84,5.21],
  'oppede':[43.84,5.17],'lake como':[45.98,9.27],'portofino':[44.30,9.21],
  'milan':[45.46,9.19],'piedmont':[44.70,8.00],'london':[51.51,-0.13],
  'berlin':[52.52,13.4],'cape town':[-33.93,18.42],'dubai':[25.20,55.27],
  'singapore':[1.35,103.82],'sydney':[-33.87,151.21],'new york':[40.71,-74.01],
  'franschhoek':[-33.91,19.12],'stellenbosch':[-33.93,18.86],
  'cape town':[-33.93,18.42],'hluhluwe':[-28.02,32.27],'durban':[-29.86,31.02],
  'maldives':[3.20,73.22],'washington dc':[38.91,-77.04],
  'chiang mai':[18.79,98.98],'bangkok':[13.75,100.50],'hoi an':[15.88,108.34],
  'queenstown':[-45.03,168.66],'porto':[41.16,-8.62],'lisbon':[38.72,-9.14],
  'douro valley':[41.16,-7.75],'melbourne':[-37.81,144.96],'hobart':[-42.88,147.33],
};

// ── Fetch worker data + Firebase trips in parallel ────────────────────────────
const authParam = FB_SECRET ? '?auth=' + FB_SECRET : '';
const [workerData, fbTrips] = await Promise.all([
  new Request(WORKER_URL).loadJSON().catch(() => null),
  new Request(FB_URL + '/trips.json' + authParam).loadJSON().catch(() => null),
]);

// ── Compute per-day total drive durations via OSRM ───────────────────────────
const driveDurations = {}; // { [dateISO]: "Xh Ym" }

if (workerData?.trip && fbTrips) {
  const fbTrip = findActiveTrip(fbTrips);
  if (fbTrip?.days) {
    const sortedDays = Object.values(fbTrip.days)
      .map(d => ({ d, iso: d.dateISO || '' }))
      .filter(x => x.iso)
      .sort((a, b) => a.iso.localeCompare(b.iso));

    const driveDayISOs = (workerData.days || [])
      .filter(d => d.drives.length > 0)
      .map(d => d.dateISO);

    await Promise.all(driveDayISOs.map(async iso => {
      const idx = sortedDays.findIndex(x => x.iso === iso);
      if (idx < 0) return;

      const day  = sortedDays[idx].d;
      const prev = idx > 0 ? sortedDays[idx - 1].d : null;

      const acts = day.activities
        ? (Array.isArray(day.activities) ? day.activities : Object.values(day.activities))
        : [];

      // Waypoints: prev city → pinned drive activity coords → current city
      const pts = [];
      const start = cityCoord(prev);
      if (start) pts.push(start);
      for (const a of acts) {
        if (a?.drive && a.coords?.lat != null)
          pts.push([a.coords.lat, a.coords.lng]);
      }
      const end = cityCoord(day);
      if (end) pts.push(end);

      // Drop adjacent duplicates
      const deduped = pts.filter((p, i) =>
        !i || !(p[0] === pts[i-1][0] && p[1] === pts[i-1][1])
      );
      if (deduped.length < 2) return;

      const secs = await osrmSeconds(deduped);
      if (secs > 600) driveDurations[iso] = fmtSecs(secs);
    }));
  }
}

// ── Build widget ──────────────────────────────────────────────────────────────
const widget = new ListWidget();
widget.backgroundColor = BG;
widget.setPadding(10, 14, 10, 14);

if (!workerData?.trip) {
  const t = widget.addText("🚗  No active trip");
  t.font = Font.mediumSystemFont(15);
  t.textColor = INK;
} else {
  buildDrivingWidget(widget, workerData, driveDurations);
}

Script.setWidget(widget);
Script.complete();

// ── Drive days list ───────────────────────────────────────────────────────────
function buildDrivingWidget(w, { trip, days }, driveDurations) {
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
    if (rowCount >= 7) break;
    const isToday = day.dateISO === todayISO;
    const dayDur  = driveDurations[day.dateISO];

    for (let i = 0; i < day.drives.length; i++) {
      if (rowCount >= 7) break;
      const drive = day.drives[i];

      const row = w.addStack();
      row.layoutHorizontally();
      row.centerAlignContent();

      // Date label — only on first drive of the day
      const dateTxt = row.addText(i === 0 ? day.dateLabel : "");
      dateTxt.font = isToday ? Font.boldSystemFont(11) : Font.systemFont(11);
      dateTxt.textColor = isToday ? TERRACOTTA : MUTED;
      dateTxt.minimumScaleFactor = 1.0;

      row.addSpacer(10);

      const driveTxt = row.addText(drive.text || "Drive");
      driveTxt.font = Font.systemFont(11);
      driveTxt.textColor = INK;
      driveTxt.lineLimit = 1;

      // First drive of day: total OSRM duration (or fall back to scheduled time)
      // Subsequent drives: scheduled time
      const rightLabel = (i === 0 && dayDur) ? dayDur : (drive.time || "");
      if (rightLabel) {
        row.addSpacer();
        const rt = row.addText(rightLabel);
        rt.font = Font.boldSystemFont(10);
        rt.textColor = TERRACOTTA;
        rt.lineLimit = 1;
      }

      w.addSpacer(4);
      rowCount++;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findActiveTrip(trips) {
  const all = Object.values(trips);
  return all.find(t => t.status === 'active')
    || all.filter(t => t.status === 'upcoming' && t.startDateISO)
         .sort((a, b) => a.startDateISO.localeCompare(b.startDateISO))[0]
    || null;
}

// Look up [lat, lng] for a day's region/city using KNOWN_COORDS
function cityCoord(day) {
  if (!day) return null;
  const name = (day.region || day.city || '').split(/[·,]/)[0].trim().toLowerCase();
  if (!name) return null;
  for (const [k, v] of Object.entries(KNOWN_COORDS)) {
    if (name === k || name.includes(k) || k.includes(name)) return v;
  }
  return null;
}

// Call OSRM and return total route seconds (0 on failure)
async function osrmSeconds(pts) {
  const coords = pts.map(p => p[1] + ',' + p[0]).join(';'); // OSRM wants lon,lat
  try {
    const r = await new Request(
      'https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=false'
    ).loadJSON();
    return r.routes?.[0] ? Math.round(r.routes[0].duration) : 0;
  } catch(e) { return 0; }
}

function fmtSecs(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h === 0) return m + 'm';
  if (m === 0) return h + 'h';
  return h + 'h ' + m + 'm';
}
