// Hardin Trips — Upcoming & To Book · Scriptable medium widget
// Shows the next few trips with a day countdown, plus the travel-tracker trips
// that still need flights/hotel/car booked — the same list the app's
// "Outstanding Travel Bookings" popup shows.
//
// Install: paste this into a new Scriptable script, then add a Medium widget to
// your home screen and select this script. A Small widget still works and falls
// back to a single column with fewer rows.
//
// Tapping the widget runs the "Hardin Trips" shortcut, which opens the
// installed PWA. iOS hands any https:// URL to the browser, so going through
// Shortcuts is what keeps the tap out of Safari — the shortcut has to exist on
// the phone under exactly the name in SHORTCUT_NAME.

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER_URL = "https://hardin-trips-ai.erikchardin.workers.dev/widget-upcoming";
const SHORTCUT_NAME = "Hardin Trips";  // must match the shortcut's name exactly
const TRIP_COUNT     = 4;   // upcoming trips to show
const BOOK_COUNT     = 3;   // outstanding-booking rows to show
const BOOKING_MONTHS = 12;  // how far ahead to look for outstanding bookings
                            // the app's popup uses 6; the widget looks further out

// Column widths for the medium layout. A medium widget is about 305pt of usable
// width on a current iPhone; the gap between the columns is flexible, so these
// stay put and the slack goes down the middle.
const COL_TRIPS = 200;
const COL_BOOK  = 115;

// ── Colors ────────────────────────────────────────────────────────────────────
// Cool charcoal: a neutral ground that leaves terracotta as the only warm note.
// Every color the widget draws comes from these five, so the small layout and
// the error/empty messages follow along without knowing about the theme.
//
// Terracotta is lightened from the #c06a3d the app uses — that value goes muddy
// on a dark ground. The pairs that carry text clear WCAG AA against whichever
// surface they sit on: names 14.0 on BG and 11.5 on SAND, countdown 6.5,
// section labels 5.8, booking dates 4.7.
const BG         = new Color("#1b1c1f");
const TERRACOTTA = new Color("#e2895a");
const INK        = new Color("#e8e9ec");
const MUTED      = new Color("#93969c");
// Only 1.2 against BG, which is deliberate: the booking box should read as a
// slightly raised surface, not an outlined card. The light palette it replaces
// separated by the same amount.
const SAND       = new Color("#2a2c30");

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
// A shallow top-to-bottom gradient rather than a flat fill, so the panel has
// some depth against the wallpaper. It runs from a slight lift down to BG
// itself, so the ground still moves with that one constant. The lift is small
// enough that the text at the top of the widget keeps its contrast: names 13.0,
// countdown 6.0, labels 5.3.
const bgGradient = new LinearGradient();
bgGradient.colors    = [new Color("#212328"), BG];
bgGradient.locations = [0, 1];
widget.backgroundGradient = bgGradient;
widget.setPadding(10, 12, 10, 12);
widget.url = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;

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
// "Jan 5-8"
//
// The dates go under the name rather than beside it: the column is only
// COL_BOOK wide, and a second field on the same line would scale both down to
// where neither reads. The box grows taller to fit, so its vertical padding is
// wider than the name-only row it replaced, and the icons center against the
// whole block instead of riding the first line.
//
// entry.dates is whatever the travel tracker holds ("8/6/26", "Jan 5-8"), shown
// as-is so the widget and the tracker never disagree. The worker only sends
// bookings whose dates it could parse, so this is set in practice; the guard is
// for that shape changing upstream.
function addBookingRow(w, entry) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.backgroundColor = SAND;
  row.cornerRadius = 6;
  row.setPadding(4, 6, 4, 6);

  const text = row.addStack();
  text.layoutVertically();

  const nameTxt = text.addText(entry.name || "Trip");
  nameTxt.font = Font.mediumSystemFont(10);
  nameTxt.textColor = INK;
  nameTxt.lineLimit = 1;
  nameTxt.minimumScaleFactor = 0.8;

  if (entry.dates) {
    const dateTxt = text.addText(entry.dates);
    dateTxt.font = Font.systemFont(9);
    dateTxt.textColor = MUTED;
    dateTxt.lineLimit = 1;
    dateTxt.minimumScaleFactor = 0.8;
  }

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
