// Fake Firebase SDK (app/database/storage/auth) backed by an in-memory hierarchical store.
const W = window;
const S = W.__fake || (W.__fake = { root: {}, listeners: [], keyN: 0 });
const segs = p => String(p || '').split('/').filter(Boolean);
const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
function getAt(p) { let n = S.root; for (const s of segs(p)) { if (n == null || typeof n !== 'object') return null; n = n[s]; } return n === undefined ? null : n; }
function setAt(p, v) {
  const ss = segs(p);
  if (!ss.length) { S.root = clone(v) || {}; return; }
  let n = S.root;
  for (const s of ss.slice(0, -1)) { if (n[s] == null || typeof n[s] !== 'object') n[s] = {}; n = n[s]; }
  if (v === null || v === undefined) delete n[ss.at(-1)]; else n[ss.at(-1)] = clone(v);
}
function snap(path, key) { const v = path === '.info/connected' ? true : clone(getAt(path)); return { key, val: () => v, exists: () => v != null, forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({ key: k, val: () => x })); } }; }
function notify(p) {
  const P = segs(p).join('/');
  S.listeners.forEach(l => { const L = segs(l.path).join('/'); if (L === P || P.startsWith(L + '/') || L.startsWith(P + '/') || L === '' ) setTimeout(() => l.cb(snap(l.path)), 0); });
}
W.__fakeWrites = W.__fakeWrites || [];
export function initializeApp() { return {}; }
export function getDatabase() { return { fake: true }; }
export function ref(db, path) { return { path: path || '', key: segs(path).at(-1) }; }
const same = (p, v) => JSON.stringify(getAt(p)) === JSON.stringify(v === undefined ? null : v);
export async function set(r, v) { W.__fakeWrites.push(['set', r.path]); if (same(r.path, v)) return; setAt(r.path, v); notify(r.path); }
export async function update(r, obj) { for (const [k, v] of Object.entries(obj)) { const p = segs(r.path).concat(segs(k)).join('/'); if (same(p, v)) continue; setAt(p, v); notify(p); } }
export function push(r, v) { const key = '-fake' + (++S.keyN).toString().padStart(5, '0'); const p = segs(r.path).concat(key).join('/'); const res = { path: p, key }; const pr = v === undefined ? Promise.resolve(res) : set(res, v).then(() => res); return Object.assign(pr, res); }
export async function remove(r) { if (getAt(r.path) == null) return; setAt(r.path, null); notify(r.path); }
export async function get(r) { return snap(r.path, r.key); }
export function onValue(r, cb) { const l = { path: r.path, cb }; S.listeners.push(l); setTimeout(() => cb(snap(r.path)), 0); return () => { S.listeners = S.listeners.filter(x => x !== l); }; }
export function getStorage() { return {}; }
export { ref as sRefUnused };
export async function uploadBytes() { return {}; }
export async function getDownloadURL() { return ''; }
// Fake users count as verified unless a test sets emailVerified:false.
const fakeUser = () => W.__fakeUser ? Object.assign({ emailVerified: true, providerData: [{ providerId: 'google.com' }], reload: async () => {}, getIdToken: async () => '' }, W.__fakeUser) : null;
export function getAuth() { return { get currentUser() { return fakeUser(); } }; }
export class GoogleAuthProvider { static credential() { return {}; } }
export class OAuthProvider { constructor(id) { this.providerId = id; } addScope() {} credential() { return {}; } static credentialFromResult() { return null; } }
export class EmailAuthProvider { static credential() { return {}; } }
export async function signInWithPopup() {}
export async function signInWithCredential() {}
export async function createUserWithEmailAndPassword() { return { user: fakeUser() }; }
export async function signInWithEmailAndPassword() {}
export async function sendEmailVerification() {}
export async function sendPasswordResetEmail() {}
export async function reauthenticateWithPopup() { return {}; }
export async function reauthenticateWithCredential() {}
export async function deleteUser() {}
export async function revokeAccessToken() {}
export async function updateProfile() {}
export function onAuthStateChanged(a, cb) { setTimeout(() => cb(fakeUser()), 0); return () => {}; }
export async function signOut() {}
