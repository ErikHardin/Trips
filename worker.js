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

    // All other routes expect a JSON POST body
    const body = await request.json();

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

  const limitParam = parseInt(new URL(request.url).searchParams.get('limit'), 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 10) : 3;

  const auth = env.FIREBASE_SECRET ? '?auth=' + env.FIREBASE_SECRET : '';
  let trips, tracker;
  try {
    [trips, tracker] = await Promise.all([
      wFetchJson(env.FIREBASE_URL + '/trips.json'         + auth),
      wFetchJson(env.FIREBASE_URL + '/travelTracker.json' + auth),
    ]);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Firebase fetch failed: ' + e.message }), { status: 502, headers: CORS });
  }

  const now      = new Date();
  const todayMs  = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayISO = new Date(todayMs).toISOString().slice(0, 10);

  // Trips still ahead of (or currently under way) — soonest first
  const upcoming = Object.values(trips || {})
    .filter(t => t && (t.status === 'upcoming' || t.status === 'active'))
    .map(t => ({ t, startISO: wTripStartISO(t) }))
    .filter(x => x.startISO)
    .sort((a, b) => a.startISO.localeCompare(b.startISO))
    .slice(0, limit)
    .map(({ t, startISO }) => ({
      name:         t.name || 'Untitled trip',
      emoji:        t.emoji || '✈️',
      status:       t.status,
      dates:        t.dates || '',
      startDateISO: startISO,
      daysUntil:    Math.max(0, Math.round((Date.parse(startISO + 'T00:00:00Z') - todayMs) / 86400000)),
    }));

  // Travel-tracker trips departing in the next 6 months that still need a booking.
  // Mirrors computeOutstandingBookings() in the app so the widget and the
  // "Outstanding Travel Bookings" popup always agree.
  const windowEndMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 6, now.getUTCDate());
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
    trips: upcoming,
    outstanding: pending.map(({ name, dates, missing }) => ({ name, dates, missing })),
  }), { headers: CORS });
}

// Bump this whenever worker.js changes, so a deployed build can be identified
// from outside Cloudflare. GET /version reports it alongside the routes this
// build serves — if the list is missing a route you expect, the deployed Worker
// is stale and needs re-pasting.
const WORKER_VERSION = '2026-09-06';

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

  return new Response(JSON.stringify({
    version: WORKER_VERSION,
    routes:  WORKER_ROUTES,
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
