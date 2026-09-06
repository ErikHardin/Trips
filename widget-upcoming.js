// Hardin Trips — Upcoming & To Book · Scriptable medium widget
// Shows the next few trips with a day countdown, plus the travel-tracker trips
// that still need flights/hotel/car booked — the same list the app's
// "Outstanding Travel Bookings" popup shows.
//
// Install: paste this into a new Scriptable script, then add a Medium widget to
// your home screen and select this script. A Small widget still works and falls
// back to a single column with fewer rows.

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER_URL = "https://hardin-trips-ai.erikchardin.workers.dev/widget-upcoming";
const APP_URL    = "https://erikhardin.github.io/Trips/";
const TRIP_COUNT     = 4;   // upcoming trips to show
const BOOK_COUNT     = 3;   // outstanding-booking rows to show
const BOOKING_MONTHS = 6;   // how far ahead to look for outstanding bookings
                            // 6 matches the app's Outstanding Travel Bookings popup

// Column widths for the medium layout. A medium widget is about 305pt of usable
// width on a current iPhone; the gap between the columns is flexible, so these
// stay put and the slack goes down the middle.
const COL_TRIPS = 178;
const COL_BOOK  = 115;

// ── Colors ────────────────────────────────────────────────────────────────────
const BG         = new Color("#e8ddd0");
const TERRACOTTA = new Color("#c06a3d");
const INK        = new Color("#2a2520");
const MUTED      = new Color("#8a7f76");
const SAND       = new Color("#d9cbb8");

const BOOKING_ICONS = { flights: "✈️", hotel: "🏨", car: "🚗" };

// ── Fetch data ────────────────────────────────────────────────────────────────
let data = null;
try {
  data = await new Request(`${WORKER_URL}?limit=${TRIP_COUNT}&months=${BOOKING_MONTHS}`).loadJSON();
} catch (e) {
  data = null;
}

// ── Build widget ──────────────────────────────────────────────────────────────
const widget = new ListWidget();
widget.backgroundColor = BG;
widget.setPadding(10, 12, 10, 12);
widget.url = APP_URL;

const trips       = data?.trips || [];
const outstanding = data?.outstanding || [];

if (!data || data.error) {
  // A worker/Firebase error returns JSON too — don't mistake it for an empty calendar
  centerMessage(widget, "⚠️  Can't reach trips");
} else if (!trips.length && !outstanding.length) {
  centerMessage(widget, "✈️  No upcoming trips");
} else if (config.widgetFamily === "small") {
  // Single column: one section above the other, and only what fits
  buildColumn(widget, "TRIP COUNTDOWN", trips.slice(0, 3), addTripRow);
  if (trips.length && outstanding.length) widget.addSpacer(4);
  buildColumn(widget, "TO BOOK", outstanding.slice(0, 2), addBookingRow, outstanding.length - 2);
  widget.addSpacer();
} else {
  // Medium is the same height as small but twice as wide, so the two sections
  // sit side by side instead of stacking — which is what makes room for four
  // trips and three bookings at once.
  const row = widget.addStack();
  row.layoutHorizontally();
  row.topAlignContent();

  const left = row.addStack();
  left.layoutVertically();
  left.size = new Size(COL_TRIPS, 0);
  buildColumn(left, "TRIP COUNTDOWN", trips.slice(0, TRIP_COUNT), addTripRow);
  left.addSpacer();

  row.addSpacer();

  const right = row.addStack();
  right.layoutVertically();
  right.size = new Size(COL_BOOK, 0);
  const shown = outstanding.slice(0, BOOK_COUNT);
  buildColumn(right, "TO BOOK", shown, addBookingRow, outstanding.length - shown.length);
  right.addSpacer();
}

widget.addSpacer();

Script.setWidget(widget);
Script.complete();

// ── Columns and rows ──────────────────────────────────────────────────────────

// A labelled section: heading, then one row per entry. `extra` puts an overflow
// count on the heading rather than spending a row on it.
function buildColumn(container, label, entries, addRow, extra = 0) {
  if (!entries.length) return;
  addSectionLabel(container, extra > 0 ? `${label}  ·  +${extra}` : label);
  entries.forEach((entry, i) => {
    if (i) container.addSpacer(2);
    addRow(container, entry);
  });
}

// ── Rows ──────────────────────────────────────────────────────────────────────

// "🇫🇷 France            13d"
//
// lineLimit on the emoji matters: the field often holds several ("🇩🇰🛳️🇬🇧"), and
// left to wrap they take a second line and squash the name into an ellipsis.
function addTripRow(w, trip) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const emojiTxt = row.addText(trip.emoji || "✈️");
  emojiTxt.font = Font.systemFont(11);
  emojiTxt.lineLimit = 1;

  row.addSpacer(4);

  const nameTxt = row.addText(trip.name || "Trip");
  nameTxt.font = Font.boldSystemFont(12);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;
  nameTxt.minimumScaleFactor = 0.7;

  row.addSpacer();

  const countTxt = row.addText(countdownLabel(trip));
  countTxt.font = Font.boldSystemFont(12);
  countTxt.textColor = TERRACOTTA;
  countTxt.lineLimit = 1;
}

// "Aspen                ✈️🏨"
function addBookingRow(w, entry) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.backgroundColor = SAND;
  row.cornerRadius = 6;
  row.setPadding(2, 6, 2, 6);

  const nameTxt = row.addText(entry.name || "Trip");
  nameTxt.font = Font.mediumSystemFont(10);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;
  nameTxt.minimumScaleFactor = 0.8;

  row.addSpacer();

  const icons = (entry.missing || []).map(f => BOOKING_ICONS[f] || "•").join("");
  const iconTxt = row.addText(icons);
  iconTxt.font = Font.systemFont(10);
  iconTxt.lineLimit = 1;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function centerMessage(w, text) {
  w.addSpacer();
  const txt = w.addText(text);
  txt.font = Font.mediumSystemFont(13);
  txt.textColor = INK;
  txt.centerAlignText();
}
