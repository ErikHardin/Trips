// Hardin Trips — TEST widget simulating May 28, 2026 at 9:00am (active trip day)
// Paste into Scriptable as a separate script to preview the in-trip itinerary view.

// ── Config ────────────────────────────────────────────────────────────────────
const NAV_APP = "google"; // "google" or "waze"

// ── Colors ────────────────────────────────────────────────────────────────────
const BG         = new Color("#e8ddd0");
const TERRACOTTA = new Color("#c06a3d");
const INK        = new Color("#2a2520");
const MUTED      = new Color("#8a7f76");
const SAND       = new Color("#d9cbb8");

// ── Simulated data — May 28, 2026, 9:00am ────────────────────────────────────
const data = {
  trip: {
    name:   "France 2026",
    emoji:  "🇫🇷🍷🌸",
    status: "active",
  },
  today: {
    city:        "Lyon",
    description: "Lyon",
    activities: [
      { time: "8:00am",  timeSort: "08:00", emoji: "☕", text: "Breakfast at hotel",           location: "Breakfast at hotel, Lyon" },
      { time: "9:30am",  timeSort: "09:30", emoji: "🚗", text: "Drive to Beaune",              location: "Beaune, France" },
      { time: "11:00am", timeSort: "11:00", emoji: "🍷", text: "Wine tasting at Bouchard",     location: "Bouchard Père et Fils, Beaune" },
      { time: "1:00pm",  timeSort: "13:00", emoji: "🍽️", text: "Lunch in Beaune",             location: "Beaune, France" },
      { time: "3:00pm",  timeSort: "15:00", emoji: "🏰", text: "Visit Hospices de Beaune",     location: "Hospices de Beaune, Beaune" },
      { time: "5:30pm",  timeSort: "17:30", emoji: "🚗", text: "Drive back to Lyon",           location: "Lyon, France" },
      { time: "7:30pm",  timeSort: "19:30", emoji: "🍽️", text: "Dinner at Paul Bocuse",       location: "Auberge du Pont de Collonges, Lyon" },
    ],
  },
};

// Simulated current time: 9:00am
const SIMULATED_NOW = "09:00";

// ── Build widget ──────────────────────────────────────────────────────────────
const widget = new ListWidget();
widget.backgroundColor = BG;
widget.setPadding(12, 14, 14, 14);

buildItineraryWidget(widget, data);

Script.setWidget(widget);
Script.complete();

// ── Active trip: today's location + activities ────────────────────────────────
function buildItineraryWidget(w, { trip, today }) {
  const nowSort = SIMULATED_NOW;

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

  const sTxt = nameCol.addText("🟢  In Progress");
  sTxt.font = Font.systemFont(10);
  sTxt.textColor = TERRACOTTA;

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

  // Remaining activities (up to 2)
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
