// Renders ../README.md (with its screenshots) to ../Hardin-Trips-Training-Guide.pdf.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const { curl } = require('./lib');

const DIR = path.join(__dirname, '..');
const OUT = path.join(DIR, 'Hardin-Trips-Training-Guide.pdf');

const CSS = `
  @page { size: Letter; margin: 0.6in 0.65in 0.7in; }
  :root { --ink:#2a2520; --muted:#8a7e72; --terracotta:#c06a3d; --sand:#f3ece3; --border:#e4dbcf; }
  * { box-sizing: border-box; }
  body { font-family: 'DM Sans', 'Liberation Sans', sans-serif; color: var(--ink); font-size: 10.5pt; line-height: 1.5; margin: 0; }
  h1, h2, h3 { font-family: 'Cormorant Garamond', 'Liberation Serif', serif; font-weight: 600; line-height: 1.15; }
  h1 { font-size: 34pt; margin: 0 0 6pt; }
  h2 { font-size: 22pt; color: var(--terracotta); margin: 0 0 10pt; padding-bottom: 4pt; border-bottom: 1px solid var(--border); margin-top: 26pt; break-after: avoid; }
  h2.newpage { break-before: page; margin-top: 0; }
  h3 { font-size: 15pt; margin: 18pt 0 6pt; break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  a { color: var(--terracotta); text-decoration: none; }
  code { font-size: 9pt; background: var(--sand); padding: 1px 4px; border-radius: 3px; }
  blockquote { margin: 10pt 0; padding: 8pt 12pt; background: var(--sand); border-left: 3px solid var(--terracotta); border-radius: 4px; color: var(--muted); }
  blockquote p { margin: 0; }
  hr { display: none; }
  img { border: 1px solid var(--border); border-radius: 10px; break-inside: avoid; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .row { display: flex; gap: 16pt; align-items: flex-start; break-inside: avoid; margin: 0 0 14pt; }
  .row > .txt { flex: 1; min-width: 0; }
  .row > .txt > :first-child { margin-top: 0; }
  .row > img, img.solo { width: 1.8in; flex: none; height: auto; }
  img.solo { display: block; margin: 0 0 14pt auto; }
  table { border-collapse: collapse; margin: 8pt 0 12pt; font-size: 9.5pt; break-inside: avoid; }
  th, td { border: 1px solid var(--border); padding: 4pt 8pt; vertical-align: top; }
  th { background: var(--sand); text-align: left; }
  td img { width: 2.2in !important; border-radius: 8px; }
  .cover { height: 9.4in; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
  .cover .logo { font-family: 'Cormorant Garamond', serif; font-size: 52pt; font-weight: 600; }
  .cover .logo em { color: var(--terracotta); }
  .cover .tag { letter-spacing: 3px; text-transform: uppercase; color: var(--muted); font-size: 11pt; margin-top: 4pt; }
  .cover .sub { margin-top: 36pt; font-family: 'Cormorant Garamond', serif; font-size: 22pt; }
  .cover img { width: 2.3in; margin-top: 30pt; border-radius: 14px; }
`;

(async () => {
  const { marked } = await import('marked');
  const { gfmHeadingId } = await import('marked-gfm-heading-id');
  marked.use(gfmHeadingId());

  let md = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  md = md.replace(/^# .*\n/, '')                                   // title goes on the cover
         .replace(/ To regenerate the screenshots[^\n]*/, '');       // repo-only note
  const body = marked.parse(md);
  const cover = `<section class="cover">
      <div class="logo"><em>Hardin</em> Trips</div>
      <div class="tag">Every journey, remembered</div>
      <div class="sub">Training Guide</div>
      <img src="img/02-home.png" alt="">
    </section>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Hardin Trips — Training Guide</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=DM+Sans:wght@300;400;500;700&display=swap" rel="stylesheet">
    <style>${CSS}</style></head><body>${cover}${body}</body></html>`;
  const tmp = path.join(DIR, '.pdf-build.html');
  fs.writeFileSync(tmp, html);

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u))
      return curl(u).then(({ body, meta }) => route.fulfill({ status: meta.status, contentType: meta.contentType, body, headers: { 'access-control-allow-origin': '*' } }));
    return route.abort();
  });
  await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Print layout: pair each right-aligned screenshot with the text that follows it
  // (up to the next <br clear>) in a side-by-side row that won't split across pages.
  await page.evaluate(() => {
    document.querySelectorAll('img[align=right]').forEach(img => {
      const anchor = img.parentElement.tagName === 'P' && img.parentElement.children.length === 1 ? img.parentElement : img;
      const row = document.createElement('div'); row.className = 'row';
      const txt = document.createElement('div'); txt.className = 'txt';
      anchor.before(row);
      let n = anchor.nextSibling;
      while (n && !(n.nodeType === 1 && (n.matches('br[clear]') || n.querySelector?.('br[clear]')))) { const next = n.nextSibling; txt.appendChild(n); n = next; }
      if (n) n.remove();
      img.removeAttribute('align'); img.removeAttribute('width');
      row.append(txt, img);
      if (anchor !== img) anchor.remove();
    });
    document.querySelectorAll('body > p > img:only-child, body > img').forEach(img => {
      img.removeAttribute('width');
      const holder = img.parentElement.tagName === 'P' ? img.parentElement : img;
      const prev = holder.previousElementSibling;
      if (prev && prev.classList.contains('row')) { prev.appendChild(img); if (holder !== img) holder.remove(); }
      else img.className = 'solo';
    });
    document.querySelectorAll('br[clear]').forEach(b => b.remove());
    // Big chapters start on a fresh page; short ones flow on.
    const h2s = [...document.querySelectorAll('h2')];
    ['1. Signing in', '4. A trip', '7. The Overview', '11. Sharing', '14. The admin'].forEach(t => h2s.find(h => h.textContent.startsWith(t))?.classList.add('newpage'));
  });
  await page.pdf({
    path: OUT, format: 'Letter', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-size:8pt;color:#8a7e72;padding:0 0.65in;display:flex;justify-content:space-between;font-family:sans-serif;"><span>Hardin Trips — Training Guide</span><span class="pageNumber"></span></div>',
  });
  await browser.close();
  fs.unlinkSync(tmp);
  console.log('wrote', OUT);
})().catch(e => { console.error(e); process.exit(1); });
