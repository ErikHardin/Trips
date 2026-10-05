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

    // Place search for drive times and the app's "Set location" sheet
    if (url.pathname === '/geocode') {
      const q = String(body.q || '').trim().slice(0, 200);
      if (!q) return new Response(JSON.stringify({ error: 'Missing q' }), { status: 400, headers: CORS_JSON });
      const results = await placeSearch(env, q, validNear(body.near), Math.min(Math.max(parseInt(body.limit) || 5, 1), 10));
      return new Response(JSON.stringify({ results }), { headers: CORS_JSON });
    }

    // Coordinates → the place/address there, to label a pin set from coordinates or a link
    if (url.pathname === '/reverse-geocode') {
      const at = validNear([body.lat, body.lng]);
      if (!at) return new Response(JSON.stringify({ error: 'Missing lat/lng' }), { status: 400, headers: CORS_JSON });
      return new Response(JSON.stringify(await reverseGeocode(env, at) || {}), { headers: CORS_JSON });
    }

    // A pasted Google Maps / Apple Maps share link → coordinates
    if (url.pathname === '/resolve-map-link') {
      const result = await resolveMapLink(env, String(body.url || '').trim(), validNear(body.near));
      return new Response(JSON.stringify(result || { error: 'No location found in that link' }), {
        status: result ? 200 : 404, headers: CORS_JSON
      });
    }

    // Push: a test notification to the signed-in caller's own devices
    if (url.pathname === '/push/test') {
      return handlePushTest(env, body);
    }
    // Push: tell admins about the caller's new access request
    if (url.pathname === '/push/access-request') {
      return handlePushAccessRequest(env, body);
    }
    // Push: an admin approved someone — tell them they're in
    if (url.pathname === '/push/access-approved') {
      return handlePushAccessApproved(env, body);
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
  },

  // Cron (wrangler.toml [triggers]): every 5 minutes, scheduled pushes —
  // activity reminders and leave-by alerts.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPushCron(env).catch(e => console.error('Push cron failed: ' + (e && e.stack || e))));
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
const WORKER_VERSION = '2026-10-05.1';

// Presence of these is reported by /version. Names only, never values — and
// they are already visible in this file, so nothing is disclosed by listing them.
const WORKER_ENV_KEYS = [
  'ANTHROPIC_KEY',
  'FIREBASE_URL',
  'FIREBASE_SECRET',
  'AERODATABOX_KEY',
  'ADMIN_PIN',
  'ADMIN_PIN_2',
  'APNS_KEY_P8',
  'APNS_KEY_ID',
  'APPLE_TEAM_ID',
  'MAPS_KEY_P8',
  'MAPS_KEY_ID',
];

const WORKER_ROUTES = [
  '/version',
  '/widget-data',
  '/widget-upcoming',
  '/verify-pin',
  '/flight-lookup',
  '/booking-parse',
  '/geocode',
  '/resolve-map-link',
  '/reverse-geocode',
  '/push/test',
  '/push/access-request',
  '/push/access-approved',
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
// Email a confirmation back to the forwarder (sendInboxReply). Off — see handleInboundEmail.
const BOOKING_SEND_REPLY = false;

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
  // Whose inbox it shows in; admins see every item either way
  if (allowed.get(sender)) item.ownerEmail = allowed.get(sender);
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

  // Replies are off: Cloudflare refuses to reply to a forwarded (threaded)
  // email, and sending a fresh one needs every recipient verified or a paid
  // sending service. The code below stays for when that changes.
  if (!BOOKING_SEND_REPLY) return;

  const itemKey = ((await r.json().catch(() => null)) || {}).name;

  // Confirm by email, but only to a person who forwarded it themselves. On a
  // Gmail auto-forward the envelope sender is the airline or hotel, and a reply
  // would go to them.
  let reply;
  if ((message.from || '').toLowerCase() === sender) {
    try {
      reply = await sendInboxReply(message, mail, item);
    } catch (e) {
      // The booking is already queued; a missing confirmation loses nothing
      reply = 'failed: ' + (e && e.message || e);
    }
  } else {
    reply = 'skipped: forwarded automatically (sender ' + (message.from || 'unknown') + ')';
  }

  // Recorded on the item so the app shows what happened to the reply
  console.log('Booking inbox reply ' + reply + ' — ' + (item.summary || item.subject || ''));
  if (itemKey) {
    try {
      await fetch(env.FIREBASE_URL + '/bookingInbox/' + itemKey + '.json' + auth, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply }),
      });
    } catch (e) { /* the status is a nicety */ }
  }
}

// A plain-text reply in the sender's thread: that the booking is in the inbox,
// and what was read from it. Cloudflare only allows replying to the original
// sender, from the routed address, with In-Reply-To set. Returns 'sent' or why
// it wasn't; throws when Cloudflare refuses the reply.
async function sendInboxReply(message, mail, item) {
  const inReplyTo = mail.headers['message-id'];
  if (!inReplyTo) return 'skipped: no Message-ID on the email';
  if (!message.to) return 'skipped: no recipient address';
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
  return 'sent';
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
  list(p.activities).forEach(a => lines.push('🎟️ ' + [d(a.dateISO), a.title || a.venue || 'Activity',
    a.time ? a.time + (a.endTime ? '–' + a.endTime : '') : '', a.partySize > 0 ? 'Party of ' + a.partySize : ''].filter(Boolean).join(' · ')));
  const confs = [...new Set([...list(p.flights), ...list(p.hotels), ...list(p.cars), ...list(p.activities)].map(x => x.confirmation).filter(Boolean))];
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

// Lowercased addresses allowed to send, each mapped to the app account whose
// inbox it belongs to (or null): everyone with an admin or user role maps to
// themselves, and an approved sender to the user it was linked to, if any.
// Access keys are the sign-in email with '.' replaced by ',' — decoded, they
// match the auth email the database rules compare ownerEmail against.
async function bookingAllowedSenders(env) {
  const auth = env.FIREBASE_SECRET ? '?auth=' + env.FIREBASE_SECRET : '';
  const access = await wFetchJson(env.FIREBASE_URL + '/access.json' + auth);
  const map = new Map();
  Object.entries(access || {}).forEach(([key, u]) => {
    if (!u || (u.role !== 'admin' && u.role !== 'user')) return;
    const owner = key.replace(/,/g, '.');
    map.set(owner.toLowerCase(), owner);
    if (u.email) map.set(String(u.email).toLowerCase(), owner);
  });
  // Addresses without an app account that people book from, managed in the
  // app's Booking Inbox → Approved senders. Unreadable never blocks the above.
  try {
    const extra = await wFetchJson(env.FIREBASE_URL + '/config/bookingInboxSenders.json' + auth);
    Object.entries(extra || {}).forEach(([key, s]) => {
      const addr = String((s && s.email) || key.replace(/,/g, '.')).trim().toLowerCase();
      if (!map.has(addr)) map.set(addr, (s && s.owner) || null);
    });
  } catch (e) {
    console.warn('Approved senders unavailable: ' + e.message);
  }
  return map;
}

// Push to whoever sent the booking in (its owner). An item with no owner — an
// approved sender not linked to anyone — goes to admins so it isn't missed.
async function notifyBookingQueued(env, item) {
  try {
    const keys = item.ownerEmail
      ? [String(item.ownerEmail).toLowerCase().replace(/\./g, ',')]
      : await adminKeys(env);
    await pushToKeys(env, keys, 'bookingInbox', {
      title: item.status === 'error' ? '📥 Couldn’t read a booking' : '📥 New booking',
      body: (item.summary || item.subject || 'Booking') + '\nTap to add it to a trip',
      route: { screen: 'inbox' },
      threadId: 'inbox',
    });
  } catch (e) { console.warn('Booking push failed: ' + e.message); /* a missed push never loses the booking */ }
}

// Ask Claude for structured bookings. Returns { kind, summary, parsed }.
async function parseBookingText(env, subject, text) {
  if (!env.ANTHROPIC_KEY) throw new Error('ANTHROPIC_KEY not configured');
  const today = new Date().toISOString().slice(0, 10);
  const system = [
    'You extract travel bookings from confirmation emails (often forwarded): flights, hotels, rental cars, and activity reservations (restaurants, tours, tastings, tickets, shows, spa, classes). Today is ' + today + '.',
    'Reply with ONLY a JSON object, no prose and no code fences, in exactly this shape:',
    '{"kind":"flight|hotel|car|activity|other","summary":"...","flights":[...],"hotels":[...],"cars":[...],"activities":[...]}',
    'flights items: {"flightNumber":"UA100","dateISO":"YYYY-MM-DD","from":"DEN","to":"LIS","depTime":"8:05am","arrTime":"10:40pm","arrDayOffset":0,"travelers":["First Last"],"confirmation":"ABC123"}',
    'hotels items: {"name":"Hotel name","city":"City","address":"...","checkInISO":"YYYY-MM-DD","checkOutISO":"YYYY-MM-DD","checkInTime":"3pm","confirmation":"..."}',
    'cars items: {"company":"Hertz","pickupLocation":"...","pickupISO":"YYYY-MM-DD","pickupTime":"10am","dropoffLocation":"...","dropoffISO":"YYYY-MM-DD","dropoffTime":"9am","confirmation":"..."}',
    'activities items: {"title":"Dinner at Soma","dateISO":"YYYY-MM-DD","time":"7:30pm","endTime":"","venue":"Soma","city":"Lyon","address":"...","category":"dining|tour|tasting|tickets|show|spa|other","partySize":4,"paid":false,"confirmation":"..."}',
    'Rules:',
    '- activities: one item per reservation or ticketed time slot. title is a short itinerary label in the style "Dinner at Soma", "Lunch at Le Vineum", "Tasting at Domaine Tempier", "Lyon Secret Food Tour", "Louvre tickets". venue is the bare place name. paid is true only when the email shows it was paid in full (tickets, prepaid tours); a deposit or card hold is false. partySize is a number, 0 if not given.',
    '- One flights item per flight segment (a connection is two segments). Include every segment of the itinerary.',
    '- flightNumber is airline IATA code + number, no spaces. from/to are 3-letter IATA airport codes.',
    '- Times are local, ALWAYS 12-hour with am/pm like "7:30pm" or "10am". Never 24-hour. Use "" when unknown.',
    '- arrDayOffset is how many days after dateISO the flight lands (0 same day, 1 overnight).',
    '- Dates are YYYY-MM-DD. If the email omits the year, choose the next occurrence after today.',
    '- travelers: passenger names as "First Last" in normal capitalization. [] if not given.',
    '- Use "" for unknown strings and [] for empty lists; keep every key.',
    '- A cancellation is not a booking: kind "other", and say it is a cancellation in summary.',
    '- kind is the main booking type; "other" if there is no flight, hotel, car or activity booking.',
    '- summary: one short line, e.g. "UA100 DEN → LIS · Oct 12", "Hôtel Martinez, Cannes · Jun 3–5", "Hertz · Lyon Airport · Jun 1–8", "Dinner at Soma · Oct 14 · 7:30pm".',
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
  const parsed = { flights: arr(j.flights), hotels: arr(j.hotels), cars: arr(j.cars), activities: arr(j.activities) };
  let kind = ['flight', 'hotel', 'car', 'activity', 'other'].includes(j.kind) ? j.kind : 'other';
  if (kind === 'other' && !/cancel/i.test(j.summary || '')) {
    if (parsed.flights.length) kind = 'flight';
    else if (parsed.hotels.length) kind = 'hotel';
    else if (parsed.cars.length) kind = 'car';
    else if (parsed.activities.length) kind = 'activity';
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

// ── Push notifications (APNs) ─────────────────────────────────────────────────
// The iOS app (ios-app/) registers with APNs and the site saves each device
// token at pushTokens/{emailKey}/{token}. This Worker sends straight to APNs
// over HTTP/2 with a token-based (.p8) key — see ios-app/IOS.md and DEPLOY.md.
// Each person's choices live at notifyPrefs/{emailKey}; unset fields fall back
// to NOTIFY_DEFAULTS (kept in step with the copy in index.html).

const NOTIFY_DEFAULTS = {
  accessRequests: true,  // admins: someone asked to join
  bookingInbox:   true,  // a booking landed in your inbox (admins: anyone's)
  activities:     true,  // upcoming timed activities
  leaveBy:        true,  // traffic-aware "leave by" for drives
  brief:          true,  // morning brief on trip days
  flights:        true,  // delays, gate changes, check-in
  tripEdits:      true,  // someone else changed a trip you're on
  activityLeadMin: 30,
  briefTime:      '07:30',
  quietHours:     false,
  quietStart:     '22:00',
  quietEnd:       '07:00',
};

const APNS_HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };

function fbPath(env, path) {
  const auth = env.FIREBASE_SECRET ? '?auth=' + env.FIREBASE_SECRET : '';
  return env.FIREBASE_URL + '/' + path.replace(/[%#? ]/g, encodeURIComponent) + '.json' + auth;
}
async function fbGet(env, path) { return wFetchJson(fbPath(env, path)); }
async function fbWrite(env, method, path, value) {
  const r = await fetch(fbPath(env, path), {
    method, headers: { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  if (!r.ok) throw new Error(method + ' ' + path + ': status ' + r.status);
}

function b64url(bytes) {
  let s = '';
  bytes = new Uint8Array(bytes);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlJson = o => b64url(new TextEncoder().encode(JSON.stringify(o)));
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
}

// A .p8 pasted into the dashboard may keep its PEM lines or arrive as one
// line with literal "\n"s — either way only the base64 body matters.
async function importP8(pem) {
  const body = String(pem || '').replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return crypto.subtle.importKey('pkcs8', b64urlDecode(body),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// ES256 JWT for Apple's token-based auth (APNs and the Maps Server API).
// WebCrypto returns the raw r||s signature JWS wants.
async function appleJwt(env, p8, keyId, extraClaims) {
  const head = b64urlJson({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const claims = b64urlJson(Object.assign({ iss: env.APPLE_TEAM_ID, iat: Math.floor(Date.now() / 1000) }, extraClaims || {}));
  const key = await importP8(p8);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(head + '.' + claims));
  return head + '.' + claims + '.' + b64url(sig);
}

// APNs accepts a provider token for up to an hour and rejects one refreshed
// more often than every 20 minutes, so reuse it across requests in an isolate.
let _apnsJwt = null;
async function apnsJwt(env) {
  if (_apnsJwt && Date.now() - _apnsJwt.at < 45 * 60 * 1000) return _apnsJwt.token;
  _apnsJwt = { token: await appleJwt(env, env.APNS_KEY_P8, env.APNS_KEY_ID), at: Date.now() };
  return _apnsJwt.token;
}

function pushConfigured(env) {
  return !!(env.APNS_KEY_P8 && env.APNS_KEY_ID && env.APPLE_TEAM_ID && env.FIREBASE_URL);
}

async function apnsPost(env, host, deviceToken, payload, opts) {
  const headers = {
    'authorization': 'bearer ' + await apnsJwt(env),
    'apns-topic': env.APNS_TOPIC || 'com.erikhardin.trips',
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'content-type': 'application/json',
  };
  if (opts.collapseId) headers['apns-collapse-id'] = String(opts.collapseId).slice(0, 64);
  const r = await fetch(APNS_HOSTS[host] + '/3/device/' + deviceToken, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (r.ok) return { ok: true };
  let reason = '';
  try { reason = (await r.json()).reason || ''; } catch (e) {}
  return { ok: false, status: r.status, reason };
}

// msg: { title, body, route?, threadId?, collapseId?, timeSensitive?, category?, act? }.
// `route` rides along in the payload; the app opens it when the push is tapped.
// Returns { sent, tokens, errors }. Tokens APNs reports dead are removed.
async function sendPushToUser(env, emailKey, msg) {
  const out = { sent: 0, tokens: 0, errors: [] };
  if (!pushConfigured(env)) { out.errors.push('APNs secrets not configured'); return out; }
  const devices = (await fbGet(env, 'pushTokens/' + emailKey)) || {};
  const aps = { alert: { title: msg.title, body: msg.body }, sound: 'default' };
  if (msg.threadId) aps['thread-id'] = msg.threadId;
  if (msg.timeSensitive) aps['interruption-level'] = 'time-sensitive';
  // Buttons on the notification (categories registered in AppDelegate.swift);
  // builds without them just ignore it
  if (msg.category) aps.category = msg.category;
  const payload = { aps, route: msg.route || null };
  if (msg.act) payload.act = msg.act;

  await Promise.all(Object.entries(devices).map(async ([token, rec]) => {
    if (!/^[0-9a-f]{32,200}$/i.test(token)) return;
    out.tokens++;
    // TestFlight builds use production APNs, Xcode debug builds the sandbox.
    // The site can't tell which, so try the remembered (or likelier) host and
    // fall back to the other on BadDeviceToken, remembering what worked.
    const first = rec && rec.env === 'sandbox' ? 'sandbox' : 'production';
    const second = first === 'production' ? 'sandbox' : 'production';
    try {
      let res = await apnsPost(env, first, token, payload, msg);
      let used = first;
      if (!res.ok && res.reason === 'BadDeviceToken') {
        res = await apnsPost(env, second, token, payload, msg);
        used = second;
      }
      if (res.ok) {
        out.sent++;
        if (!rec || rec.env !== used) await fbWrite(env, 'PATCH', 'pushTokens/' + emailKey + '/' + token, { env: used }).catch(() => {});
      } else if (res.status === 410 || res.reason === 'BadDeviceToken' || res.reason === 'Unregistered') {
        await fbWrite(env, 'DELETE', 'pushTokens/' + emailKey + '/' + token).catch(() => {});
        out.errors.push('removed stale device (' + (res.reason || res.status) + ')');
      } else {
        out.errors.push(res.status + ' ' + res.reason);
      }
    } catch (e) {
      out.errors.push(e.message);
    }
  }));
  return out;
}

// Merged prefs for one person (defaults for anything unset).
async function notifyPrefs(env, emailKey) {
  let p = null;
  try { p = await fbGet(env, 'notifyPrefs/' + emailKey); } catch (e) {}
  return Object.assign({}, NOTIFY_DEFAULTS, p || {});
}

// ── Firebase ID tokens ──
// Push routes that act for a signed-in person take their Firebase ID token and
// verify it here, so a caller can only reach their own devices.
let _googleJwks = null;
async function googleJwks() {
  if (_googleJwks && Date.now() < _googleJwks.until) return _googleJwks.keys;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!r.ok) throw new Error('JWKS status ' + r.status);
  const maxAge = parseInt((/max-age=(\d+)/.exec(r.headers.get('cache-control') || '') || [])[1] || '3600', 10);
  _googleJwks = { keys: (await r.json()).keys || [], until: Date.now() + maxAge * 1000 };
  return _googleJwks.keys;
}

// Returns { email, emailKey } for a valid, verified-email token; throws otherwise.
async function verifyFirebaseIdToken(env, idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  if (header.alg !== 'RS256') throw new Error('bad alg');
  const jwk = (await googleJwks()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('bad signature');
  const project = env.FIREBASE_PROJECT_ID || 'hardin-trips';
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== project || claims.iss !== 'https://securetoken.google.com/' + project) throw new Error('wrong project');
  if (!(claims.exp > now) || claims.iat > now + 300 || !claims.sub) throw new Error('expired');
  if (!claims.email || claims.email_verified !== true) throw new Error('email not verified');
  const email = String(claims.email).toLowerCase();
  return { email, emailKey: email.replace(/\./g, ',') };
}

// POST /push/test { idToken } — sends a test push to the caller's own devices.
async function handlePushTest(env, body) {
  const CORS_JSON = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  let who;
  try { who = await verifyFirebaseIdToken(env, body.idToken); }
  catch (e) { return new Response(JSON.stringify({ error: 'Not signed in: ' + e.message }), { status: 401, headers: CORS_JSON }); }
  const result = await sendPushToUser(env, who.emailKey, {
    title: 'Notifications are on ✓',
    body: 'This is a test from Hardin Trips.',
    route: { screen: 'settings' },
    collapseId: 'test',
  });
  return new Response(JSON.stringify(result), { headers: CORS_JSON });
}

async function adminKeys(env) {
  const access = (await fbGet(env, 'access')) || {};
  return Object.keys(access).filter(k => access[k] && access[k].role === 'admin');
}

// Sends msg to each person whose notifyPrefs[prefKey] is on (all, without a prefKey)
async function pushToKeys(env, keys, prefKey, msg) {
  let sent = 0;
  await Promise.all(keys.map(async key => {
    if (prefKey && !(await notifyPrefs(env, key))[prefKey]) return;
    sent += (await sendPushToUser(env, key, msg)).sent;
  }));
  return sent;
}

const jsonResponse = (obj, status) => new Response(JSON.stringify(obj), {
  status: status || 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
});

// POST /push/access-request { idToken }. The text comes from the request the
// caller saved at accessRequests/{their key}, never from the POST body, and
// pushSent/ makes it one push per request however often this is called.
async function handlePushAccessRequest(env, body) {
  let who;
  try { who = await verifyFirebaseIdToken(env, body.idToken); }
  catch (e) { return jsonResponse({ error: 'Not signed in: ' + e.message }, 401); }
  const req = await fbGet(env, 'accessRequests/' + who.emailKey);
  if (!req || !req.requestedAt) return jsonResponse({ error: 'No request' }, 404);
  const dedupe = 'pushSent/accessRequest:' + who.emailKey + ':' + req.requestedAt;
  if (await fbGet(env, dedupe)) return jsonResponse({ sent: 0, duplicate: true });
  await fbWrite(env, 'PUT', dedupe, Date.now());
  const name = String(req.name || '').trim();
  const sent = await pushToKeys(env, await adminKeys(env), 'accessRequests', {
    title: '👋 New access request',
    body: (name ? name + ' (' + who.email + ')' : who.email) + ' wants to join. Tap to pick a role and trips.',
    route: { screen: 'users' },
    threadId: 'access',
  });
  return jsonResponse({ sent });
}

// POST /push/access-approved { idToken, emailKey }. Caller must be an admin
// and the person must now have access. One push per person.
async function handlePushAccessApproved(env, body) {
  let who;
  try { who = await verifyFirebaseIdToken(env, body.idToken); }
  catch (e) { return jsonResponse({ error: 'Not signed in: ' + e.message }, 401); }
  const caller = await fbGet(env, 'access/' + who.emailKey);
  if (!caller || caller.role !== 'admin') return jsonResponse({ error: 'Admins only' }, 403);
  const key = String(body.emailKey || '');
  if (!/^[^/.#$\[\]]+$/.test(key)) return jsonResponse({ error: 'Bad emailKey' }, 400);
  const access = await fbGet(env, 'access/' + key);
  if (!access) return jsonResponse({ error: 'No access record' }, 404);
  const dedupe = 'pushSent/accessApproved:' + key;
  if (await fbGet(env, dedupe)) return jsonResponse({ sent: 0, duplicate: true });
  await fbWrite(env, 'PUT', dedupe, Date.now());
  const r = await sendPushToUser(env, key, {
    title: 'You’re in 🎉',
    body: 'You now have access to Hardin Trips. Tap to open your trips.',
    route: { screen: 'home' },
  });
  return jsonResponse({ sent: r.sent });
}

// ── Scheduled pushes (cron) ──────────────────────────────────────────────────
// Every 5 minutes: for trips with a day from yesterday to tomorrow, find timed
// activities in the day's own time zone and push
//   • a morning brief at each person's `briefTime` on trip days,
//   • a reminder `activityLeadMin` before each one, and
//   • for drives, "Leave by …" from a live-traffic ETA (Apple Maps Server API,
//     OSRM without traffic as the fallback), re-checked as the time nears,
//     with a follow-up if traffic gets 10+ minutes worse.
// Drive stops come from the app, which geocodes each day's drive activities
// and saves them to pushGeo/{tripId}/{dayId}. pushSent/ records what went
// out so nothing repeats; pushState/ caches ETAs and time zones.
// Per trip it also sends flight alerts and a digest of other people's edits
// (runFlightAlerts, runEditDigest below).

const PUSH_LEAVE_BUFFER_MIN = 10;   // arrive this early
const PUSH_ETA_HORIZON_MIN  = 180;  // start checking traffic 3h ahead

// FNV-1a, hex. Same as pushActId() in index.html — mutes are keyed by it.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const pushActId = (tripId, dateISO, a) => 'a' + fnv1a(tripId + '|' + dateISO + '|' + (a.text || '') + '|' + (a.time || ''));

// Start minute of a free-text time ("7:30pm", "10am–2pm", "10-11am").
// Mirrors parseActivityStartMinutes() in index.html.
function wActStartMinutes(timeStr) {
  const s = String(timeStr || '').trim().toLowerCase();
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (!m) {
    const range = s.match(/^(\d{1,2})(?::(\d{2}))?\s*[-–]/);
    const ap = s.match(/(am|pm)\s*$/);
    if (range && ap) m = [null, range[1], range[2], ap[1]];
  }
  if (!m) {
    const h24 = s.match(/^(\d{1,2}):(\d{2})(?!\s*[ap])/);   // "19:30"
    if (h24 && +h24[1] < 24) return +h24[1] * 60 + +h24[2];
    return null;
  }
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h > 12 || min > 59) return null;
  if (m[3] === 'pm' && h !== 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

// Offset (ms) of `tz` from UTC at instant `ms`
function tzOffsetMs(ms, tz) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
// UTC ms for local wall time dateISO + minutes in tz
function zonedToUtc(dateISO, minutes, tz) {
  const [y, mo, d] = dateISO.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);   // second pass settles DST edges
  return t;
}
const fmtLocalTime = (ms, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  .format(new Date(ms)).replace(' AM', 'am').replace(' PM', 'pm');
function localHHMM(ms, tz) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
  return s.replace(/^24/, '00');
}
function inQuietHours(prefs, ms, tz) {
  if (!prefs.quietHours) return false;
  const t = localHHMM(ms, tz), a = prefs.quietStart || '22:00', b = prefs.quietEnd || '07:00';
  return a <= b ? (t >= a && t < b) : (t >= a || t < b);
}

// IANA zone for a day: from its first saved drive stop, else its city
async function wDayTimeZone(env, day, geo, cache) {
  let coord = null, slug = null;
  const stop = geo && (geo.stops || [])[0];
  if (stop) coord = { lat: stop.lat, lon: stop.lng };
  else {
    const city = [day.city, day.region].map(wCleanCity).find(c => c && !wIsNonPlace(c));
    if (!city) return null;
    slug = 'c_' + city.toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (slug in cache) return cache[slug];
    coord = await wCityCoords(city, env);
  }
  if (!coord) return null;
  const ck = slug || ('p_' + coord.lat.toFixed(1) + '_' + coord.lon.toFixed(1)).replace(/[.-]/g, m => m === '.' ? 'd' : 'm');
  if (ck in cache) return cache[ck];
  let tz = null;
  try {
    const r = await wFetchJson('https://api.open-meteo.com/v1/forecast?latitude=' + coord.lat + '&longitude=' + coord.lon + '&timezone=auto');
    if (r && typeof r.timezone === 'string' && r.timezone !== 'GMT') tz = r.timezone;
  } catch (e) {}
  if (tz) { cache[ck] = tz; await fbWrite(env, 'PUT', 'pushState/tz/' + ck, tz).catch(() => {}); }
  return tz;
}

// Apple Maps Server API: a 30-minute access token from the Maps key (or the
// APNs key, if it has MapKit enabled too).
let _mapsToken = null;
async function appleMapsToken(env) {
  const p8 = env.MAPS_KEY_P8 || env.APNS_KEY_P8, kid = env.MAPS_KEY_ID || env.APNS_KEY_ID;
  if (!p8 || !kid || !env.APPLE_TEAM_ID) return null;
  if (_mapsToken && Date.now() < _mapsToken.until) return _mapsToken.token;
  const now = Math.floor(Date.now() / 1000);
  const jwt = await appleJwt(env, p8, kid, { exp: now + 1800 });
  const r = await fetch('https://maps-api.apple.com/v1/token', { headers: { authorization: 'Bearer ' + jwt } });
  if (!r.ok) throw new Error('Maps token status ' + r.status);
  const j = await r.json();
  _mapsToken = { token: j.accessToken, until: Date.now() + ((j.expiresInSeconds || 1800) - 120) * 1000 };
  return _mapsToken.token;
}

// Driving seconds from → to, leaving now: { sec, src }
async function driveEtaSeconds(env, from, to) {
  try {
    const token = await appleMapsToken(env);
    if (token) {
      const r = await fetch('https://maps-api.apple.com/v1/etas?transportType=Automobile&origin=' + from.lat + ',' + from.lng +
        '&destinations=' + to.lat + ',' + to.lng, { headers: { authorization: 'Bearer ' + token } });
      if (r.ok) {
        const e = ((await r.json()).etas || [])[0];
        if (e && e.expectedTravelTimeSeconds) return { sec: Math.round(e.expectedTravelTimeSeconds), src: 'apple' };
      } else console.warn('Apple Maps ETA status ' + r.status);
    }
  } catch (e) { console.warn('Apple Maps ETA failed: ' + e.message); }
  try {
    const r = await wFetchJson('https://router.project-osrm.org/route/v1/driving/' + from.lng + ',' + from.lat + ';' + to.lng + ',' + to.lat + '?overview=false');
    const sec = r.routes && r.routes[0] && r.routes[0].duration;
    if (sec) return { sec: Math.round(sec), src: 'osrm' };
  } catch (e) {}
  return null;
}

// ── Place search ──
// Apple Maps search first: it's the iPhone Maps POI data and finds wineries
// and restaurants the free geocoders miss. Photon is the fallback when the
// Maps key isn't configured or Apple has nothing.
function validNear(n) {
  if (!Array.isArray(n) || n.length < 2) return null;
  const lat = Number(n[0]), lng = Number(n[1]);
  return (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) ? [lat, lng] : null;
}

async function placeSearch(env, q, near, limit) {
  let results = [];
  try { results = await appleSearch(env, q, near, limit); } catch (e) { console.warn('Apple search failed: ' + e.message); }
  if (results.length) return results;
  try {
    let u = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=' + limit + '&lang=en';
    if (near) u += '&lat=' + near[0] + '&lon=' + near[1];
    const d = await wFetchJson(u);
    results = (d.features || []).map(f => {
      const p = f.properties || {};
      const addr = [[p.housenumber, p.street].filter(Boolean).join(' '), p.city || p.town || p.village, p.state, p.country]
        .filter(Boolean).join(', ');
      return { name: p.name || q, address: addr, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    });
  } catch (e) { console.warn('Photon search failed: ' + e.message); }
  return results;
}

async function appleSearch(env, q, near, limit) {
  const token = await appleMapsToken(env);
  if (!token) return [];
  const loc = near ? '&searchLocation=' + near[0] + ',' + near[1] : '';
  const get = async path => {
    const r = await fetch('https://maps-api.apple.com/v1/' + path + '?q=' + encodeURIComponent(q) + loc + '&lang=en-US',
      { headers: { authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error(path + ' status ' + r.status);
    return ((await r.json()).results || []).filter(x => x.coordinate).map(x => ({
      name: x.name || (x.formattedAddressLines || [])[0] || q,
      address: (x.formattedAddressLines || []).join(', '),
      lat: x.coordinate.latitude,
      lng: x.coordinate.longitude,
    }));
  };
  let results = await get('search');
  if (!results.length) results = await get('geocode');
  return results.slice(0, limit);
}

// { name, address } at a coordinate: Apple Maps, Photon as the fallback
async function reverseGeocode(env, at) {
  try {
    const token = await appleMapsToken(env);
    if (token) {
      const r = await fetch('https://maps-api.apple.com/v1/reverseGeocode?loc=' + at[0] + ',' + at[1] + '&lang=en-US',
        { headers: { authorization: 'Bearer ' + token } });
      if (!r.ok) throw new Error('status ' + r.status);
      const x = ((await r.json()).results || [])[0];
      if (x) return { name: x.name || '', address: (x.formattedAddressLines || []).join(', ') };
    }
  } catch (e) { console.warn('Apple reverse geocode failed: ' + e.message); }
  try {
    const d = await wFetchJson('https://photon.komoot.io/reverse?lat=' + at[0] + '&lon=' + at[1] + '&lang=en');
    const p = ((d.features || [])[0] || {}).properties;
    if (p) {
      const street = [p.housenumber, p.street].filter(Boolean).join(' ');
      return { name: p.name || street, address: [street, p.city || p.town || p.village, p.state, p.country].filter(Boolean).join(', ') };
    }
  } catch (e) {}
  return null;
}

// Share links only — this follows redirects, so it must not fetch arbitrary hosts
const MAP_LINK_HOSTS = /(^|\.)(goo\.gl|google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})|maps\.apple\.com|maps\.apple|apple\.co)$/i;

// Coordinates written into a maps URL. A Google place URL carries both the
// viewport centre (@lat,lng) and the place itself (!3dlat!4dlng) — prefer the place.
function coordsFromMapUrl(s) {
  const dec = (() => { try { return decodeURIComponent(s); } catch (e) { return s; } })();
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const pats = [
    new RegExp('!3d' + num + '!4d' + num),
    new RegExp('[?&](?:q|query|ll|sll|daddr|destination|coordinate|center)=' + num + '\\s*,\\s*' + num),
    new RegExp('/place/' + num + ',\\s*' + num),
    new RegExp('@' + num + ',' + num),
  ];
  for (const p of pats) {
    const m = dec.match(p);
    if (m) {
      const c = validNear([m[1], m[2]]);
      if (c) return c;
    }
  }
  return null;
}

// The place name a maps URL is about, for links that carry no coordinates
function placeNameFromMapUrl(s) {
  try {
    const u = new URL(s);
    const m = u.pathname.match(/\/maps\/place\/([^/]+)/);
    if (m) return decodeURIComponent(m[1].replace(/\+/g, ' '));
    const q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('name') || u.searchParams.get('address');
    return q ? q.trim() : null;
  } catch (e) { return null; }
}

async function resolveMapLink(env, link, near) {
  const direct = coordsFromMapUrl(link);
  if (direct) return { lat: direct[0], lng: direct[1], name: placeNameFromMapUrl(link) || '' };
  let cur;
  try { cur = new URL(link); } catch (e) { return null; }
  // Follow the share link's redirects by hand, staying on map hosts
  for (let hop = 0; hop < 6; hop++) {
    if (!/^https?:$/.test(cur.protocol) || !MAP_LINK_HOSTS.test(cur.hostname)) break;
    // Google's EU consent interstitial carries the real URL in ?continue=
    const cont = cur.hostname.startsWith('consent.') && cur.searchParams.get('continue');
    if (cont) { try { cur = new URL(cont); continue; } catch (e) { break; } }
    const c = coordsFromMapUrl(cur.href);
    if (c) return { lat: c[0], lng: c[1], name: placeNameFromMapUrl(cur.href) || '' };
    let r;
    try { r = await fetch(cur.href, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' } }); }
    catch (e) { break; }
    const loc = r.headers.get('location');
    if (!loc) break;
    try { cur = new URL(loc, cur.href); } catch (e) { break; }
  }
  const c = coordsFromMapUrl(cur.href);
  const name = placeNameFromMapUrl(cur.href);
  if (c) return { lat: c[0], lng: c[1], name: name || '' };
  if (name) {
    const [hit] = await placeSearch(env, name, near, 1);
    if (hit) return hit;
  }
  return null;
}

// People (with a registered device) who are on this trip: its creator, guests
// and users given it in User Access, and admins who ticked it under Settings →
// Notifications → Trips I'm on (notifyPrefs/{key}/trips). Being an admin alone
// doesn't count — admins can see every trip.
function tripRecipients(access, tokens, trip, tripId, prefsAll) {
  const owner = String(trip.ownerId || '').toLowerCase();
  return Object.keys(tokens || {}).filter(key => {
    const u = access[key];
    if (!u) return false;
    if (owner && owner === key.replace(/,/g, '.')) return true;
    if (u.role === 'admin') return !!(((prefsAll || {})[key] || {}).trips || {})[tripId];
    return !!(u.trips && u.trips[tripId]);
  });
}

// Where a reminder's Directions button goes: the activity's set pin, else
// where the app's drive-times map placed it, else a search for it and the city
function pushMapsTarget(a, day, geo) {
  const ok = c => c && typeof c.lat === 'number' && typeof c.lng === 'number';
  const stop = ((geo && geo.stops) || []).find(s => s.text === a.text && (s.time || '') === (a.time || ''));
  const c = ok(a.coords) ? a.coords : ok(stop) ? stop : null;
  if (c) return { lat: c.lat, lng: c.lng, name: c.name || a.text };
  const q = [a.text, day.city || day.description].filter(Boolean).join(', ');
  return q ? { q } : null;
}

async function runPushCron(env) {
  if (!pushConfigured(env)) return;
  const now = Date.now();
  const [trips, access, tokens, prefsAll, mutesAll, sent, geoAll, state] = await Promise.all([
    fbGet(env, 'trips'), fbGet(env, 'access'), fbGet(env, 'pushTokens'), fbGet(env, 'notifyPrefs'),
    fbGet(env, 'activityMutes'), fbGet(env, 'pushSent'), fbGet(env, 'pushGeo'), fbGet(env, 'pushState'),
  ].map(p => p.then(v => v || {})));
  const prefsOf = key => Object.assign({}, NOTIFY_DEFAULTS, prefsAll[key] || {});
  const tzCache = Object.assign({}, state.tz || {});
  const etaState = state.eta || {};
  const sentNow = {};
  const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
  const window3 = [isoDay(now - 864e5), isoDay(now), isoDay(now + 864e5)];

  const send = async (dedupe, key, msg) => {
    if (sent[dedupe] || sentNow[dedupe]) return;
    sentNow[dedupe] = now;
    await sendPushToUser(env, key, msg).catch(e => console.warn('push ' + dedupe + ': ' + e.message));
  };

  for (const [tripId, trip] of Object.entries(trips)) {
    if (!trip || !trip.days || trip.status === 'past') continue;
    const recipients = tripRecipients(access, tokens, trip, tripId, prefsAll);
    if (!recipients.length) continue;
    for (const [dayId, day] of Object.entries(trip.days)) {
      const dateISO = day && (day.dateISO || dayDateISO(day, trip.year));
      if (!dateISO || !window3.includes(dateISO)) continue;
      const acts = day.activities ? (Array.isArray(day.activities) ? day.activities : Object.values(day.activities)) : [];
      const geo = (geoAll[tripId] || {})[dayId] || null;
      const tz = await wDayTimeZone(env, day, geo, tzCache);
      if (!tz) continue;

      // Morning brief: on the day itself (local), from each person's briefTime
      // for up to 3 hours (a late cron or a later sign-in still gets it)
      if (isoInTz(now, tz) === dateISO) {
        const localNow = localHHMM(now, tz);
        const due = recipients.filter(k => {
          const p = prefsOf(k);
          return p.brief && localNow >= p.briefTime && localNow < addHHMM(p.briefTime, 180) && !sent['brief_' + tripId + '_' + dateISO + '_' + k];
        });
        if (due.length) {
          const brief = await buildMorningBrief(env, trip, dayId, day, acts, dateISO, tz);
          for (const k of due) await send('brief_' + tripId + '_' + dateISO + '_' + k, k, Object.assign({ route: { screen: 'trip', tripId }, threadId: tripId }, brief));
        }
      }
      if (!acts.some(a => a && a.time)) continue;

      for (const a of acts) {
        if (!a || typeof a !== 'object' || !a.time || !a.text) continue;
        const startMin = wActStartMinutes(a.time);
        if (startMin == null) continue;
        const start = zonedToUtc(dateISO, startMin, tz);
        if (start <= now || start - now > PUSH_ETA_HORIZON_MIN * 60000) continue;
        const actId = pushActId(tripId, dateISO, a);
        const route = { screen: 'trip', tripId };
        const who = recipients.filter(k => !((mutesAll[k] || {})[actId]));
        if (!who.length) continue;
        // For the Directions and Mute buttons on these reminders
        const act = { id: actId, tripId, name: a.text, maps: pushMapsTarget(a, day, geo) };

        // Leave-by for drives with a saved stop and origin
        let leave = null;
        const stop = a.drive && geo && (geo.stops || []).find(s => s.text === a.text && (s.time || '') === (a.time || '') && s.from);
        if (stop) {
          let st = etaState[actId];
          const age = st ? now - st.at : Infinity;
          const due = (start - now <= 90 * 60000) ? 15 * 60000 : 60 * 60000;
          if (age >= due) {
            const eta = await driveEtaSeconds(env, stop.from, stop);
            if (eta) {
              st = Object.assign({}, st || {}, eta, { at: now });
              etaState[actId] = st;
              await fbWrite(env, 'PUT', 'pushState/eta/' + actId, st).catch(() => {});
            }
          }
          if (st && st.sec) {
            const leaveAt = start - st.sec * 1000 - PUSH_LEAVE_BUFFER_MIN * 60000;
            leave = { st, leaveAt, mins: Math.max(1, Math.round(st.sec / 60)) };
          }
        }

        for (const key of who) {
          const prefs = prefsOf(key);
          if (leave && prefs.leaveBy) {
            const { st, leaveAt, mins } = leave;
            const traffic = st.src === 'apple' ? ' with current traffic' : '';
            const dest = (stop.name || a.text);
            if (now >= leaveAt - 5 * 60000) {
              const late = now >= leaveAt;
              const sentKey = 'leave_' + actId + '_' + key;
              if (!sent[sentKey]) {
                await send(sentKey, key, {
                  title: late ? '🚗 Time to leave' : '🚗 Leave by ' + fmtLocalTime(leaveAt, tz),
                  body: dest + ' at ' + a.time + '\n' + mins + ' min drive' + traffic,
                  route, threadId: tripId, timeSensitive: true, collapseId: actId,
                  category: 'ACTIVITY', act,
                });
                await fbWrite(env, 'PUT', 'pushState/eta/' + actId + '/notifiedSec', st.sec).catch(() => {});
              } else if (st.notifiedSec && st.sec >= st.notifiedSec + 600) {
                await send('worse_' + actId + '_' + key, key, {
                  title: '🚦 Traffic got worse',
                  body: 'Now ' + mins + ' min — leave ' + (late ? 'now' : 'by ' + fmtLocalTime(leaveAt, tz)) + '\n' + dest + ' at ' + a.time,
                  route, threadId: tripId, timeSensitive: true, collapseId: actId,
                  category: 'ACTIVITY', act,
                });
              }
            }
            continue;   // the leave-by covers this activity
          }
          if (!prefs.activities) continue;
          const lead = parseInt(prefs.activityLeadMin, 10) || 30;
          if (now < start - lead * 60000) continue;
          if (inQuietHours(prefs, now, tz)) continue;   // held; sent when quiet hours end, if still ahead
          const mins = Math.max(1, Math.round((start - now) / 60000));
          await send('act_' + actId + '_' + key, key, {
            // iOS shows one title line and ~4 body lines: keep the title short
            // and let the activity's name wrap in the body
            title: (a.emoji ? a.emoji + ' ' : '⏰ ') + 'In ' + mins + ' min · ' + a.time,
            body: a.text,
            route, threadId: tripId, collapseId: actId,
            category: 'ACTIVITY', act,
          });
        }
      }
    }
  }

  // Flights and trip-change digests, per trip
  for (const [tripId, trip] of Object.entries(trips)) {
    if (!trip || trip.status === 'past') continue;
    const recipients = tripRecipients(access, tokens, trip, tripId, prefsAll);
    if (!recipients.length) continue;
    try { await runFlightAlerts(env, tripId, trip, recipients, prefsOf, state.flights || {}, send, now); }
    catch (e) { console.warn('flights ' + tripId + ': ' + e.message); }
    try { await runEditDigest(env, tripId, trip, recipients, access, prefsOf, (state.editCursor || {})[tripId], send, now); }
    catch (e) { console.warn('edits ' + tripId + ': ' + e.message); }
  }

  if (Object.keys(sentNow).length) await fbWrite(env, 'PATCH', 'pushSent', sentNow).catch(e => console.warn('pushSent: ' + e.message));

  // Hourly: forget scheduled-push records older than 3 days (and their ETAs)
  if (new Date(now).getUTCMinutes() < 5) {
    const old = {};
    for (const [k, t] of Object.entries(sent)) if (/^(act|leave|worse|brief|checkin|flt|edits)_/.test(k) && t < now - 3 * 864e5) old[k] = null;
    if (Object.keys(old).length) await fbWrite(env, 'PATCH', 'pushSent', old).catch(() => {});
    const oldEta = {};
    for (const [k, v] of Object.entries(etaState)) if (!v || v.at < now - 864e5) oldEta[k] = null;
    if (Object.keys(oldEta).length) await fbWrite(env, 'PATCH', 'pushState/eta', oldEta).catch(() => {});
  }
}

const isoInTz = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
function addHHMM(hhmm, mins) {
  const [h, m] = String(hhmm || '07:30').split(':').map(Number);
  const t = Math.min(h * 60 + m + mins, 24 * 60 - 1);
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

// WMO weather codes (Open-Meteo), condensed — same groups as the app's icons
function wWeatherText(code) {
  if (code === 0) return '☀️ Clear';
  if (code <= 2) return '🌤️ Partly cloudy';
  if (code === 3) return '☁️ Cloudy';
  if (code <= 48) return '🌫️ Fog';
  if (code <= 57) return '🌦️ Drizzle';
  if (code <= 67) return '🌧️ Rain';
  if (code <= 77) return '🌨️ Snow';
  if (code <= 82) return '🌧️ Showers';
  if (code <= 86) return '🌨️ Snow showers';
  return '⛈️ Storms';
}

// Title "☀️ Day 2 · Paris"; body one item per line, in the order iOS shows
// before a long-press: the day's description, the weather, then activities.
//   Louvre & the Marais
//   🌤️ Partly cloudy · 81°/60°
//   🖼️ 10am Louvre
//   🍽️ 7:30pm Dinner at Septime
async function buildMorningBrief(env, trip, dayId, day, acts, dateISO, tz) {
  const ordered = Object.entries(trip.days).map(([id, d]) => [id, d.dateISO || dayDateISO(d, trip.year) || '']).sort((a, b) => a[1].localeCompare(b[1]));
  const dayNum = ordered.findIndex(([id]) => id === dayId) + 1;
  const city = wCleanCity(day.city) || wCleanCity(day.region) || trip.name || 'your trip';
  const lines = [];
  const desc = String(day.description || '').trim();
  if (desc && desc.toLowerCase() !== city.toLowerCase()) lines.push(desc);
  try {
    const place = wCleanCity(day.city) || wCleanCity(day.region);
    const c = place && !wIsNonPlace(place) ? await wCityCoords(place, env) : null;
    if (c) {
      const w = await wFetchJson('https://api.open-meteo.com/v1/forecast?latitude=' + c.lat + '&longitude=' + c.lon +
        '&daily=weathercode,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&start_date=' + dateISO + '&end_date=' + dateISO);
      const d = w && w.daily;
      if (d && d.weathercode && d.weathercode.length) {
        lines.push(wWeatherText(d.weathercode[0]) + ' · ' + Math.round(d.temperature_2m_max[0]) + '°/' + Math.round(d.temperature_2m_min[0]) + '°');
      }
    }
  } catch (e) {}
  const plans = acts.filter(a => a && (typeof a === 'string' ? a.trim() : a.text));
  const startOf = a => typeof a === 'object' ? wActStartMinutes(a.time) : null;
  // Timed activities in time order, then untimed ones in itinerary order
  const sorted = plans.map((a, i) => ({ a, i, t: startOf(a) }))
    .sort((x, y) => (x.t == null) - (y.t == null) || (x.t != null ? x.t - y.t : x.i - y.i))
    .map(x => x.a);
  if (sorted.length) {
    sorted.forEach(a => {
      if (typeof a === 'string') { lines.push('• ' + a.trim()); return; }
      lines.push((a.emoji ? a.emoji + ' ' : '• ') + (a.time ? a.time + ' ' : '') + a.text);
    });
  } else lines.push('Free day — nothing planned');
  return { title: '☀️ Day ' + (dayNum || '') + ' · ' + city, body: lines.join('\n'), collapseId: 'brief_' + dateISO };
}

// ── Flights ──
// Legs come from trip.flightOut / flightReturn (one "UA100 DEN → LIS · 8:00am
// – 10:00pm" per line) and each day's flightInfo. A day before departure the
// Worker looks the leg up on AeroDataBox (same source as /flight-lookup) to
// learn its real times; it polls again only in the 4 hours before departure,
// so a leg costs about ten lookups.

function tripFlightLegs(trip) {
  const legs = [];
  const add = (formatted, dateISO, idx) => {
    const m = String(formatted || '').trim().match(/^([A-Z0-9]{2}\s?\d{1,4}[A-Z]?)\b/i);
    if (m && /^\d{4}-\d{2}-\d{2}$/.test(dateISO || '')) legs.push({ num: m[1].replace(/\s+/g, '').toUpperCase(), dateISO, idx, formatted });
  };
  const named = (label, fallback) => {
    if (!label) return fallback;
    const [mon, num] = String(label).trim().split(/\s+/);
    return dayDateISO({ dateMonth: mon, dateNum: num }, trip.year) || fallback;
  };
  const outISO = named(trip.flightOutDate, wTripStartISO(trip));
  const retISO = named(trip.flightReturnDate, wTripEndISO(trip));
  String(trip.flightOut || '').split('\n').filter(Boolean).forEach((f, i) => add(f, outISO, i));
  String(trip.flightReturn || '').split('\n').filter(Boolean).forEach((f, i) => add(f, retISO, i));
  Object.values(trip.days || {}).forEach(d => {
    if (!d || !d.flightInfo) return;
    (Array.isArray(d.flightInfo) ? d.flightInfo : [d.flightInfo]).forEach((fi, i) => fi && add(fi.formatted, d.dateISO || dayDateISO(d, trip.year), i));
  });
  return legs;
}

const aeroUtc = t => { const m = String(t || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/); return m ? Date.parse(m[1] + 'T' + m[2] + ':00Z') : null; };
const aeroLocal = t => {
  const m = String(t || '').match(/[ T](\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = +m[1];
  return (h % 12 || 12) + ':' + m[2] + (h < 12 ? 'am' : 'pm');
};

async function lookupFlight(env, num, dateISO) {
  if (!env.AERODATABOX_KEY) return null;
  const r = await fetch('https://aerodatabox.p.rapidapi.com/flights/number/' + encodeURIComponent(num) + '/' + dateISO,
    { headers: { 'X-RapidAPI-Key': env.AERODATABOX_KEY, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' } });
  if (!r.ok) return null;
  const list = await r.json().catch(() => null);
  const f = Array.isArray(list) ? list[0] : list;
  if (!f || !f.departure) return null;
  const dep = f.departure, arr = f.arrival || {};
  const best = x => (x.revisedTime || x.predictedTime || x.scheduledTime || {});
  return {
    from: (dep.airport && dep.airport.iata) || '', to: (arr.airport && arr.airport.iata) || '',
    schedUtc: aeroUtc((dep.scheduledTime || {}).utc), depUtc: aeroUtc(best(dep).utc),
    schedLocal: aeroLocal((dep.scheduledTime || {}).local), depLocal: aeroLocal(best(dep).local),
    gate: dep.gate || '', terminal: dep.terminal || '',
    status: String(f.status || ''),
  };
}

async function runFlightAlerts(env, tripId, trip, recipients, prefsOf, flightState, send, now) {
  const who = recipients.filter(k => prefsOf(k).flights);
  if (!who.length) return;
  const today = new Date(now).toISOString().slice(0, 10);
  for (const leg of tripFlightLegs(trip)) {
    const key = (leg.num + '_' + leg.dateISO).replace(/[^A-Za-z0-9_-]/g, '');
    let st = flightState[key] || null;
    // Only legs from yesterday (still in the air) to tomorrow (check-in)
    const dayDiff = (Date.parse(leg.dateISO) - Date.parse(today)) / 864e5;
    if (dayDiff < -1 || dayDiff > 1) continue;
    if (st && st.depUtc && now > st.depUtc + 3 * 3600e3) continue;   // long gone

    const depAt = st && (st.depUtc || st.schedUtc);
    const pollEvery = depAt && depAt - now <= 4 * 3600e3 && now <= depAt + 30 * 60000 ? 20 * 60000 : 12 * 3600e3;
    if (!st || now - (st.at || 0) >= pollEvery) {
      let info = await lookupFlight(env, leg.num, leg.dateISO).catch(() => null);
      // A later leg of a connection can leave the next day
      if (!info && leg.idx > 0) {
        const next = new Date(Date.parse(leg.dateISO) + 864e5).toISOString().slice(0, 10);
        info = await lookupFlight(env, leg.num, next).catch(() => null);
      }
      const prev = st || {};
      st = Object.assign({}, prev, info || {}, { at: now });
      await fbWrite(env, 'PUT', 'pushState/flights/' + key, st).catch(() => {});
      if (info) {
        const label = info.from && info.to ? info.from + ' → ' + info.to : leg.num;
        const route = { screen: 'trip', tripId };
        const msgs = [];
        const delayMin = info.depUtc && info.schedUtc ? Math.round((info.depUtc - info.schedUtc) / 60000) : 0;
        if (/cancel/i.test(info.status) && !/cancel/i.test(prev.status || '')) {
          msgs.push(['flt_cancel_' + key, { title: '❌ ' + leg.num + ' canceled', body: label + '\nCheck the airline app to rebook.', timeSensitive: true }]);
        } else {
          if (delayMin >= 15 && Math.abs(delayMin - (prev.notifiedDelay || 0)) >= 15) {
            msgs.push(['flt_delay_' + key + '_' + delayMin, { title: '⏱️ ' + leg.num + ' delayed ' + delayMin + ' min',
              body: label + '\nNow departs ' + info.depLocal + ' (was ' + info.schedLocal + ')', timeSensitive: true }]);
            st.notifiedDelay = delayMin;
          } else if (prev.notifiedDelay >= 15 && delayMin < 15) {
            msgs.push(['flt_ontime_' + key + '_' + now, { title: '✅ ' + leg.num + ' back on time', body: label + '\nDeparts ' + info.depLocal }]);
            st.notifiedDelay = 0;
          }
          if (info.gate && prev.gate && info.gate !== prev.gate) {
            msgs.push(['flt_gate_' + key + '_' + info.gate, { title: '🚪 ' + leg.num + ' now gate ' + info.gate,
              body: label + '\nGate ' + prev.gate + ' → ' + info.gate + (info.terminal ? ' · terminal ' + info.terminal : ''), timeSensitive: true }]);
          } else if (info.gate && !prev.gate && info.depUtc && info.depUtc - now < 4 * 3600e3) {
            msgs.push(['flt_gate_' + key + '_' + info.gate, { title: '🚪 ' + leg.num + ' gate ' + info.gate,
              body: label + '\nDeparts ' + info.depLocal + (info.terminal ? ' · terminal ' + info.terminal : '') }]);
          }
        }
        for (const [id, msg] of msgs) for (const k of who) await send(id + '_' + k, k, Object.assign({ route, threadId: 'flt_' + key, collapseId: 'flt_' + key }, msg));
        if (msgs.length) await fbWrite(env, 'PUT', 'pushState/flights/' + key, st).catch(() => {});
      }
    }

    // Check-in opens ~24h before departure
    const dep = st && (st.depUtc || st.schedUtc);
    if (dep && now >= dep - 24 * 3600e3 && now < dep - 3 * 3600e3) {
      for (const k of who) await send('checkin_' + key + '_' + k, k, {
        title: '✈️ Check in: ' + leg.num,
        body: (st.from && st.to ? st.from + ' → ' + st.to + '\n' : '') + 'Departs ' + (st.depLocal || st.schedLocal || '') + ' local time\nOnline check-in is usually open now',
        route: { screen: 'trip', tripId }, threadId: 'flt_' + key,
      });
    }
  }
}

// ── Trip-change digest ──
// trips/{id}/changeLog entries ({ts, action, detail, user, by}) are bundled:
// once nobody has edited a trip for 10 minutes, everyone else on it gets one
// push for the batch. `by` (the editor's email) is newer; older entries only
// carry a display name, matched against access names.
async function runEditDigest(env, tripId, trip, recipients, access, prefsOf, cursor, send, now) {
  const log = Object.values(trip.changeLog || {}).filter(e => e && e.ts);
  if (cursor == null) {   // first sight of this trip: start from now, don't replay history
    await fbWrite(env, 'PUT', 'pushState/editCursor/' + tripId, now);
    return;
  }
  const fresh = log.filter(e => e.ts > cursor).sort((a, b) => a.ts - b.ts);
  if (!fresh.length || fresh[fresh.length - 1].ts > now - 10 * 60000) return;   // still being edited
  await fbWrite(env, 'PUT', 'pushState/editCursor/' + tripId, fresh[fresh.length - 1].ts);
  const tripName = trip.name || 'a trip';
  for (const k of recipients) {
    if (!prefsOf(k).tripEdits) continue;
    const myEmail = k.replace(/,/g, '.');
    const myName = String((access[k] || {}).name || '').toLowerCase();
    const others = fresh.filter(e => e.by ? String(e.by).toLowerCase() !== myEmail : String(e.user || '').toLowerCase() !== myName);
    if (!others.length) continue;
    const names = [...new Set(others.map(e => e.user || 'Someone'))];
    const lines = others.slice(0, 3).map(e => e.action + (e.detail ? ': ' + e.detail : ''));
    if (others.length > 3) lines.push('+' + (others.length - 3) + ' more');
    await send('edits_' + tripId + '_' + fresh[fresh.length - 1].ts + '_' + k, k, {
      title: '✏️ ' + tripName + ': ' + (others.length === 1 ? '1 change' : others.length + ' changes') + ' by ' + names.join(' & '),
      body: lines.join('\n'),
      route: { screen: 'trip', tripId, tab: 'changes' },
      threadId: tripId,
    });
  }
}
