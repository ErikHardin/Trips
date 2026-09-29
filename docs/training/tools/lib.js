// Launches the app against an in-memory fake of Firebase so screenshots never touch
// the production database. Only static assets (Leaflet, fonts, map tiles, weather) are
// allowed out; everything else (Firebase, the AI worker, ntfy, geocoders) is blocked.
// External assets are fetched via curl so they go through the system CA store.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const FAKE = fs.readFileSync(path.join(__dirname, 'fakefb.js'), 'utf8');
const ALLOW = /^https?:\/\/(127\.0\.0\.1|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|[a-d]\.basemaps\.cartocdn\.com|api\.open-meteo\.com|archive-api\.open-meteo\.com)(\/|:|$)/;
const blocked = new Set();
const { execFile } = require('child_process');
const crypto = require('crypto');
const CACHE = process.env.SHOOT_CACHE || path.join(require('os').tmpdir(), 'trips-shoot-cache');
fs.mkdirSync(CACHE, { recursive: true });
const inflight = new Map();
function curl(u) { if (!inflight.has(u)) inflight.set(u, curl0(u).finally(() => inflight.delete(u))); return inflight.get(u); }
function curl0(u) {
  const f = path.join(CACHE, crypto.createHash('md5').update(u).digest('hex'));
  if (fs.existsSync(f + '.json')) return Promise.resolve({ body: fs.readFileSync(f + '.body'), meta: JSON.parse(fs.readFileSync(f + '.json')) });
  return new Promise(res => execFile('curl', ['-sSL', '--max-time', '20', '-A', 'Mozilla/5.0 TripsTrainingGuide', '-o', f + '.tmp', '-w', '%{http_code} %{content_type}', u], (err, out) => {
    const [code, ...ct] = String(out).split(' ');
    const meta = { status: Number(code) || 502, contentType: ct.join(' ') || 'application/octet-stream' };
    const body = fs.existsSync(f + '.tmp') ? fs.readFileSync(f + '.tmp') : Buffer.alloc(0);
    if (!err && meta.status === 200) { fs.renameSync(f + '.tmp', f + '.body'); fs.writeFileSync(f + '.json', JSON.stringify(meta)); } else try { fs.unlinkSync(f + '.tmp'); } catch (e) {}
    res({ body, meta });
  }));
}
async function launch({ user, seed, url = 'http://127.0.0.1:8901/index.html', w = 390, h = 844 }) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, timezoneId: 'Europe/Lisbon', locale: 'en-US', serviceWorkers: 'block' });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('https://www.gstatic.com/firebasejs/')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE });
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return route.continue();
    if (ALLOW.test(u) && route.request().method() === 'GET') return curl(u).then(({ body, meta }) => route.fulfill({ status: meta.status, contentType: meta.contentType, body, headers: { 'access-control-allow-origin': '*' } }));
    blocked.add(new URL(u).host);
    return route.abort();
  });
  await ctx.addInitScript(({ user, seed }) => {
    window.__fakeUser = user;
    window.__fake = { root: seed, listeners: [], keyN: 0 };
  }, { user, seed });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto(url);
  await page.waitForTimeout(2500);
  return { browser, ctx, page, blocked };
}
module.exports = { launch, blocked };
