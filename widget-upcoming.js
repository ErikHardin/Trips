// Hardin Trips — Upcoming & To Book · Scriptable small (square) widget
// Shows the next few trips with a day countdown, plus the travel-tracker trips
// that still need flights/hotel/car booked — the same list the app's
// "Outstanding Travel Bookings" popup shows.
//
// Install: paste this into a new Scriptable script, then add a Small widget to
// your home screen and select this script.

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER_URL = "https://hardin-trips-ai.erikchardin.workers.dev/widget-upcoming";
const APP_URL    = "https://erikhardin.github.io/Trips/";
const TRIP_COUNT = 3;   // upcoming trips to show
const BOOK_COUNT = 2;   // outstanding-booking rows to show (grows when fewer trips)

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
  data = await new Request(`${WORKER_URL}?limit=${TRIP_COUNT}`).loadJSON();
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
} else {
  // No header on the trip list — an emoji and a day count read as a trip on
  // sight, and the smallest small widget (141pt) has no room for a spare label
  trips.slice(0, TRIP_COUNT).forEach((trip, i) => {
    if (i) widget.addSpacer(2);
    addTripRow(widget, trip);
  });

  if (outstanding.length) {
    // A short trip list frees up rows for bookings, keeping the widget evenly filled
    const bookRows = Math.max(1, BOOK_COUNT + (TRIP_COUNT - trips.length));
    const shown = outstanding.slice(0, bookRows);
    const extra = outstanding.length - shown.length;

    widget.addSpacer(trips.length ? 6 : 0);
    // The overflow count rides on the section label rather than its own row —
    // a small widget has no height to spare
    addSectionLabel(widget, extra > 0 ? `TO BOOK  ·  +${extra}` : "TO BOOK");
    shown.forEach((entry, i) => {
      if (i) widget.addSpacer(2);
      addBookingRow(widget, entry);
    });
  }
}

widget.addSpacer();

Script.setWidget(widget);
Script.complete();

// ── Rows ──────────────────────────────────────────────────────────────────────

// "🇫🇷  France          13d"
function addTripRow(w, trip) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const emojiTxt = row.addText(trip.emoji || "✈️");
  emojiTxt.font = Font.systemFont(11);

  row.addSpacer(5);

  const nameTxt = row.addText(trip.name || "Trip");
  nameTxt.font = Font.boldSystemFont(11);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;
  nameTxt.minimumScaleFactor = 0.8;

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
  w.addSpacer(4);
}

function centerMessage(w, text) {
  w.addSpacer();
  const txt = w.addText(text);
  txt.font = Font.mediumSystemFont(13);
  txt.textColor = INK;
  txt.centerAlignText();
}
