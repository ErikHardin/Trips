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

    // Driving overview widget — day-by-day drive list for active trip
    if (url.pathname === '/widget-driving') {
      return handleWidgetDriving(env, request);
    }

    // All other routes expect a JSON POST body
    const body = await request.json();

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

  const { trip: chosen, error } = await fetchChosenTrip(env);
  if (error) {
    return new Response(JSON.stringify({ trip: null, today: null, error }), { headers: CORS });
  }
  if (!chosen) {
    return new Response(JSON.stringify({ trip: null, today: null }), { headers: CORS });
  }

  const todayISO = (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam))
    ? dateParam
    : new Date().toISOString().slice(0, 10);

  let daysUntil = null;
  if (chosen.startDateISO) {
    const msPerDay = 86400000;
    daysUntil = Math.max(0, Math.ceil((new Date(chosen.startDateISO + 'T00:00:00Z') - Date.now()) / msPerDay));
  }

  const spend = tripSpend(chosen);

  const tripInfo = {
    name:          chosen.name || '',
    emoji:         chosen.emoji || '✈️',
    status:        chosen.status,
    startDateISO:  chosen.startDateISO || null,
    daysUntil,
    flightOut:     chosen.flightOut     || null,
    flightOutDate: chosen.flightOutDate || null,
    // Destination of this trip — lets the widget look up the local clock and
    // weather for whatever trip is current, with nothing hardcoded in it.
    destination:   tripDestination(chosen, todayISO),
    currency:      chosen.currency || null,
    spendTotal:    spend,
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

// ── Trip lookup ───────────────────────────────────────────────────────────────

// Whichever trip the widgets should show: an active trip wins, otherwise the
// soonest upcoming one.
function chooseTrip(trips) {
  const active = trips.find(t => t && t.status === 'active');
  if (active) return active;
  return trips
    .filter(t => t && t.status === 'upcoming' && t.startDateISO)
    .sort((a, b) => a.startDateISO.localeCompare(b.startDateISO))[0] || null;
}

// Load the current trip. Listing /trips needs a signed-in user, so that path
// only works when FIREBASE_SECRET is configured. Without it we fall back to
// /widgetIndex — a world-readable pointer the app keeps up to date — and then
// read that one trip, which is world-readable by id.
async function fetchChosenTrip(env) {
  if (!env.FIREBASE_URL) return { trip: null, error: 'FIREBASE_URL not configured' };

  if (env.FIREBASE_SECRET) {
    try {
      const resp = await fetch(env.FIREBASE_URL + '/trips.json?auth=' + env.FIREBASE_SECRET);
      if (resp.ok) {
        const trips = await resp.json();
        return { trip: chooseTrip(Object.values(trips || {})) };
      }
    } catch (e) { /* fall through to the public index */ }
  }

  try {
    const idxResp = await fetch(env.FIREBASE_URL + '/widgetIndex.json');
    if (!idxResp.ok) {
      return { trip: null, error: 'Firebase fetch failed: status ' + idxResp.status };
    }
    const index = await idxResp.json();
    if (!index || !index.tripId) return { trip: null };

    const tripResp = await fetch(env.FIREBASE_URL + '/trips/' + encodeURIComponent(index.tripId) + '.json');
    if (!tripResp.ok) {
      return { trip: null, error: 'Firebase fetch failed: status ' + tripResp.status };
    }
    const trip = await tripResp.json();
    if (!trip) return { trip: null };
    return { trip: chooseTrip([trip]) };
  } catch (e) {
    return { trip: null, error: 'Firebase fetch failed: ' + e.message };
  }
}

// Where the trip is on the given date — falls back to the first day's city so
// upcoming trips still have a destination to show.
function tripDestination(trip, todayISO) {
  const days = Object.values(trip.days || {})
    .map(d => ({ iso: d.dateISO || dayDateISO(d, trip.year), day: d }))
    .filter(d => d.iso)
    .sort((a, b) => a.iso.localeCompare(b.iso));
  if (!days.length) return trip.name || '';
  // The day itself, else the next one coming up, else the trip's last day
  const match = days.find(d => d.iso >= todayISO) || days[days.length - 1];
  return match.day.description || match.day.city || trip.name || '';
}

// Total logged spend for the trip, in the trip's own currency
function tripSpend(trip) {
  const tracked = Object.values(trip.days || {}).filter(d => d && d.dailySpend != null);
  if (!tracked.length) return null;
  return tracked.reduce((sum, d) => sum + (Number(d.dailySpend) || 0), 0);
}

async function handleWidgetDriving(env, request) {
  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const auth = env.FIREBASE_SECRET ? '?auth=' + env.FIREBASE_SECRET : '';
  const [{ trip: chosen, error }, geocache] = await Promise.all([
    fetchChosenTrip(env),
    env.FIREBASE_URL
      ? fetch(env.FIREBASE_URL + '/geocache.json' + auth).then(r => r.ok ? r.json() : null).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (error) {
    return new Response(JSON.stringify({ trip: null, days: [], error }), { headers: CORS });
  }

  if (!chosen) {
    return new Response(JSON.stringify({ trip: null, days: [] }), { headers: CORS });
  }

  const tripInfo = {
    name:   chosen.name   || '',
    emoji:  chosen.emoji  || '✈️',
    status: chosen.status,
  };

  const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Build sorted day list
  const sortedDays = [];
  if (chosen.days) {
    for (const day of Object.values(chosen.days)) {
      const iso = day.dateISO || dayDateISO(day, chosen.year);
      if (!iso) continue;
      sortedDays.push({ iso, day });
    }
  }
  sortedDays.sort((a, b) => a.iso.localeCompare(b.iso));

  // Compute drive days and OSRM routes in parallel
  const days = await Promise.all(sortedDays.map(async ({ iso, day }, idx) => {
    const rawActs = day.activities
      ? (Array.isArray(day.activities) ? day.activities : Object.values(day.activities))
      : [];

    const drives = rawActs
      .filter(a => a && a.drive)
      .map(a => ({ time: a.time || '', text: a.text || a.description || '' }));

    const d = new Date(iso + 'T00:00:00Z');
    const result = {
      dateISO:   iso,
      dateLabel: WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate(),
      city:      day.city || '',
      drives,
      totalDrive: null,
      legTimes:   {},
    };

    if (drives.length === 0) return result;

    // Build waypoints
    const driveActs = rawActs.filter(a => a && a.drive);
    const prevDay   = idx > 0 ? sortedDays[idx - 1].day : null;
    const context   = [day.city, day.region].filter(Boolean).join(', ');
    const wayptSrcs = [];

    const startCoord = wCityCoord(prevDay, geocache);
    if (startCoord) wayptSrcs.push({ coord: startCoord, actIdx: -1 });

    driveActs.forEach((a, i) => {
      let coord = null;
      if (a.coords?.lat != null) {
        coord = [a.coords.lat, a.coords.lng];
      } else if (a.text) {
        coord = wGcCoord(wExtractPlace(a.text) + (context ? ', ' + context : ''), geocache);
      }
      if (coord) wayptSrcs.push({ coord, actIdx: i });
    });

    const endCoord = wCityCoord(day, geocache);
    if (endCoord) wayptSrcs.push({ coord: endCoord, actIdx: -1 });

    const deduped = wayptSrcs.filter((w, i) =>
      !i || !(w.coord[0] === wayptSrcs[i-1].coord[0] && w.coord[1] === wayptSrcs[i-1].coord[1])
    );
    if (deduped.length < 2) return result;

    const { total, legs } = await wOsrmRoute(deduped.map(w => w.coord));
    if (total <= 600) return result;

    const legMap = {};
    for (let i = 1; i < deduped.length; i++) {
      const { actIdx } = deduped[i];
      if (actIdx >= 0 && legs[i - 1] > 60)
        legMap[actIdx] = wFmtSecs(legs[i - 1]);
    }

    result.totalDrive = wFmtSecs(total);
    result.legTimes   = legMap;
    return result;
  }));

  return new Response(JSON.stringify({ trip: tripInfo, days }), { headers: CORS });
}

// ── Worker-side drive-time helpers ────────────────────────────────────────────

const W_KNOWN_COORDS = {
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
  'hluhluwe':[-28.02,32.27],'durban':[-29.86,31.02],
  'maldives':[3.20,73.22],'washington dc':[38.91,-77.04],
  'chiang mai':[18.79,98.98],'bangkok':[13.75,100.50],'hoi an':[15.88,108.34],
  'queenstown':[-45.03,168.66],'porto':[41.16,-8.62],'lisbon':[38.72,-9.14],
  'douro valley':[41.16,-7.75],'melbourne':[-37.81,144.96],'hobart':[-42.88,147.33],
};

const W_VERB_RE = /^(explore|drive along|drive to|drive|visit|hike to|hike|see|walk to|walk|bike to|cycle to|go to|head to|stop at|stop in|lunch at|dinner at|breakfast at|brunch at|drinks at|swim at|relax at|check into|check in at|arrive at|arrive in|tasting at|tasting in)\s+/i;
function wExtractPlace(text) {
  let s = text.trim().replace(W_VERB_RE, '');
  s = s.split(/\s*[–—]\s*/)[0];
  s = s.split('(')[0].trim();
  s = s.split(/\s+(?:and|&)\s+/i)[0].trim();
  if (s.includes(',')) s = s.split(',')[0].trim();
  return s;
}

function wGcCoord(query, gc) {
  if (!gc || !query) return null;
  const key = query.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const entry = gc[key];
  if (entry?.lat != null && (entry.v || 0) >= 2) return [entry.lat, entry.lng];
  return null;
}

function wCityCoord(day, gc) {
  if (!day) return null;
  const name = (day.region || day.city || '').split(/[·,]/)[0].trim();
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(W_KNOWN_COORDS)) {
    if (lower === k || lower.includes(k) || k.includes(lower)) return v;
  }
  return wGcCoord(name, gc);
}

async function wOsrmRoute(pts) {
  const coords = pts.map(p => p[1] + ',' + p[0]).join(';');
  try {
    const r = await fetch(
      'https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=false'
    ).then(res => res.json());
    if (!r.routes?.[0]) return { total: 0, legs: [] };
    return {
      total: Math.round(r.routes[0].duration),
      legs:  r.routes[0].legs.map(l => Math.round(l.duration)),
    };
  } catch(e) { return { total: 0, legs: [] }; }
}

function wFmtSecs(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h === 0) return m + 'm';
  if (m === 0) return h + 'h';
  return h + 'h ' + m + 'm';
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
