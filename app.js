/* ============================================================
   FAT POSSUM — PROJECTS · core
   Auth, API client, router and shared UI helpers. Each screen lives
   in its own file and registers itself with FP.route().
   ============================================================ */

const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

const CONFIG = {
  // Set to the deployed Worker URL after `wrangler deploy` (see worker/README.md).
  API_BASE: IS_LOCAL ? 'http://localhost:8787' : 'https://fp-projects-api.REPLACE-ME.workers.dev',
  GOOGLE_CLIENT_ID: '955463970238-o8p7ujrhusedtkavkskjhjlh87gr1844.apps.googleusercontent.com',
};

const FP = window.FP = {
  state: { token: null, me: null, settings: {}, artists: [], users: [], calendar: {} },
  routes: {},
  current: null,
};

// ── API ──────────────────────────────────────────────────────
FP.api = async function (method, path, data) {
  const res = await fetch(CONFIG.API_BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, FP.state.token ? { Authorization: 'Bearer ' + FP.state.token } : {}),
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  let out = null;
  try { out = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && !path.startsWith('/auth/')) { FP.showLogin('Your session expired — please sign in again.'); }
  if (!res.ok) {
    const err = new Error(out?.error || 'Request failed (HTTP ' + res.status + ')');
    err.status = res.status; err.data = out;
    throw err;
  }
  return out;
};
FP.get = p => FP.api('GET', p);
FP.post = (p, d) => FP.api('POST', p, d || {});
FP.put = (p, d) => FP.api('PUT', p, d);
FP.del = p => FP.api('DELETE', p);

// ── AUTH ─────────────────────────────────────────────────────
FP.boot = async function () {
  try { FP.state.token = localStorage.getItem('fp_proj_token'); } catch { /* storage blocked */ }
  if (FP.state.token) {
    try { await FP.loadBootstrap(); return FP.startApp(); } catch (e) { if (e.status !== 401) FP.toast(e.message, true); }
  }
  FP.showLogin();
};

FP.showLogin = function (msg) {
  FP.state.token = null;
  try { localStorage.removeItem('fp_proj_token'); } catch { /* ignore */ }
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  const errEl = document.getElementById('login-error');
  errEl.textContent = msg || '';
  errEl.classList.toggle('hidden', !msg);
  if (IS_LOCAL) document.getElementById('dev-login').classList.remove('hidden');
  const render = () => {
    google.accounts.id.initialize({ client_id: CONFIG.GOOGLE_CLIENT_ID, callback: FP.onGoogleCredential, hd: 'fatpossum.com' });
    google.accounts.id.renderButton(document.getElementById('g-signin'), { type: 'standard', size: 'large', theme: 'outline', shape: 'pill', text: 'sign_in_with' });
  };
  if (window.google?.accounts?.id) render();
  else window.addEventListener('load', () => window.google?.accounts?.id && render(), { once: true });
};

FP.onGoogleCredential = async function (resp) {
  try {
    const r = await FP.post('/auth/google', { credential: resp.credential });
    await FP.finishLogin(r.token);
  } catch (e) {
    const el = document.getElementById('login-error');
    el.textContent = e.message; el.classList.remove('hidden');
  }
};

FP.devLogin = async function () {
  try { await FP.finishLogin((await FP.post('/auth/dev')).token); }
  catch (e) { FP.toast('Dev login failed: ' + e.message + ' (is DEV_BYPASS_EMAIL set in worker/.dev.vars?)', true); }
};

FP.finishLogin = async function (token) {
  FP.state.token = token;
  try { localStorage.setItem('fp_proj_token', token); } catch { /* session-only */ }
  await FP.loadBootstrap();
  FP.startApp();
};

FP.logout = function () {
  try { google.accounts.id.disableAutoSelect(); } catch { /* not loaded */ }
  FP.showLogin();
};

FP.loadBootstrap = async function () {
  const b = await FP.get('/api/bootstrap');
  Object.assign(FP.state, { me: b.me, settings: b.settings || {}, artists: b.artists || [], users: b.users || [], contacts: b.contacts || [], playlists: b.playlists || [], calendar: b.calendar || {}, sources: b.sources || {} });
};

FP.startApp = function () {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  const me = FP.state.me;
  document.getElementById('me').innerHTML =
    `${me.picture ? `<img src="${esc(me.picture)}" alt="" referrerpolicy="no-referrer">` : ''}<div><div>${esc(me.name || me.email)}</div><div class="role">${esc(me.role)}</div></div>`;
  if (!FP._routerBound) { window.addEventListener('hashchange', FP.navigate); FP._routerBound = true; }
  FP.navigate();
};

FP.canWrite = () => ['admin', 'editor'].includes(FP.state.me?.role);
FP.isAdmin = () => FP.state.me?.role === 'admin';

// ── ROUTER ───────────────────────────────────────────────────
// Hash routes: #/releases  #/projects  #/projects/<id>?tab=dates  #/dates  #/social  #/settings
FP.route = (name, render) => { FP.routes[name] = render; };

FP.navigate = async function () {
  if (FP.current?.dirty && !confirm('You have unsaved changes. Leave this page?')) {
    history.replaceState(null, '', FP.current.hash);
    return;
  }
  const hash = location.hash || '#/releases';
  const [path, qs] = hash.slice(2).split('?');
  const [name, ...rest] = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const render = FP.routes[name] || FP.routes.releases;
  document.querySelectorAll('#sidebar nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  FP.current?.destroy?.();
  FP.current = { hash, dirty: false };
  const main = document.getElementById('main');
  main.innerHTML = '<div class="empty">Loading…</div>';
  try { await render(main, rest, params, FP.current); }
  catch (e) { main.innerHTML = `<div class="empty">Couldn't load this page: ${esc(e.message)}</div>`; }
};

FP.setQuery = function (params) {
  const [path] = location.hash.split('?');
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  const hash = path + (qs ? '?' + qs : '');
  history.replaceState(null, '', hash);
  if (FP.current) FP.current.hash = hash;
};

window.addEventListener('beforeunload', e => { if (FP.current?.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ── HELPERS ──────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
FP.esc = esc;

FP.safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';

FP.list = key => FP.state.settings[key] || [];

FP.options = function (values, selected, { blank = true, blankLabel = '' } = {}) {
  const vals = [...values];
  if (selected && !vals.includes(selected)) vals.push(selected);
  return (blank ? `<option value="">${esc(blankLabel)}</option>` : '') +
    vals.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
};

FP.userNames = () => FP.state.users.map(u => u.name || u.email);

FP.slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
FP.statusBadge = s => s ? `<span class="badge s-${FP.slug(s)}">${esc(s)}</span>` : '';

FP.today = () => FP.ymd(new Date());
FP.ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
FP.parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
FP.addDays = (ymd, n) => { const d = FP.parseYmd(ymd); d.setDate(d.getDate() + n); return FP.ymd(d); };
FP.fmtDate = (s, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => s ? FP.parseYmd(s).toLocaleDateString('en-US', opts) : '';
FP.monthLabel = s => s ? FP.parseYmd(s).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'No date';

// Normalizes the date formats AppSheet/Sheets exports tend to use into YYYY-MM-DD.
FP.normDate = function (v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  const d = new Date(s);
  return isNaN(d) ? null : FP.ymd(d);
};

FP.artistColor = function (name) {
  const a = FP.state.artists.find(x => x.name.toLowerCase() === String(name || '').toLowerCase());
  if (a?.color) return a.color;
  let h = 0;
  for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 45%, 48%)`;
};

// Segmented Planning | Confirmed control. Buttons carry data-status; callers wire the clicks.
// `all` adds a leading "All" button (value '') for use as a filter.
FP.statusToggle = function (current, { all = false, small = false, disabled = false } = {}) {
  const vals = [...(all ? [''] : []), ...FP.list('statuses')];
  if (current && !vals.includes(current)) vals.push(current);
  return `<div class="seg status-seg${small ? ' seg-sm' : ''}">${vals.map(v => `<button type="button" data-status="${esc(v)}" class="${v === (current || '') ? 'on' : ''} s-${FP.slug(v) || 'all'}"${disabled ? ' disabled' : ''}>${esc(v || 'All')}</button>`).join('')}</div>`;
};

// Release-schedule colors: Planning = yellow, Confirmed = green. Internal dates are red (FP.INTERNAL_COLOR).
const STATUS_COLORS = {
  planning:  { bg: '#f2c94c', text: '#3d2e00' },
  confirmed: { bg: '#2e8b57', text: '#ffffff' },
};
FP.statusColor = s => (STATUS_COLORS[FP.slug(s)] || { bg: '#8f897d' }).bg;
FP.statusTextColor = s => (STATUS_COLORS[FP.slug(s)] || { text: '#ffffff' }).text;
FP.INTERNAL_COLOR = { bg: '#c0392b', text: '#ffffff' };

FP.artistDatalist = function () {
  let dl = document.getElementById('dl-artists');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'dl-artists'; document.body.appendChild(dl); }
  dl.innerHTML = FP.state.artists.map(a => `<option value="${esc(a.name)}">`).join('');
  return 'dl-artists';
};

FP.ensureArtistLocal = function (name) {
  if (name && !FP.state.artists.some(a => a.name.toLowerCase() === name.toLowerCase())) {
    FP.state.artists.push({ name });
    FP.state.artists.sort((a, b) => a.name.localeCompare(b.name));
  }
};

FP.toast = function (msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.getElementById('toast-root').appendChild(t);
  setTimeout(() => t.remove(), isErr ? 7000 : 3000);
};

// Opens a modal. Returns { el, close }. `onSave` receives the modal element;
// throw or return false to keep it open.
FP.modal = function ({ title, body, saveLabel = 'Save', onSave, onDelete, wide, sheet, noFoot }) {
  const root = document.getElementById('modal-root');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal${sheet ? ' sheet' : ''}"${wide ? ' style="width:900px"' : ''}>
    <div class="modal-head"><h3>${esc(title)}</h3><button class="btn-ghost" data-x>✕</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot${noFoot ? ' hidden' : ''}">
      ${onDelete ? '<button class="btn-danger" data-del>Delete</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" data-x>${onSave ? 'Cancel' : 'Close'}</button>
      ${onSave ? `<button class="btn-primary" data-save>${esc(saveLabel)}</button>` : ''}
    </div></div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
  bg.querySelectorAll('[data-x]').forEach(b => b.onclick = close);
  const run = async (fn, btn) => {
    btn.disabled = true;
    try { if ((await fn(bg)) !== false) close(); }
    catch (e) { FP.toast(e.message, true); }
    finally { btn.disabled = false; }
  };
  if (onSave) bg.querySelector('[data-save]').onclick = e => run(onSave, e.target);
  if (onDelete) bg.querySelector('[data-del]').onclick = e => { if (confirm('Delete this? This can’t be undone.')) run(onDelete, e.target); };
  root.appendChild(bg);
  bg.querySelector('input, select, textarea')?.focus();
  return { el: bg, close };
};

// Reads every [name] input inside el into a plain object.
FP.readForm = function (el) {
  const out = {};
  el.querySelectorAll('[name]').forEach(i => {
    out[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim();
  });
  return out;
};

FP.field = function (label, inner, cls = '') {
  return `<div class="field ${cls}"><label>${esc(label)}</label>${inner}</div>`;
};

// Saves a record with optimistic locking. On a conflict, offers to reload.
FP.saveRecord = async function (table, rec, changes) {
  try {
    if (rec.id) return await FP.put(`/api/${table}/${rec.id}`, { ...changes, _expected_updated_at: rec.updated_at });
    return await FP.post(`/api/${table}`, changes);
  } catch (e) {
    if (e.status === 409) {
      FP.toast(e.message, true);
      if (e.data?.current) Object.assign(rec, e.data.current);
    }
    throw e;
  }
};

// Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines, "" escapes).
FP.parseCsv = function (text) {
  const rows = []; let row = [], field = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
};

FP.downloadCsv = function (filename, header, rows) {
  const cell = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
  const csv = [header, ...rows].map(r => r.map(cell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
