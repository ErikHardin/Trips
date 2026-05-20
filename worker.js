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
