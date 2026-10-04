// Renders ../README.md (with its screenshots) into one PDF per role:
// ../Hardin-Trips-{Admin,User,Guest}-Guide.pdf.
//
// README.md is the complete (admin) guide. Role markers in it pick what each PDF gets:
//   <!-- only: admin user --> … <!-- /only -->   shown on GitHub and in those roles' PDFs (may nest)
//   <!-- for: guest↵ … ↵-->                       hidden on GitHub, shown in those roles' PDFs
//   <!-- only: readme --> … <!-- /only -->        GitHub only, never in a PDF
// Sections left over are renumbered, along with the contents list and "section N" references.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const { curl } = require('./lib');

const DIR = path.join(__dirname, '..');
const ROLES = {
  admin: { title: 'Admin Guide', cover: '02-home' },
  user:  { title: 'User Guide',  cover: '32-user-home' },
  guest: { title: 'Guest Guide', cover: '26-guest-home' },
};
const only = process.argv[2];

// Keeps the parts of the README meant for `role`, then renumbers its sections.
function forRole(src, role) {
  // Hidden alternates: <!-- for: roles\n content \n-->
  let md = src.replace(/<!-- for: ([a-z ]+)\n([\s\S]*?)\n-->\n?/g, (_, roles, body) => roles.split(' ').includes(role) ? body + '\n' : '');
  // <!-- only: roles --> blocks, which may nest. A marker alone on its line takes its newline with it.
  let out = '', keep = [true], i = 0;
  const re = /<!-- (only: ([a-z ]+)|\/only) -->(\n)?/g;
  for (let m; (m = re.exec(md)); ) {
    if (keep.at(-1)) out += md.slice(i, m.index);
    if (m[2]) keep.push(keep.at(-1) && m[2].split(' ').includes(role));
    else if (keep.length > 1) keep.pop(); else throw new Error('Unmatched <!-- /only -->');
    // A newline after an inline marker belongs to the text that follows it
    const alone = m.index === 0 || md[m.index - 1] === '\n';
    if (m[3] && !alone && keep.at(-1)) out += '\n';
    i = re.lastIndex;
  }
  if (keep.length !== 1) throw new Error('Unclosed <!-- only -->');
  md = out + (keep.at(-1) ? md.slice(i) : '');

  // Renumber "## N. Title" sections, then the contents list, anchors and "section N" text.
  const map = {}; let n = 0;
  md = md.replace(/^## (\d+)\. /gm, (_, old) => { map[old] = String(++n); return '## ' + n + '. '; });
  md = md.replace(/^(\d+)\. (\[[^\]]*\]\(#\1-[^)]*\))\n/gm, (line, old, link) => map[old] ? map[old] + '. ' + link + '\n' : '');
  // One pass, so a renumbered reference is never renumbered again
  md = md.replace(/\(#(\d+)-|\bsection (\d+)\b/g, (s, a, b) =>
    a ? (map[a] ? '(#' + map[a] + '-' : s) : (map[b] ? 'section ' + map[b] : s));
  return md.replace(/\n{3,}/g, '\n\n');
}

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
  table:has(img) { width: 100%; table-layout: fixed; }
  td img { width: 100% !important; max-width: 2.2in; border-radius: 8px; }
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
  const src = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [role, { title, cover: coverImg }] of Object.entries(ROLES)) {
    if (only && only !== role) continue;
    await build(browser, marked, role, title, coverImg, src);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

async function build(browser, marked, role, title, coverImg, src) {
  const OUT = path.join(DIR, 'Hardin-Trips-' + title.replace(' ', '-') + '.pdf');
  const md = forRole(src, role).replace(/^# .*\n/, '');             // title goes on the cover
  const body = marked.parse(md);
  const cover = `<section class="cover">
      <div class="logo"><em>Hardin</em> Trips</div>
      <div class="tag">Every journey, remembered</div>
      <div class="sub">${title}</div>
      <img src="img/${coverImg}.png" alt="">
    </section>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Hardin Trips — ${title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=DM+Sans:wght@300;400;500;700&display=swap" rel="stylesheet">
    <style>${CSS}</style></head><body>${cover}${body}</body></html>`;
  const tmp = path.join(DIR, '.pdf-build.html');
  fs.writeFileSync(tmp, html);

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
    ['Signing in', 'A trip', 'The Overview', 'Sharing', 'The admin'].forEach(t => h2s.find(h => h.textContent.replace(/^\d+\.\s*/, '').startsWith(t))?.classList.add('newpage'));
  });
  // Every in-page link must land on a heading this role's guide still has.
  const dangling = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => !document.getElementById(decodeURIComponent(h.slice(1)))));
  if (dangling.length) throw new Error(role + ' guide has links to missing sections: ' + dangling.join(', '));
  await page.pdf({
    path: OUT, format: 'Letter', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-size:8pt;color:#8a7e72;padding:0 0.65in;display:flex;justify-content:space-between;font-family:sans-serif;"><span>Hardin Trips — ' + title + '</span><span class="pageNumber"></span></div>',
  });
  await page.close();
  fs.unlinkSync(tmp);
  console.log('wrote', OUT);
}
