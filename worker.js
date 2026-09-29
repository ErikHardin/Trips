export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST'
      }});
    }

    const url = new URL(request.url);

    // Widget data — GET endpoint for Scriptable home screen widget
    if (url.pathname === '/widget-data') {
      return handleWidgetData(env, request);
    }

    // Upcoming widget — next few trips with countdowns + outstanding travel bookings
    if (url.pathname === '/widget-upcoming') {
      return handleWidgetUpcoming(env, request);
    }

    // Deployed-build probe — GET, so it can be checked from a browser or curl.
    // Answers "is the Worker in Cloudflare current?" without reading its source.
    if (url.pathname === '/version') {
      return handleVersion(env);
    }

    // Everything below is a JSON POST. A GET to an unrouted path used to reach
    // request.json() and throw, surfacing as an opaque Cloudflare 1101 rather
    // than "no such route" — which made a stale deploy and a real bug look alike.
    const CORS_JSON = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Not found', path: url.pathname, routes: WORKER_ROUTES }), {
        status: 404, headers: CORS_JSON
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Expected a JSON body' }), { status: 400, headers: CORS_JSON });
    }

    // PIN verification
    if (url.pathname === '/verify-pin') {
      let user = null;
      if (body.pin === env.ADMIN_PIN)        user = 'Erik';
      else if (body.pin === env.ADMIN_PIN_2) user = 'Megan';
      const valid = user !== null;
      return new Response(JSON.stringify({ valid, user: valid ? user : null }), { headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }});
    }

    // Flight lookup — AeroDataBox via RapidAPI
    // Requires AERODATABOX_KEY set as a Worker secret in Cloudflare dashboard
    if (url.pathname === '/flight-lookup') {
      const { flightNumber, date } = body;
      if (!flightNumber || !date) {
        return new Response(JSON.stringify({ error: 'Missing flightNumber or date' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      const resp = await fetch(
        `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${date}`,
        { headers: { 'X-RapidAPI-Key': env.AERODATABOX_KEY, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' } }
      );
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: 'Flight not found' }), {
          status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      const flights = await resp.json();
      const f = Array.isArray(flights) ? flights[0] : flights;
      if (!f) {
        return new Response(JSON.stringify({ error: 'No data' }), {
          status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      const fmt12 = t => {
        if (!t) return '';
        // API may return "2026-06-07 09:50+01:00" — extract first HH:MM match
        const match = String(t).match(/(\d{1,2}):(\d{2})/);
        if (!match) return '';
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        if (isNaN(h) || isNaN(m)) return '';
        return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
      };
      const dep  = f.departure?.airport?.iata || '';
      const arr  = f.arrival?.airport?.iata   || '';
      const depT = fmt12(f.departure?.scheduledTime?.local);
      const arrT = fmt12(f.arrival?.scheduledTime?.local);
      const formatted = `${flightNumber.toUpperCase()} ${dep} → ${arr}${depT && arrT ? ' · ' + depT + ' – ' + arrT : ''}`;
      return new Response(JSON.stringify({ formatted, departure: dep, arrival: arr }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Return ntfy config so the browser can call ntfy.sh directly (avoids Cloudflare IP rate limits)
    if (url.pathname === '/ntfy-config') {
      if (!env.NTFY_TOPIC) {
        return new Response(JSON.stringify({ ok: false, error: 'NTFY_TOPIC not configured' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      return new Response(JSON.stringify({ ok: true, topic: env.NTFY_TOPIC, token: env.NTFY_TOKEN || null }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Parse pasted booking text — the same parser the email handler uses. It
    // only parses: the app is signed in and writes the result to bookingInbox
    // itself, so this route can't be used to put anything in the database.
    if (url.pathname === '/booking-parse') {
      const text = String(body.text || '').slice(0, BOOKING_TEXT_LIMIT);
      if (!text.trim()) {
        return new Response(JSON.stringify({ error: 'Missing text' }), { status: 400, headers: CORS_JSON });
      }
      try {
        const parsed = await parseBookingText(env, String(body.subject || ''), text);
        return new Response(JSON.stringify(parsed), { headers: CORS_JSON });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Parse failed: ' + e.message }), { status: 502, headers: CORS_JSON });
      }
    }

    // AI proxy (unchanged)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    return new Response(JSON.stringify(data), { headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }});
  },

  // Inbound mail from Cloudflare Email Routing (see DEPLOY.md). A forwarded
  // flight, hotel or rental-car confirmation is parsed and queued under
  // bookingInbox/ for the app to assign to a trip.
  async email(message, env, ctx) {
    return handleInboundEmail(message, env);
  }
}

async function handleWidgetData(env, request) {
  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const dateParam = new URL(request.url).searchParams.get('date');

  if (!env.FIREBASE_URL) {
    return new Response(JSON.stringify({ error: 'FIREBASE_URL not configured' }), { status: 500, headers: CORS });
  }

  const fbUrl = env.FIREBASE_URL + '/trips.json' + (env.FIREBASE_SECRET ? '?auth=' + env.FIREBASE_SECRET : '');
  let trips;
  try {
    const resp = await fetch(fbUrl);
    if (!resp.ok) throw new Error('status ' + resp.status);
    trips = await resp.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Firebase fetch failed: ' + e.message }), { status: 502, headers: CORS });
  }

  if (!trips) {
    return new Response(JSON.stringify({ trip: null, today: null }), { headers: CORS });
  }

  const todayISO = (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam))
    ? dateParam
    : new Date().toISOString().slice(0, 10);

  // Active trip takes priority; otherwise pick the soonest upcoming trip
  const entries = Object.values(trips);
  let chosen = entries.find(t => t.status === 'active');
  if (!chosen) {
    const upcoming = entries
      .filter(t => t.status === 'upcoming' && t.startDateISO)
      .sort((a, b) => a.startDateISO.localeCompare(b.startDateISO));
    chosen = upcoming[0] || null;
  }

  if (!chosen) {
    return new Response(JSON.stringify({ trip: null, today: null }), { headers: CORS });
  }

  let daysUntil = null;
  if (chosen.startDateISO) {
    const msPerDay = 86400000;
    daysUntil = Math.max(0, Math.ceil((new Date(chosen.startDateISO + 'T00:00:00Z') - Date.now()) / msPerDay));
  }

  const tripInfo = {
    name:          chosen.name || '',
    emoji:         chosen.emoji || '✈️',
    status:        chosen.status,
    startDateISO:  chosen.startDateISO || null,
    daysUntil,
    flightOut:     chosen.flightOut     || null,
    flightOutDate: chosen.flightOutDate || null,
  };

  // Find today's day and build sorted activity list
  let todayData = null;
  if (chosen.days) {
    const dayEntry = Object.values(chosen.days).find(d => {
      if (d.dateISO) return d.dateISO === todayISO;
      return dayDateISO(d, chosen.year) === todayISO;
    });
    if (dayEntry) {
      const rawActs = dayEntry.activities
        ? (Array.isArray(dayEntry.activities) ? dayEntry.activities : Object.values(dayEntry.activities))
        : [];

      const city = dayEntry.description || dayEntry.city || '';
      const activities = rawActs
        .filter(a => a && (a.text || a.description))
        .map(a => ({
          time:     a.time || '',
          timeSort: parseTimeTo24h(a.time || ''),
          emoji:    a.emoji || '📌',
          text:     a.text || a.description || '',
          location: [(a.text || a.description || ''), city].filter(Boolean).join(', '),
        }));

      todayData = {
        city:        dayEntry.city || '',
        description: city,
        activities,
      };
    }
  }

  return new Response(JSON.stringify({ trip: tripInfo, today: todayData }), { headers: CORS });
}

async function handleWidgetUpcoming(env, request) {
  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (!env.FIREBASE_URL) {
    return new Response(JSON.stringify({ error: 'FIREBASE_URL not configured' }), { status: 500, headers: CORS });
  }

  const params = new URL(request.url).searchParams;
  const limitParam = parseInt(params.get('limit'), 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 10) : 3;
  // How far ahead to look for outstanding bookings. 6 months matches the app's
  // "Outstanding Travel Bookings" popup; the widget can ask for a wider window.
  const monthsParam = parseInt(params.get('months'), 10);
  const months = Number.isFinite(monthsParam) && monthsParam > 0 ? Math.min(monthsParam, 36) : 6;

  const auth = env.FIREBASE_SECRET ? '?auth=' + env.FIREBASE_SECRET : '';
  let trips, tracker, access;
  try {
    [trips, tracker, access] = await Promise.all([
      wFetchJson(env.FIREBASE_URL + '/trips.json'         + auth),
      wFetchJson(env.FIREBASE_URL + '/travelTracker.json' + auth),
      wFetchJson(env.FIREBASE_URL + '/access.json'        + auth),
    ]);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Firebase fetch failed: ' + e.message }), { status: 502, headers: CORS });
  }

  const now      = new Date();
  const todayMs  = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayISO = new Date(todayMs).toISOString().slice(0, 10);

  // Trips owned by a role:'user' account belong to that person, not the family
  // pool. Mirrors groupTripsByUserOwner() in the app: no ownerId, or an admin
  // owner, means the trip is shared and belongs on the widget.
  const userOwnerEmails = new Set();
  Object.values(access || {}).forEach(u => {
    if (u && u.role === 'user' && u.email) userOwnerEmails.add(u.email);
  });

  // Trips still ahead of (or currently under way) — soonest first
  const upcoming = Object.values(trips || {})
    .filter(t => t && (t.status === 'upcoming' || t.status === 'active'))
    .filter(t => !(t.ownerId && userOwnerEmails.has(t.ownerId)))
    .map(t => ({ t, startISO: wTripStartISO(t), endISO: wTripEndISO(t) }))
    .filter(x => x.startISO)
    // A trip whose last day has passed is over whatever its status still says.
    // Statuses are set by hand and go stale once a trip ends.
    .filter(x => x.endISO >= todayISO)
    .sort((a, b) => a.startISO.localeCompare(b.startISO))
    .slice(0, limit)
    .map(({ t, startISO, endISO }) => ({
      name:         t.name || 'Untitled trip',
      emoji:        t.emoji || '✈️',
      status:       t.status,
      dates:        t.dates || '',
      startDateISO: startISO,
      endDateISO:   endISO,
      daysUntil:    Math.max(0, Math.round((Date.parse(startISO + 'T00:00:00Z') - todayMs) / 86400000)),
      weatherCity:  wTripWeatherCity(t),
      lat:          null,
      lon:          null,
    }));

  // Where each trip is going, as coordinates. The dashboard widget shows the
  // weather there, and it can't work this out for itself: the trips node needs
  // auth to read, so the day cities it would need aren't reachable from a
  // widget. Resolved per trip and never fatal — a trip whose city doesn't
  // geocode comes back with nulls and the widget drops that tile.
  await Promise.all(upcoming.map(async trip => {
    if (!trip.weatherCity) return;
    const coords = await wCityCoords(trip.weatherCity, env);
    if (coords) { trip.lat = coords.lat; trip.lon = coords.lon; }
  }));

  // Travel-tracker trips departing in the next 6 months that still need a booking.
  // Mirrors computeOutstandingBookings() in the app so the widget and the
  // "Outstanding Travel Bookings" popup always agree.
  const windowEndMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate());
  const pending = [];
  Object.keys(tracker || {}).forEach(yStr => {
    const year = parseInt(yStr, 10);
    if (isNaN(year)) return;
    const yearTrips = (tracker[yStr] && tracker[yStr].trips) || {};
    Object.values(yearTrips).forEach(t => {
      if (!t) return;
      const dk = wParseTripDateSort(t.dates);
      if (dk.m === 99) return; // TBD or unparseable — can't place it in the window
      const tripMs = Date.UTC(year, dk.m, dk.d);
      if (tripMs < todayMs || tripMs > windowEndMs) return;
      const missing = W_BOOKING_FIELDS.filter(f => {
        const v = t[f] || '';
        return v !== 'booked' && v !== 'na';
      });
      if (missing.length) pending.push({ tripMs, name: t.name || 'Untitled trip', dates: t.dates || '', missing });
    });
  });
  pending.sort((a, b) => a.tripMs - b.tripMs);

  return new Response(JSON.stringify({
    todayISO,
    bookingWindowMonths: months,
    trips: upcoming,
    outstanding: pending.map(({ name, dates, missing }) => ({ name, dates, missing })),
  }), { headers: CORS });
}

// Bump this whenever worker.js changes, so a deployed build can be identified
// from outside Cloudflare. GET /version reports it alongside the routes this
// build serves — if the list is missing a route you expect, the deployed Worker
// is stale and needs re-pasting.
const WORKER_VERSION = '2026-09-30.1';

// Presence of these is reported by /version. Names only, never values — and
// they are already visible in this file, so nothing is disclosed by listing them.
const WORKER_ENV_KEYS = [
  'ANTHROPIC_KEY',
  'FIREBASE_URL',
  'FIREBASE_SECRET',
  'AERODATABOX_KEY',
  'NTFY_TOPIC',
  'NTFY_TOKEN',
  'ADMIN_PIN',
  'ADMIN_PIN_2',
];

const WORKER_ROUTES = [
  '/version',
  '/widget-data',
  '/widget-upcoming',
  '/verify-pin',
  '/flight-lookup',
  '/ntfy-config',
  '/booking-parse',
];

async function handleVersion(env) {
  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // A shallow read is the cheapest call that still exercises the Firebase
  // credential, so a revoked secret shows up here instead of as empty widgets
  const firebase = {
    urlConfigured:    !!env.FIREBASE_URL,
    secretConfigured: !!env.FIREBASE_SECRET,
    status:           null,
    ok:               false,
  };
  if (env.FIREBASE_URL) {
    try {
      const auth = env.FIREBASE_SECRET ? '&auth=' + env.FIREBASE_SECRET : '';
      const r = await fetch(env.FIREBASE_URL + '/trips.json?shallow=true' + auth);
      firebase.status = r.status;
      firebase.ok     = r.ok;
    } catch (e) {
      firebase.error = e.message;
    }
  }

  const configured = {};
  for (const k of WORKER_ENV_KEYS) configured[k] = !!env[k];

  return new Response(JSON.stringify({
    version: WORKER_VERSION,
    routes:  WORKER_ROUTES,
    env:     configured,
    firebase,
  }), { headers: CORS });
}

// Throws on a non-OK response so a rejected credential surfaces as an error.
// An empty trip list and a 401 must not look the same to the widget.
async function wFetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('status ' + r.status);
  return r.json();
}

const W_BOOKING_FIELDS = ['flights', 'hotel', 'car'];

// Trip start date: explicit startDateISO, else the earliest day on the itinerary
function wTripStartISO(t) {
  if (t.startDateISO) return t.startDateISO;
  if (t.days) {
    const dates = Object.values(t.days)
      .map(d => d.dateISO || dayDateISO(d, t.year))
      .filter(Boolean)
      .sort();
    if (dates.length) return dates[0];
  }
  return '';
}

// Last day of the trip: the latest day on the itinerary, else the start date
function wTripEndISO(t) {
  if (t.days) {
    const dates = Object.values(t.days)
      .map(d => d.dateISO || dayDateISO(d, t.year))
      .filter(Boolean)
      .sort();
    if (dates.length) return dates[dates.length - 1];
  }
  return wTripStartISO(t);
}

// A day's city field carries decoration the geocoder chokes on: leading travel
// emoji ("🛬 Arrive Lyon") and a second place after a separator ("Lyon ·
// Beaujolais", "Domaine Tempier, Bandol"). Keep the first place named.
function wCleanCity(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/[🛬🚗✈️🏠]/g, '')
    .split('·')[0]
    .split(',')[0]
    .trim();
}

// Travel and transition days name a state rather than a place. Same skip list
// as getCityCoords() in index.html.
function wIsNonPlace(city) {
  const l = city.toLowerCase();
  return !l || l === 'in flight' || l.startsWith('home') || l.startsWith('fly out');
}

// The destination to show weather for: the earliest day of the trip that names
// a real place, so a trip that opens with a travel day still resolves to where
// it's going. Falls back to the day's region, then description.
function wTripWeatherCity(t) {
  if (!t.days) return '';
  const days = Object.values(t.days).sort((a, b) => {
    const ai = a.dateISO || dayDateISO(a, t.year) || '';
    const bi = b.dateISO || dayDateISO(b, t.year) || '';
    if (ai && bi) return ai.localeCompare(bi);
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });
  for (const d of days) {
    for (const field of [d.city, d.region, d.description]) {
      const city = wCleanCity(field);
      if (city && !wIsNonPlace(city)) return city;
    }
  }
  return '';
}

// The app geocodes every day card it renders and writes the result to Firebase
// under geocache/<slug> (getCityCoords() in index.html), through a provider
// chain far better than the free geocoder below — so the cache is both the
// first source and the best one. The version stamp matches the app's: entries
// below it were written by a geocoder with a known region-center bias bug.
const W_GEO_V = 3;

async function wCityCoords(city, env) {
  const slug = city.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const auth = env.FIREBASE_SECRET ? '?auth=' + env.FIREBASE_SECRET : '';
  try {
    const c = await wFetchJson(env.FIREBASE_URL + '/geocache/' + slug + '.json' + auth);
    if (c && !c.notFound && (c.v || 0) >= W_GEO_V && c.lat != null && c.lng != null) {
      return { lat: c.lat, lon: c.lng };
    }
  } catch (e) {}

  // Open-Meteo ranks by population and its top hit is sometimes an unrelated
  // town that merely aliases the name — searching "Sonoma" returns Ennis, Texas
  // first — so take several and prefer one that actually matches.
  try {
    const r = await wFetchJson(
      'https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&name=' + encodeURIComponent(city)
    );
    const results = r.results || [];
    if (!results.length) return null;
    const exact = results.find(x => String(x.name || '').toLowerCase() === city.toLowerCase());
    const hit = exact || results[0];
    if (hit.latitude == null || hit.longitude == null) return null;
    return { lat: hit.latitude, lon: hit.longitude };
  } catch (e) {}

  return null;
}

// Parse a travel-tracker `dates` string ("8/6/26", "Jan 5-8") into {m, d}.
// {m: 99} means TBD/unparseable. Mirrors parseTripDateSort() in the app.
function wParseTripDateSort(dates) {
  if (!dates) return { m: 99, d: 99 };
  const s = String(dates).trim();
  if (s.toLowerCase() === 'tbd') return { m: 99, d: 99 };
  const num = s.match(/^(\d{1,2})\/(\d{1,2})\//);
  if (num) return { m: parseInt(num[1], 10) - 1, d: parseInt(num[2], 10) };
  const NAMED = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const name = s.toLowerCase().match(/^([a-z]{3})/);
  if (name && NAMED[name[1]] !== undefined) {
    const day = s.match(/(\d+)/);
    return { m: NAMED[name[1]], d: day ? parseInt(day[1], 10) : 0 };
  }
  return { m: 99, d: 99 };
}

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12, january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };

function dayDateISO(day, tripYear) {
  const num = parseInt(String(day.dateNum || '').replace(/\D/g, ''), 10);
  const mon = MONTHS[(day.dateMonth || '').toLowerCase().trim()];
  const yr  = parseInt(day.year || tripYear || '', 10);
  if (!num || !mon || !yr) return '';
  return `${yr}-${String(mon).padStart(2, '0')}-${String(num).padStart(2, '0')}`;
}

function parseTimeTo24h(time) {
  if (!time) return '';
  const m = String(time).match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = (m[3] || '').toLowerCase();
  if (ampm === 'pm' && h !== 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + min;
}

// ── Booking inbox ─────────────────────────────────────────────────────────────
// Forward a flight, hotel or rental-car confirmation to the address routed to
// this Worker (Cloudflare Email Routing — see DEPLOY.md). It is decoded, parsed
// by Claude into structured bookings and queued at bookingInbox/{pushId}, where
// the app's admin "Booking Inbox" assigns it to a trip.

// Decoded text sent to the model. Confirmations run long on boilerplate; the
// booking itself is near the top, and this keeps a parse inside one call.
const BOOKING_TEXT_LIMIT = 30000;
// Kept on the inbox item so the app can show the email and retry a parse.
const BOOKING_EXCERPT_LIMIT = 12000;
// Raw MIME size above which mail is refused rather than read into memory.
const BOOKING_RAW_LIMIT = 15 * 1024 * 1024;
const BOOKING_MODEL = 'claude-sonnet-4-6';

async function handleInboundEmail(message, env) {
  if (!env.FIREBASE_URL) {
    message.setReject('Booking inbox is not configured');
    return;
  }
  if (message.rawSize > BOOKING_RAW_LIMIT) {
    message.setReject('Message too large');
    return;
  }

  const raw = await new Response(message.raw).text();
  const mail = parseMime(raw);

  // Only people with app access (admins and users, not guests) may send. A
  // manual forward arrives from them directly; a Gmail auto-forward keeps the
  // airline as sender but names the forwarding account in X-Forwarded-For.
  const senders = [
    message.from,
    extractAddress(mail.headers['from']),
    extractAddress((mail.headers['x-forwarded-for'] || '').split(/\s+/)[0]),
  ].map(a => (a || '').toLowerCase()).filter(Boolean);
  let allowed;
  try {
    allowed = await bookingAllowedSenders(env);
  } catch (e) {
    // Can't check — refuse with a reason that tells the sender to retry,
    // rather than let them assume it was queued.
    message.setReject('Booking inbox unavailable, try again later');
    return;
  }
  const sender = senders.find(a => allowed.has(a));
  if (!sender) {
    message.setReject('Sender not allowed');
    return;
  }

  const subject = decodeEncodedWords(mail.headers['subject'] || '');
  const text = mailText(mail);
  const item = {
    receivedAt: Date.now(),
    from: sender,
    subject,
    source: 'email',
    status: 'pending',
    bodyExcerpt: text.slice(0, BOOKING_EXCERPT_LIMIT),
  };
  try {
    Object.assign(item, await parseBookingText(env, subject, text));
  } catch (e) {
    // Keep the email so nothing forwarded is lost; the app can retry the parse.
    item.status = 'error';
    item.error = e.message;
    item.kind = 'other';
    item.summary = subject || 'Unparsed email';
  }

  const auth = env.FIREBASE_SECRET ? '?auth=' + env.FIREBASE_SECRET : '';
  const r = await fetch(env.FIREBASE_URL + '/bookingInbox.json' + auth, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!r.ok) {
    message.setReject('Booking inbox unavailable, try again later');
    return;
  }

  await notifyBookingQueued(env, item);

  // Confirm by email, but only to a person who forwarded it themselves. On a
  // Gmail auto-forward the envelope sender is the airline or hotel, and a reply
  // would go to them.
  if ((message.from || '').toLowerCase() === sender) {
    try {
      await sendInboxReply(message, mail, item);
    } catch (e) {
      // The booking is already queued; a missing confirmation loses nothing
      console.warn('Booking inbox reply failed: ' + e.message);
    }
  }
}

// A plain-text reply in the sender's thread: that the booking is in the inbox,
// and what was read from it. Cloudflare only allows replying to the original
// sender, from the routed address, with In-Reply-To set.
async function sendInboxReply(message, mail, item) {
  const inReplyTo = mail.headers['message-id'];
  if (!inReplyTo || !message.to) return;
  // Imported here rather than at the top so the module still loads outside the
  // Workers runtime (local tests stub it)
  const { EmailMessage } = await import('cloudflare:email');

  const lines = bookingDetailLines(item.parsed || {});
  const read = item.status !== 'error' && item.kind !== 'other' && lines.length;
  const body = read
    ? ['✓ Added to your Trips booking inbox:', item.summary, '', ...lines].join('\r\n')
    : 'Added to your Trips booking inbox, but no flight, hotel or rental car details could be read from it.';
  const subject = !item.subject ? 'Re: Your booking'
    : /^re:/i.test(item.subject) ? item.subject : 'Re: ' + item.subject;
  const domain = message.to.split('@')[1] || 'localhost';
  const raw = [
    'From: Hardin Trips <' + message.to + '>',
    'To: ' + message.from,
    'Subject: ' + encodeHeaderWords(subject),
    'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>',
    'In-Reply-To: ' + inReplyTo,
    'References: ' + (mail.headers['references'] ? mail.headers['references'] + ' ' : '') + inReplyTo,
    'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    utf8Base64(body + '\r\n').replace(/(.{76})/g, '$1\r\n'),
  ].join('\r\n');
  await message.reply(new EmailMessage(message.to, message.from, raw));
}

// Same lines the app's inbox card shows (_inboxDetailLines in index.html)
function bookingDetailLines(p) {
  const list = v => Array.isArray(v) ? v.filter(Boolean) : [];
  const d = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '')
    ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  const lines = [];
  list(p.flights).forEach(f => {
    const times = f.depTime && f.arrTime ? ' · ' + f.depTime + ' – ' + f.arrTime : '';
    lines.push('✈️ ' + [d(f.dateISO), String(f.flightNumber || '').toUpperCase() + ' ' + (f.from || '') + ' → ' + (f.to || '') + times].filter(Boolean).join(' · ') +
      (list(f.travelers).length ? ' · ' + list(f.travelers).join(', ') : ''));
  });
  list(p.hotels).forEach(h => lines.push('🏨 ' + [h.name, h.city].filter(Boolean).join(', ') +
    (h.checkInISO ? ' · ' + [d(h.checkInISO), d(h.checkOutISO)].filter(Boolean).join(' – ') : '')));
  list(p.cars).forEach(c => lines.push('🚗 ' + (c.company || 'Rental car') + ' · ' +
    [d(c.pickupISO), c.pickupLocation].filter(Boolean).join(' ') + ' → ' +
    [d(c.dropoffISO), c.dropoffLocation].filter(Boolean).join(' ')));
  const confs = [...new Set([...list(p.flights), ...list(p.hotels), ...list(p.cars)].map(x => x.confirmation).filter(Boolean))];
  if (confs.length) lines.push('Confirmation: ' + confs.join(', '));
  return lines;
}

function utf8Base64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// RFC 2047 for a non-ASCII header value, split so no encoded word runs past
// the 75-character limit and no character is cut in half
function encodeHeaderWords(s) {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words = [];
  let chunk = '';
  for (const ch of s) {
    if (new TextEncoder().encode(chunk + ch).length > 45) { words.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map(w => '=?UTF-8?B?' + utf8Base64(w) + '?=').join('\r\n ');
}

// Lowercased addresses of everyone with an admin or user role. Access keys are
// the email with '.' replaced by ',' — decoded too, for records missing email.
async function bookingAllowedSenders(env) {
  const auth = env.FIREBASE_SECRET ? '?auth=' + env.FIREBASE_SECRET : '';
  const access = await wFetchJson(env.FIREBASE_URL + '/access.json' + auth);
  const set = new Set();
  Object.entries(access || {}).forEach(([key, u]) => {
    if (!u || (u.role !== 'admin' && u.role !== 'user')) return;
    set.add(key.replace(/,/g, '.').toLowerCase());
    if (u.email) set.add(String(u.email).toLowerCase());
  });
  return set;
}

async function notifyBookingQueued(env, item) {
  if (!env.NTFY_TOPIC) return;
  // Header values must be plain ASCII; the emoji-bearing summary goes in the body
  const headers = { 'Title': 'New booking in inbox', 'Tags': 'inbox_tray', 'Content-Type': 'text/plain' };
  if (env.NTFY_TOKEN) headers['Authorization'] = 'Bearer ' + env.NTFY_TOKEN;
  try {
    await fetch('https://ntfy.sh/' + env.NTFY_TOPIC, {
      method: 'POST',
      headers,
      body: (item.status === 'error' ? 'Could not read: ' : '') + (item.summary || item.subject || 'Booking'),
    });
  } catch (e) { /* a missed push never loses the booking */ }
}

// Ask Claude for structured bookings. Returns { kind, summary, parsed }.
async function parseBookingText(env, subject, text) {
  if (!env.ANTHROPIC_KEY) throw new Error('ANTHROPIC_KEY not configured');
  const today = new Date().toISOString().slice(0, 10);
  const system = [
    'You extract travel bookings from confirmation emails (often forwarded). Today is ' + today + '.',
    'Reply with ONLY a JSON object, no prose and no code fences, in exactly this shape:',
    '{"kind":"flight|hotel|car|other","summary":"...","flights":[...],"hotels":[...],"cars":[...]}',
    'flights items: {"flightNumber":"UA100","dateISO":"YYYY-MM-DD","from":"DEN","to":"LIS","depTime":"8:05am","arrTime":"10:40pm","arrDayOffset":0,"travelers":["First Last"],"confirmation":"ABC123"}',
    'hotels items: {"name":"Hotel name","city":"City","address":"...","checkInISO":"YYYY-MM-DD","checkOutISO":"YYYY-MM-DD","checkInTime":"3pm","confirmation":"..."}',
    'cars items: {"company":"Hertz","pickupLocation":"...","pickupISO":"YYYY-MM-DD","pickupTime":"10am","dropoffLocation":"...","dropoffISO":"YYYY-MM-DD","dropoffTime":"9am","confirmation":"..."}',
    'Rules:',
    '- One flights item per flight segment (a connection is two segments). Include every segment of the itinerary.',
    '- flightNumber is airline IATA code + number, no spaces. from/to are 3-letter IATA airport codes.',
    '- Times are local, ALWAYS 12-hour with am/pm like "7:30pm" or "10am". Never 24-hour. Use "" when unknown.',
    '- arrDayOffset is how many days after dateISO the flight lands (0 same day, 1 overnight).',
    '- Dates are YYYY-MM-DD. If the email omits the year, choose the next occurrence after today.',
    '- travelers: passenger names as "First Last" in normal capitalization. [] if not given.',
    '- Use "" for unknown strings and [] for empty lists; keep every key.',
    '- A cancellation is not a booking: kind "other", and say it is a cancellation in summary.',
    '- kind is the main booking type; "other" if there is no flight, hotel or car booking.',
    '- summary: one short line, e.g. "UA100 DEN → LIS · Oct 12", "Hôtel Martinez, Cannes · Jun 3–5", "Hertz · Lyon Airport · Jun 1–8".',
  ].join('\n');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: BOOKING_MODEL,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: 'Subject: ' + subject + '\n\n' + text.slice(0, BOOKING_TEXT_LIMIT) }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || ('Anthropic status ' + r.status));
  const out = ((data.content && data.content[0] && data.content[0].text) || '')
    .replace(/```json|```/g, '').trim();
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON in model reply');
  const j = JSON.parse(out.slice(start, end + 1));

  const arr = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
  const parsed = { flights: arr(j.flights), hotels: arr(j.hotels), cars: arr(j.cars) };
  let kind = ['flight', 'hotel', 'car', 'other'].includes(j.kind) ? j.kind : 'other';
  if (kind === 'other' && !/cancel/i.test(j.summary || '')) {
    if (parsed.flights.length) kind = 'flight';
    else if (parsed.hotels.length) kind = 'hotel';
    else if (parsed.cars.length) kind = 'car';
  }
  return { kind, summary: String(j.summary || subject || 'Booking'), parsed };
}

// ── Minimal MIME decoding ─────────────────────────────────────────────────────
// Enough for confirmation emails: nested multiparts, base64 and
// quoted-printable bodies, charsets, forwarded message/rfc822 parts. Written
// inline because this Worker deploys with no build step (see DEPLOY.md).

function parseMime(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  const headText = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : '';
  const headers = {};
  headText.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(line => {
    const i = line.indexOf(':');
    if (i <= 0) return;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!(name in headers)) headers[name] = line.slice(i + 1).trim();
  });
  return { headers, body };
}

function mimeParam(value, name) {
  const m = (value || '').match(new RegExp('(?:^|;)\\s*' + name + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i'));
  return m ? (m[1] !== undefined ? m[1] : m[2]) : '';
}

// Every text/plain and text/html part that isn't an attachment, in order.
function collectTextParts(entity, out, depth) {
  if (depth > 10) return out;
  const ctype = entity.headers['content-type'] || 'text/plain';
  const type = ctype.split(';')[0].trim().toLowerCase();
  if (type.startsWith('multipart/')) {
    const boundary = mimeParam(ctype, 'boundary');
    if (!boundary) return out;
    const sections = entity.body.split('--' + boundary);
    // sections[0] is the preamble; the closing delimiter is "--boundary--"
    for (let i = 1; i < sections.length; i++) {
      const sec = sections[i];
      if (sec.startsWith('--')) break;
      collectTextParts(parseMime(sec.replace(/^[ \t]*\r?\n/, '')), out, depth + 1);
    }
    return out;
  }
  if (type === 'message/rfc822') {
    const inner = parseMime(decodeTransfer(entity.body, entity.headers['content-transfer-encoding'], 'utf-8'));
    collectTextParts(inner, out, depth + 1);
    return out;
  }
  if (type !== 'text/plain' && type !== 'text/html') return out;
  if (/^\s*attachment/i.test(entity.headers['content-disposition'] || '')) return out;
  const charset = mimeParam(ctype, 'charset') || 'utf-8';
  out.push({ type, text: decodeTransfer(entity.body, entity.headers['content-transfer-encoding'], charset) });
  return out;
}

function decodeBytes(bytes, charset) {
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); }
  catch (e) { return new TextDecoder('utf-8').decode(bytes); }
}

function base64Bytes(s) {
  const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeTransfer(body, encoding, charset) {
  const enc = (encoding || '').trim().toLowerCase();
  if (enc === 'base64') {
    try { return decodeBytes(base64Bytes(body), charset); }
    catch (e) { return body; }
  }
  if (enc === 'quoted-printable') {
    return decodeBytes(qpBytes(body.replace(/=\r?\n/g, ''), false), charset);
  }
  // 7bit / 8bit / binary: the raw message was already read as UTF-8
  return body;
}

// Quoted-printable (or RFC 2047 "Q", where _ is a space) to bytes
function qpBytes(s, underscoreIsSpace) {
  const enc = new TextEncoder();
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) {
      bytes.push(parseInt(s.substr(i + 1, 2), 16));
      i += 2;
    } else if (c === '_' && underscoreIsSpace) {
      bytes.push(32);
    } else {
      // Non-ASCII here arrived as 8bit text; put it back as UTF-8 bytes
      for (const b of enc.encode(c)) bytes.push(b);
    }
  }
  return new Uint8Array(bytes);
}

// RFC 2047 encoded words in headers: =?UTF-8?B?...?= and =?UTF-8?Q?...?=
function decodeEncodedWords(s) {
  return String(s)
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (all, charset, enc, data) => {
      try {
        return enc.toUpperCase() === 'B'
          ? decodeBytes(base64Bytes(data), charset)
          : decodeBytes(qpBytes(data, true), charset);
      } catch (e) { return all; }
    });
}

function extractAddress(s) {
  if (!s) return '';
  const m = String(s).match(/<([^>]+)>/) || String(s).match(/[^\s<>"',;]+@[^\s<>"',;]+/);
  return m ? (m[1] || m[0]).trim() : '';
}

function htmlToText(html) {
  const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', rarr: '→', middot: '·', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
  return html
    .replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] !== undefined ? named[n.toLowerCase()] : m);
}

function tidyText(s) {
  return s
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .split('\n').map(l => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The readable body of a parsed message: its plain-text parts, unless those
// are missing or a stub ("view this email in a browser"), then the HTML as text.
function mailText(mail) {
  const parts = collectTextParts(mail, [], 0);
  const plain = tidyText(parts.filter(p => p.type === 'text/plain').map(p => p.text).join('\n\n'));
  const html = parts.filter(p => p.type === 'text/html').map(p => p.text).join('\n');
  if (html && plain.length < 400) return tidyText(htmlToText(html));
  return plain;
}
