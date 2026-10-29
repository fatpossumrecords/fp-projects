/* ============================================================
   FAT POSSUM — PROJECTS · core
   Auth, API client, router and shared UI helpers. Each screen lives
   in its own file and registers itself with FP.route().
   ============================================================ */

const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

const CONFIG = {
  // Set to the deployed Worker URL after `wrangler deploy` (see worker/README.md).
  API_BASE: IS_LOCAL ? 'http://localhost:8787' : 'https://fp-projects-api.fatpossum.workers.dev',
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
  const hash = location.hash || '#/dashboard';
  const [path, qs] = hash.slice(2).split('?');
  const [name, ...rest] = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const render = FP.routes[name] || FP.routes.dashboard;
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

// ── CONCURRENT EDITS ─────────────────────────────────────────
FP.personName = email => {
  const u = FP.state.users.find(x => x.email === email);
  return u?.name || String(email || 'Someone').split('@')[0].replace(/^./, c => c.toUpperCase());
};

// Three-way merge for saving over someone else's save. base = what this page loaded,
// mine = what it's saving, theirs = what's on the server now. A change made on only one
// side is kept; both sides changing the same thing differently is a conflict, which takes
// `picks[id]` ('mine' | 'theirs', default mine). Lists whose rows carry a `key` merge row
// by row (adds and removes on both sides survive); other lists merge position by position
// when neither side added or removed rows, otherwise the whole list is one conflict.
FP.merge3 = function (base, mine, theirs, picks = {}) {
  const conflicts = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const keyed = a => Array.isArray(a) && a.every(x => isObj(x) && x.key);
  const rowName = x => isObj(x) ? String(x.name || x.title || x.song || x.venue || x.outlet || x.account || x.format || x.label || x.date || '').trim() : '';
  const label = k => String(k).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  function conflict(path, a, t) {
    const id = path.map(p => p.id).join('/');
    conflicts.push({ id, label: path.filter(p => p.id !== 'data').map(p => p.label).join(' › '), mine: a, theirs: t });
    return picks[id] === 'theirs' ? t : a;
  }
  function m(b, a, t, path) {
    if (same(a, t)) return a;
    if (same(b, a)) return t;
    if (same(b, t)) return a;
    if (isObj(a) && isObj(t)) {
      const bb = isObj(b) ? b : {}, out = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(t)])) {
        const v = m(bb[k], a[k], t[k], [...path, { id: k, label: label(k) }]);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    if (Array.isArray(a) && Array.isArray(t)) {
      const bb = Array.isArray(b) ? b : [];
      if (keyed(a) && keyed(t) && keyed(bb)) {
        const by = arr => new Map(arr.map(x => [x.key, x]));
        const B = by(bb), A = by(a), T = by(t), out = [];
        const step = (x, k) => [...path, { id: k, label: rowName(x) || `row ${k}` }];
        for (const x of a) {
          if (T.has(x.key)) out.push(m(B.get(x.key), x, T.get(x.key), step(x, x.key)));
          else if (!B.has(x.key) || !same(B.get(x.key), x)) out.push(x);   // added here, or edited here after they removed it
        }
        for (const [i, x] of t.entries()) {
          if (A.has(x.key)) continue;
          if (B.has(x.key) && same(B.get(x.key), x)) continue;             // removed here, untouched there
          // Theirs-only row: slot it in after the row it followed in their list.
          const prev = t.slice(0, i).reverse().find(y => out.some(o => o.key === y.key));
          out.splice(prev ? out.findIndex(o => o.key === prev.key) + 1 : out.length, 0, x);
        }
        return out;
      }
      // Plain lists: rows edited in place merge position by position, and rows added at
      // the end on either side are all kept. A removed or reordered row makes it a clash.
      if (a.length >= bb.length && t.length >= bb.length) {
        const out = bb.map((x, i) => m(x, a[i], t[i], [...path, { id: i, label: rowName(a[i]) || `row ${i + 1}` }]));
        const extra = a.slice(bb.length);
        for (const x of t.slice(bb.length)) if (!extra.some(y => same(x, y))) extra.push(x);
        return [...out, ...extra];
      }
    }
    return conflict(path, a, t);
  }
  return { value: m(base, mine, theirs, []), conflicts };
};

// Shows each conflict side by side and resolves to { [id]: 'mine' | 'theirs' }, or null if cancelled.
FP.resolveConflicts = function (conflicts, who) {
  const show = v => {
    if (v == null || v === '') return '<span class="hint">(empty)</span>';
    if (typeof v !== 'object') return esc(String(v)).slice(0, 400);
    if (Array.isArray(v)) return `${v.length} row${v.length === 1 ? '' : 's'}: ${esc(v.map(x => typeof x === 'object' ? Object.values(x || {}).filter(y => typeof y === 'string' && y).slice(0, 2).join(' · ') : String(x)).join('; ')).slice(0, 400)}`;
    return esc(Object.entries(v).filter(([, y]) => y !== '' && y != null && typeof y !== 'object').map(([k, y]) => `${k}: ${y}`).join(' · ')).slice(0, 400);
  };
  return new Promise(resolve => {
    let done = false;
    const m = FP.modal({
      title: 'You both changed the same thing', wide: true, saveLabel: 'Save with these choices',
      body: `<p class="hint" style="margin-bottom:12px">${esc(who)} saved this project while you were editing. Everything else was combined automatically; pick which version to keep for these:</p>
        ${conflicts.map((c, i) => `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px">
          <div style="font-weight:600;margin-bottom:6px">${esc(c.label || 'Project')}</div>
          <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:4px"><input type="radio" name="c${i}" value="mine" checked><span><b>Yours:</b> ${show(c.mine)}</span></label>
          <label style="display:flex;gap:8px;align-items:flex-start"><input type="radio" name="c${i}" value="theirs"><span><b>${esc(who)}’s:</b> ${show(c.theirs)}</span></label></div>`).join('')}`,
      onSave: el => {
        done = true;
        resolve(Object.fromEntries(conflicts.map((c, i) => [c.id, el.querySelector(`[name="c${i}"]:checked`).value])));
      },
    });
    new MutationObserver((_, obs) => { if (!m.el.isConnected) { obs.disconnect(); if (!done) resolve(null); } }).observe(document.getElementById('modal-root'), { childList: true });
  });
};

// Heartbeat for "who else has this open". onOthers gets [{ email, name, editing }] plus the
// record's latest save ({ updated_at, updated_by }) so the page can say someone saved.
FP.presence = function (resource, isEditing, onOthers) {
  let timer = null, stopped = false;
  const ping = async () => {
    if (stopped) return;
    clearTimeout(timer);
    try { const r = await FP.post('/api/presence', { resource, editing: !!isEditing() }); if (!stopped) onOthers(r.others || [], r.latest || null); }
    catch { /* offline: try again next beat */ }
    if (!stopped) timer = setTimeout(ping, 20000);
  };
  const leave = () => fetch(CONFIG.API_BASE + '/api/presence', { method: 'POST', keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + FP.state.token }, body: JSON.stringify({ resource, leave: true }) }).catch(() => {});
  window.addEventListener('pagehide', leave);
  ping();
  return {
    ping,
    stop() { stopped = true; clearTimeout(timer); window.removeEventListener('pagehide', leave); leave(); },
  };
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
