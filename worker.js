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
const WORKER_VERSION = '2026-09-07.1';

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
