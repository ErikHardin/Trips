const { launch, blocked } = require('./lib');
const OUT = require('path').join(__dirname, '..', 'img') + '/';
const ADMIN = { email: 'erikchardin@gmail.com', displayName: 'Erik', uid: 'u1' };
const only = process.argv[2];
const wait = (p, ms = 500) => p.waitForTimeout(ms);
async function shot(page, name, clip) { if (only && !name.startsWith(only)) return; await page.screenshot({ path: OUT + name + '.png', timeout: 120000, ...(clip ? { clip } : {}) }); console.log('shot', name); }
async function scrollTo(page, selector, offset = 0) {
  await page.evaluate(([sel, off]) => {
    const el = document.querySelector(sel);
    const sc = el.closest('.scroll-content') || document.querySelector('.screen.active .scroll-content');
    sc.scrollTop = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - off;
  }, [selector, offset]);
  await wait(page, 300);
}
async function scrollTop(page, y = 0) { await page.evaluate(y => { const sc = document.querySelector('.screen.active .scroll-content'); if (sc) sc.scrollTop = y; }, y); await wait(page, 300); }
const mark = page => page.evaluate(() => { window.__bodyKids = new Set(document.body.children); });
const closeModals = page => page.evaluate(() => [...document.body.children].forEach(m => { if (!window.__bodyKids.has(m) && m.tagName !== 'SCRIPT') m.remove(); }));

(async () => {
  const seed = () => require('./seed')(ADMIN.email);

  // ── Signed out: login ──
  { const { browser, page } = await launch({ user: null, seed: seed() });
    await shot(page, '01-login');
    await page.fill('#loginEmailInput', 'grandma@example.com');
    await page.evaluate(() => createPasswordAccount()); await wait(page);
    await shot(page, '01b-create-account');
    await page.evaluate(() => { document.getElementById('loginError').style.display = 'none'; setLoginMode('verify', 'grandma@example.com'); document.getElementById('loginSignOutBtn').style.display = ''; }); await wait(page);
    await shot(page, '01c-verify-email');
    await page.evaluate(() => setLoginMode('waiting', 'Thanks! Your request to join was sent to Erik (grandma@example.com). This page opens by itself once you’re added.')); await wait(page);
    await shot(page, '01d-request-sent');
    await browser.close(); }

  // ── Admin ──
  const { browser, page } = await launch({ user: ADMIN, seed: seed() });
  await page.evaluate(() => goHome()); await wait(page);
  await shot(page, '02-home');
  await page.evaluate(() => toggleTripGroup('homeTripGroupPast')); await wait(page);
  await scrollTop(page, 9999);
  await shot(page, '03-home-past-trips');

  // Itinerary
  await page.evaluate(() => openTrip('portugal', 'itinerary')); await wait(page, 2500);
  await scrollTop(page, 0);
  await shot(page, '04-itinerary-top');
  await page.evaluate(() => { document.getElementById('dc-d01').classList.add('open'); });
  await scrollTo(page, '#dc-d01', 8);
  await shot(page, '05-day-expanded');

  // Maps choice
  await mark(page);
  await page.evaluate(() => openMapsChoice('Belcanto, Lisbon', 'd01', 'a2', 2)); await wait(page);
  await shot(page, '06-maps-choice'); await closeModals(page);

  // Notes screen
  await page.evaluate(() => openNotes('d01', 'a2', 'Dinner at Belcanto')); await wait(page, 800);
  await shot(page, '07-notes');
  await page.evaluate(() => { showScreen('screen-trip'); }); await wait(page);

  // Quick activity editor
  await mark(page);
  await page.evaluate(() => openQuickActivityEditor('d01')); await wait(page, 800);
  await shot(page, '08-quick-edit');
  await page.evaluate(() => { const t = document.querySelector('#quickActivityModal .act-time-input'); t.value = '8:30pm'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await mark(page);
  await page.evaluate(() => { requestCloseQuickActivity(); }); await wait(page, 600);
  await shot(page, '31-unsaved-changes'); await closeModals(page);
  await page.evaluate(() => closeQuickActivityModalDirect()); await wait(page);

  // Overview
  await page.evaluate(() => switchTripTab('overview', document.querySelector('.tab-btn[onclick*="overview"]'))); await wait(page, 4000);
  await scrollTop(page, 0);
  await shot(page, '09-overview');
  await scrollTop(page, 700);
  await shot(page, '10-overview-map');

  // Logistics
  await page.evaluate(() => switchTripTab('logistics', document.getElementById('logisticsTabBtn'))); await wait(page, 1500);
  await scrollTop(page, 0);
  await shot(page, '11-logistics');
  await page.evaluate(() => { const t = document.querySelector('.packing-person-toggle'); if (t) t.click(); }); await wait(page, 600);
  await scrollTo(page, '.packing-person-block', 60);
  await shot(page, '12-logistics-packing');

  // Changes
  await page.evaluate(() => switchTripTab('changes', document.getElementById('changesTabBtn'))); await wait(page, 800);
  await scrollTop(page, 0);
  await shot(page, '13-changes');

  // Wishlist
  await page.evaluate(() => switchTripTab('wishlist', document.getElementById('wishlistTabBtn'))); await wait(page, 800);
  await scrollTop(page, 0);
  await shot(page, '14-wishlist');

  // Edit trip
  await page.evaluate(() => openEditTrip('portugal', 'screen-trip')); await wait(page, 1200);
  await scrollTop(page, 0);
  await shot(page, '15-edit-trip');
  await scrollTop(page, 900);
  await shot(page, '16-edit-trip-days');

  // World map
  await page.evaluate(() => { goHome(); showWorldMap(); }); await wait(page, 5000);
  await shot(page, '17-world-map');

  // Admin
  await page.evaluate(() => { goHome(); showScreen('screen-admin'); }); await wait(page);
  await scrollTop(page, 0);
  await shot(page, '18-admin');
  await page.evaluate(() => toggleAdminSection('bookingInbox')); await wait(page, 800);
  await scrollTo(page, '#bookingInboxHeader', 10);
  await shot(page, '29-admin-booking-inbox');
  await page.evaluate(() => startInboxEdit('b1')); await wait(page, 600);
  await scrollTo(page, '#bookingInboxList', 10);
  await shot(page, '30-admin-booking-edit');
  await page.evaluate(() => { cancelInboxEdit('b1'); toggleAdminSection('bookingInbox'); }); await wait(page);
  await page.evaluate(() => toggleAdminSection('addTripSection')); await wait(page);
  await page.fill('#newTripName', 'Italy Spring 2027'); await page.fill('#newTripEmoji', '🇮🇹');
  await page.fill('#newTripStart', '2027-05-10'); await page.fill('#newTripEnd', '2027-05-20');
  await page.dispatchEvent('#newTripEnd', 'change'); await page.dispatchEvent('#newTripEnd', 'input'); await wait(page);
  await shot(page, '19-admin-add-trip');
  await page.evaluate(() => toggleAdminSection('addTripSection'));
  await page.evaluate(() => toggleAdminSection('manageTripsSection')); await wait(page);
  await shot(page, '20-admin-manage-trips');
  await page.evaluate(() => toggleAdminSection('manageTripsSection'));
  await page.evaluate(() => toggleAdminSection('aiSection')); await wait(page);
  await page.selectOption('#aiTripSelect', 'portugal'); await wait(page);
  await page.fill('#aiInput', 'Add dinner at Cantinho do Avillez at 8pm on Sep 30');
  await scrollTo(page, '#aiSectionHeader', 10);
  await shot(page, '21-admin-ai');
  await page.evaluate(() => toggleAdminSection('aiSection'));
  await page.evaluate(() => toggleUserAccessSection()); await wait(page, 800);
  await scrollTo(page, '#userAccessSectionHeader', 10);
  await shot(page, '22-admin-users');
  await page.evaluate(() => toggleUserAccessSection());
  await page.evaluate(() => toggleAdminSection('travelTracker')); await wait(page, 800);
  await scrollTo(page, '#travelTrackerHeader', 10);
  await shot(page, '23-admin-travel');
  await page.evaluate(() => toggleAdminSection('travelTracker'));
  await page.evaluate(() => toggleAdminSection('packingSection')); await wait(page, 800);
  await scrollTo(page, '#packingSectionHeader', 10);
  await shot(page, '24-admin-packing');
  await page.evaluate(() => toggleAdminSection('packingSection'));
  await page.evaluate(() => toggleAdminSection('pdfSection')); await wait(page, 800);
  await scrollTo(page, '#pdfSectionHeader', 10);
  await shot(page, '25-admin-pdf');
  await browser.close();

  // ── Guest (read-only family member) ──
  { const { browser, page } = await launch({ user: { email: 'grandma@example.com', displayName: 'Grandma', uid: 'u2' }, seed: seed() });
    await page.evaluate(() => goHome()); await wait(page);
    await shot(page, '26-guest-home'); await browser.close(); }

  // ── User (can create and manage their own trips) ──
  { const { browser, page } = await launch({ user: { email: 'alex@example.com', displayName: 'Alex', uid: 'u3' }, seed: seed(), now: '2026-09-29T15:00:00+01:00' });
    await page.evaluate(() => goHome()); await wait(page);
    await shot(page, '32-user-home');
    await page.evaluate(() => showScreen('screen-admin')); await wait(page);
    await shot(page, '34-user-settings');
    await page.evaluate(() => toggleAdminSection('bookingInbox')); await wait(page, 800);
    await scrollTo(page, '#bookingInboxHeader', 10);
    await shot(page, '35-user-booking-inbox');
    await page.evaluate(() => toggleAdminSection('bookingInbox')); await wait(page);
    await page.evaluate(() => toggleAdminSection('addTripSection')); await wait(page);
    await scrollTo(page, '#addTripSectionHeader', 10);
    await shot(page, '33-user-add-trip'); await browser.close(); }

  // ── Share link (signed out) ──
  { const { browser, page } = await launch({ user: null, seed: seed(), url: 'http://127.0.0.1:8901/index.html?trip=portugal' });
    await wait(page, 3000);
    await shot(page, '27-share-itinerary');
    await page.evaluate(() => switchShareTab('highlights', document.querySelector('#shareTabNav .tab-btn:nth-child(2)'))); await wait(page, 1500);
    await shot(page, '28-share-highlights'); await browser.close(); }
  console.log('blocked hosts:', [...blocked]);
})().catch(e => { console.error(e); process.exit(1); });
