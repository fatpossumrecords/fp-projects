/* ============================================================
   SETTINGS — lookup lists, date templates, artists, users,
   AppSheet CSV import, calendar sync status
   ============================================================ */
(function () {
  const esc = FP.esc;
  const LISTS = [
    ['statuses', 'Release statuses'], ['formats', 'Formats'], ['territories', 'Territories'], ['labels', 'Labels'],
    ['platforms', 'Social platforms'], ['post_types', 'Social post types'], ['post_statuses', 'Social post statuses'],
  ];

  FP.route('settings', async (main, _rest, params) => {
    let tab = params.tab || 'lists';
    const tabs = [['lists', 'Lists'], ['templates', 'Internal Date Template'], ['artists', 'Artists'], ['contacts', 'Contacts'], ['playlists', 'Playlists'], ['users', 'Users'], ['import', 'Import'], ['calendar', 'Google Calendar']];
    main.innerHTML = `<div class="page-head"><h2>Settings</h2></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('')}</div>
      <div class="page-body" id="st-body"></div>`;
    const draw = () => {
      FP.setQuery({ tab: tab === 'lists' ? '' : tab });
      main.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
      const box = main.querySelector('#st-body');
      ({ lists: drawLists, templates: drawTemplates, artists: drawArtists, contacts: b => drawLibrary(b, 'contacts'), playlists: b => drawLibrary(b, 'playlists'), users: drawUsers, import: drawImport, calendar: drawCalendar })[tab](box);
    };
    main.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
    draw();
  });

  async function saveSetting(key, value) {
    await FP.put('/api/settings/' + key, { value });
    FP.state.settings[key] = value;
  }

  // ── LISTS ──────────────────────────────────────────────────
  function drawLists(box) {
    const w = FP.canWrite();
    box.innerHTML = `<p class="hint" style="margin-bottom:12px">One item per line. These fill the dropdowns across the app. Removing an item doesn't change records that already use it.</p>
      <div class="cards">${LISTS.map(([k, l]) => `<div class="form-section" style="margin:0"><h3>${l}</h3><div class="fs-body">
        <textarea data-k="${k}" rows="8"${w ? '' : ' disabled'}>${esc(FP.list(k).join('\n'))}</textarea></div></div>`).join('')}
        <div class="form-section" style="margin:0"><h3>Google Drive folder for project docs</h3><div class="fs-body">
          <input type="text" data-folder style="width:100%" placeholder="Folder ID" value="${esc(FP.state.settings.drive_folder_id || '')}"${w ? '' : ' disabled'}>
          <p class="hint" style="margin-top:6px">Open the folder in Drive. The ID is the last part of its URL: drive.google.com/drive/folders/<b>THIS_PART</b>. A Shared Drive folder works best, so docs don't belong to one person. Leave it blank to save docs to each person's My Drive.</p>
        </div></div>
        <div class="form-section" style="margin:0"><h3>Platform posting links</h3><div class="fs-body">
          <p class="hint" style="margin-bottom:8px">Where the <b>Open</b> button goes for each platform when someone opens a post to publish it. On a phone these usually open the app.</p>
          ${FP.list('platforms').map(p => `<div class="field" style="margin-bottom:6px"><label>${esc(p)}</label><input type="url" data-plink="${esc(p)}" value="${esc((FP.state.settings.platform_links || {})[p] || '')}"${w ? '' : ' disabled'}></div>`).join('')}
        </div></div>
        <div class="form-section" style="margin:0"><h3>Dropbox app key</h3><div class="fs-body">
          <input type="text" data-dropbox style="width:100%" placeholder="App key" value="${esc(FP.state.settings.dropbox_app_key || '')}"${w ? '' : ' disabled'}>
          <p class="hint" style="margin-top:6px">Turns on the <b>Dropbox</b> buttons in a project's Assets section. To set it up, go to dropbox.com/developers/apps and create an app (Scoped access, Full Dropbox). Copy its <b>App key</b> here, then add <span class="mono">fatpossumrecords.github.io</span> under <i>Chooser / Saver / Embedder domains</i>. The key is not a secret.</p>
        </div></div></div>
      ${w ? '<p style="margin-top:14px"><button class="btn-primary" id="st-save">Save lists</button></p>' : ''}`;
    box.querySelector('#st-save')?.addEventListener('click', async e => {
      e.target.disabled = true;
      try {
        for (const ta of box.querySelectorAll('textarea[data-k]')) {
          const vals = [...new Set(ta.value.split('\n').map(s => s.trim()).filter(Boolean))];
          if (JSON.stringify(vals) !== JSON.stringify(FP.list(ta.dataset.k))) await saveSetting(ta.dataset.k, vals);
        }
        const folder = box.querySelector('[data-folder]').value.trim().replace(/^.*folders\//, '').replace(/[?#].*$/, '');
        if (folder !== (FP.state.settings.drive_folder_id || '')) await saveSetting('drive_folder_id', folder);
        const plinks = Object.fromEntries([...box.querySelectorAll('[data-plink]')].map(i => [i.dataset.plink, i.value.trim()]).filter(([, v]) => v));
        if (JSON.stringify(plinks) !== JSON.stringify(FP.state.settings.platform_links || {})) await saveSetting('platform_links', plinks);
        const dbx = box.querySelector('[data-dropbox]').value.trim();
        if (dbx !== (FP.state.settings.dropbox_app_key || '')) await saveSetting('dropbox_app_key', dbx);
        FP.toast('Saved');
      } catch (err) { FP.toast(err.message, true); }
      finally { e.target.disabled = false; }
    });
  }

  // ── MILESTONE TEMPLATE ─────────────────────────────────────
  function drawTemplates(box) {
    const w = FP.canWrite();
    let rows = (FP.state.settings.milestone_templates || []).map(r => ({ ...r }));
    const draw = () => {
      rows.sort((a, b) => (Number(a.offset) || 0) - (Number(b.offset) || 0));
      box.innerHTML = `<p class="hint" style="margin-bottom:12px">The standard internal dates added to a project with <b>Add standard dates from template</b>. The offset is days from the release date (−28 means 4 weeks before). Changes apply to projects from now on; existing dates stay as they are.</p>
        <div class="tbl-wrap" style="max-width:820px"><table class="tbl edit"><thead><tr><th>Item</th><th style="width:120px">Offset (days)</th><th style="width:120px">≈ weeks</th><th style="width:180px">Default owner</th><th></th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td><input type="text" data-i="${i}" data-k="title" value="${esc(r.title)}"${w ? '' : ' disabled'}></td>
          <td><input type="number" data-i="${i}" data-k="offset" value="${esc(r.offset)}"${w ? '' : ' disabled'}></td>
          <td class="mono" style="color:var(--text-muted)">${r.offset ? (Math.abs(r.offset) / 7).toFixed(1) + (r.offset < 0 ? ' before' : ' after') : 'release day'}</td>
          <td><select data-i="${i}" data-k="owner"${w ? '' : ' disabled'}>${FP.options(FP.userNames(), r.owner)}</select></td>
          <td>${w ? `<button class="btn-ghost btn-sm" data-del="${i}">✕</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
        ${w ? '<p style="margin-top:12px;display:flex;gap:8px"><button class="btn" id="t-add">+ Add item</button><button class="btn-primary" id="t-save">Save template</button></p>' : ''}`;
      box.querySelectorAll('[data-k]').forEach(i => i.onchange = () => { rows[+i.dataset.i][i.dataset.k] = i.dataset.k === 'offset' ? Number(i.value) : i.value; if (i.dataset.k === 'offset') draw(); });
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { rows.splice(+b.dataset.del, 1); draw(); });
      box.querySelector('#t-add')?.addEventListener('click', () => { rows.push({ key: 'c_' + crypto.randomUUID().slice(0, 6), title: '', offset: -14 }); draw(); });
      box.querySelector('#t-save')?.addEventListener('click', async () => {
        try { await saveSetting('milestone_templates', rows.filter(r => r.title)); FP.toast('Template saved'); }
        catch (e) { FP.toast(e.message, true); }
      });
    };
    draw();
  }

  // ── ARTISTS ────────────────────────────────────────────────
  async function drawArtists(box) {
    const artists = await FP.get('/api/artists');
    FP.state.artists = artists;
    const w = FP.canWrite();
    box.innerHTML = `<p class="hint" style="margin-bottom:12px">Artists are added automatically when you use a new name anywhere in the app. Set a color to tell them apart on calendars.</p>
      <div class="tbl-wrap" style="max-width:820px"><table class="tbl edit"><thead><tr><th style="width:60px">Color</th><th>Name</th><th>Share link</th><th></th></tr></thead><tbody>
      ${artists.map(a => `<tr data-id="${a.id}"><td><input type="color" data-color value="${a.color || '#7a7468'}"${w ? '' : ' disabled'} style="width:40px;height:28px;padding:0;border:0"></td>
        <td style="padding:6px 10px">${esc(a.name)}</td>
        <td style="padding:6px 10px">${a.share_token ? '<span class="badge s-confirmed">On</span>' : '<span class="hint">Off</span>'}</td>
        <td class="row-actions"><a class="btn-ghost btn-sm" href="#/social?artist=${encodeURIComponent(a.name)}">Social calendar →</a></td></tr>`).join('')}
      </tbody></table></div>`;
    box.querySelectorAll('[data-color]').forEach(inp => inp.onchange = async () => {
      const a = artists.find(x => x.id === inp.closest('tr').dataset.id);
      try { Object.assign(a, await FP.saveRecord('artists', a, { color: inp.value })); } catch (e) { if (e.status !== 409) FP.toast(e.message, true); }
    });
  }

  // ── CONTACTS / PLAYLIST LIBRARY ────────────────────────────
  // Both fill themselves from project saves; this screen is for tidying up.
  const LIBS = {
    contacts: { title: 'contacts', intro: 'Everyone who has been on a project team. New names are added when a project is saved, and typing a name in a Team list fills in their details.',
      cols: [['name', 'Name'], ['role', 'Role'], ['company', 'Company'], ['email', 'Email'], ['phone', 'Phone']] },
    playlists: { title: 'playlists', intro: 'Every playlist used in Digital Playlisting. Typing a playlist name on a project fills in its link from here.',
      cols: [['dsp', 'DSP'], ['name', 'Playlist'], ['url', 'Link'], ['curator', 'Curator'], ['notes', 'Notes']] },
  };
  async function drawLibrary(box, kind) {
    const cfg = LIBS[kind], w = FP.canWrite();
    let rows = await FP.get('/api/' + kind), q = '';
    const draw = () => {
      const ql = q.toLowerCase();
      const list = rows.filter(r => !ql || cfg.cols.some(([k]) => String(r[k] || '').toLowerCase().includes(ql)));
      box.innerHTML = `<p class="hint" style="margin-bottom:12px">${cfg.intro}</p>
        <div class="toolbar" style="margin-bottom:10px"><input type="search" id="lib-q" placeholder="Search ${cfg.title}…" value="${esc(q)}" style="width:240px">
          ${w ? `<button class="btn" id="lib-add">+ Add</button>` : ''}<span class="hint">${rows.length} saved</span></div>
        <div class="tbl-wrap"><table class="tbl ${w ? 'edit' : ''}"><thead><tr>${cfg.cols.map(c => `<th style="min-width:130px">${c[1]}</th>`).join('')}<th></th></tr></thead><tbody>
        ${list.map(r => `<tr data-id="${r.id}">${cfg.cols.map(([k]) => `<td>${w ? (k === 'dsp'
            ? `<select data-k="${k}">${FP.options(['Spotify', 'Apple Music', 'Amazon Music', 'Deezer', 'Tidal', 'Qobuz', 'Pandora', 'YouTube Music'], r[k])}</select>`
            : `<input type="text" data-k="${k}" value="${esc(r[k])}">`) : esc(r[k])}</td>`).join('')}
          <td class="row-actions">${w ? '<button class="btn-ghost btn-sm" data-del>✕</button>' : ''}</td></tr>`).join('') || `<tr><td colspan="${cfg.cols.length + 1}" class="empty">Nothing saved yet.</td></tr>`}
        </tbody></table></div>`;
      const qi = box.querySelector('#lib-q');
      qi.oninput = e => { q = e.target.value; draw(); box.querySelector('#lib-q').focus(); box.querySelector('#lib-q').setSelectionRange(q.length, q.length); };
      box.querySelectorAll('[data-k]').forEach(inp => inp.onchange = async () => {
        const r = rows.find(x => x.id === inp.closest('tr').dataset.id);
        try { Object.assign(r, await FP.saveRecord(kind, r, { [inp.dataset.k]: inp.value.trim() })); }
        catch (e) { if (e.status !== 409) FP.toast(e.message, true); inp.value = r[inp.dataset.k] || ''; }
      });
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        const r = rows.find(x => x.id === b.closest('tr').dataset.id);
        if (!confirm(`Remove "${r.name}" from the saved ${cfg.title}? Projects that already use it keep their copy.`)) return;
        await FP.del(`/api/${kind}/${r.id}`); rows = rows.filter(x => x !== r); draw();
      });
      box.querySelector('#lib-add')?.addEventListener('click', () => {
        const name = prompt(kind === 'contacts' ? 'Name' : 'Playlist name');
        if (!name?.trim()) return;
        FP.post('/api/' + kind, { name: name.trim() }).then(r => { rows.unshift(r); draw(); }).catch(e => FP.toast(e.message, true));
      });
    };
    draw();
    FP.loadBootstrap().catch(() => {});
  }

  // ── USERS ──────────────────────────────────────────────────
  async function drawUsers(box) {
    const users = await FP.get('/api/users');
    const admin = FP.isAdmin();
    box.innerHTML = `<p class="hint" style="margin-bottom:12px">Anyone with a @fatpossum.com Google account can sign in, and starts as an <b>editor</b>. Set someone to <b>viewer</b> for read-only access or <b>disabled</b> to block them. To let in an outside address (e.g. a freelancer), add it here.</p>
      <div class="tbl-wrap" style="max-width:820px"><table class="tbl edit"><thead><tr><th>Name</th><th>Email</th><th>Last sign-in</th><th style="width:140px">Role</th></tr></thead><tbody>
      ${users.map(u => `<tr><td style="padding:6px 10px">${esc(u.name || '')}</td><td style="padding:6px 10px" class="mono">${esc(u.email)}</td>
        <td style="padding:6px 10px">${u.last_login ? new Date(u.last_login).toLocaleDateString() : '<span class="hint">never</span>'}</td>
        <td>${admin ? `<select data-email="${esc(u.email)}">${FP.options(['admin', 'editor', 'viewer', 'disabled'], u.role, { blank: false })}</select>` : esc(u.role)}</td></tr>`).join('')}
      </tbody></table></div>
      ${admin ? `<div class="toolbar" style="margin-top:12px"><input type="email" id="u-email" placeholder="name@example.com" style="width:240px"><input type="text" id="u-name" placeholder="Name">
        <select id="u-role">${FP.options(['editor', 'viewer', 'admin'], 'editor', { blank: false })}</select><button class="btn" id="u-add">Add user</button></div>` : ''}`;
    box.querySelectorAll('[data-email]').forEach(s => s.onchange = async () => {
      try { await FP.put('/api/users/' + encodeURIComponent(s.dataset.email), { role: s.value }); FP.toast('Role updated'); }
      catch (e) { FP.toast(e.message, true); }
    });
    box.querySelector('#u-add')?.addEventListener('click', async () => {
      const email = box.querySelector('#u-email').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return FP.toast('Enter a valid email', true);
      try {
        await FP.put('/api/users/' + encodeURIComponent(email), { role: box.querySelector('#u-role').value, name: box.querySelector('#u-name').value.trim() });
        drawUsers(box);
      } catch (e) { FP.toast(e.message, true); }
    });
  }

  // ── IMPORT (AppSheet CSV) ──────────────────────────────────
  // Each target lists its fields and the column-name spellings we'll auto-match.
  const TARGETS = {
    releases: { label: 'Release schedule', fields: {
      artist: ['artist', 'artist name', 'band'], title: ['title', 'release', 'release title', 'album', 'project'],
      format: ['format', 'config', 'configuration'], release_date: ['date', 'release date', 'street date', 'release_date'],
      pm: ['project manager', 'pm', 'manager', 'owner'], status: ['status'], territory: ['territory', 'region'],
      label: ['label', 'imprint'], catalog: ['catalog', 'catalog #', 'cat #', 'cat#', 'catalog number', 'cat no'], notes: ['notes', 'comments'],
    }, dates: ['release_date'], required: ['artist', 'title'] },
    projects: { label: 'Projects', fields: {
      artist: ['artist', 'artist name'], title: ['title', 'release title', 'album'], name: ['project name', 'project'],
      release_date: ['release date', 'date', 'street date'], label: ['label'], catalog: ['catalog #', 'cat #', 'catalog', 'cat#'],
      territory: ['territory'], pm: ['project manager', 'pm'], status: ['status'],
    }, dates: ['release_date'], required: ['artist', 'title'], extra: true },
    milestones: { label: 'Internal dates (unassigned)', fields: {
      title: ['title', 'item', 'task', 'milestone', 'name'], date: ['date', 'due', 'due date'], owner: ['owner', 'assigned to'], notes: ['notes'],
    }, dates: ['date'], required: ['title', 'date'] },
    social: { label: 'Social posts', fields: {
      date: ['date', 'post date'], time: ['time'], artist: ['artist'], platform: ['platform', 'channel', 'network'],
      post_type: ['type', 'post type', 'content type'], caption: ['caption', 'copy', 'text', 'post'], asset_url: ['asset', 'asset link', 'image', 'media'],
      link_url: ['link', 'url'], status: ['status'], owner: ['owner', 'assigned to'], notes: ['notes'],
    }, dates: ['date'], required: ['date'] },
  };

  function drawImport(box) {
    if (!FP.isAdmin()) { box.innerHTML = '<div class="empty">Only admins can import data.</div>'; return; }
    let csv = null, target = 'releases', map = {};
    box.innerHTML = `<div class="form-section" style="max-width:980px"><h3>Import from AppSheet / Google Sheets</h3><div class="fs-body">
      <p style="margin-bottom:10px">Export each AppSheet table as CSV (in AppSheet Database: open the table → ⋮ → <b>Download as CSV</b>, or from the Google Sheet behind it: File → Download → CSV). Then:</p>
      <div class="toolbar"><select id="im-target">${Object.entries(TARGETS).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}</select>
        <input type="file" id="im-file" accept=".csv,text/csv"></div>
      <div id="im-map" style="margin-top:14px"></div></div></div>`;
    box.querySelector('#im-target').onchange = e => { target = e.target.value; if (csv) autoMap(), drawMap(); };
    box.querySelector('#im-file').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const rows = FP.parseCsv(await f.text());
      if (rows.length < 2) return FP.toast('That file has no data rows', true);
      csv = { header: rows[0].map(h => h.trim()), rows: rows.slice(1) };
      autoMap(); drawMap();
    };
    function autoMap() {
      map = {};
      const t = TARGETS[target];
      csv.header.forEach((h, i) => {
        const n = h.toLowerCase().replace(/[_]+/g, ' ').trim();
        const hit = Object.entries(t.fields).find(([k, aliases]) => !Object.values(map).includes(k) && (n === k || aliases.includes(n)));
        map[i] = hit ? hit[0] : (t.extra ? '_extra' : '');
      });
    }
    function convert() {
      const t = TARGETS[target];
      return csv.rows.map(r => {
        const o = {};
        csv.header.forEach((h, i) => {
          const k = map[i], v = (r[i] ?? '').trim();
          if (!k || !v) return;
          if (k === '_extra') { (o.data ||= { imported: {} }).imported[h] = v; return; }
          o[k] = t.dates.includes(k) ? FP.normDate(v) : v;
        });
        if (target === 'projects') o.data = Object.assign({ formats: [], team: [], tour: [], tracks: [], social: {}, assets: {}, dsp: {} }, o.data || {});
        return o;
      });
    }
    function drawMap() {
      const t = TARGETS[target];
      const opts = sel => `<option value="">— skip —</option>${t.extra ? `<option value="_extra"${sel === '_extra' ? ' selected' : ''}>Keep as imported note</option>` : ''}` +
        Object.keys(t.fields).map(k => `<option value="${k}"${k === sel ? ' selected' : ''}>${k}${t.required.includes(k) ? ' *' : ''}</option>`).join('');
      const rows = convert();
      const ok = rows.filter(r => t.required.every(k => r[k]));
      const badDates = rows.filter(r => t.dates.some(k => r[k] === null)).length;
      box.querySelector('#im-map').innerHTML = `
        <p class="hint" style="margin-bottom:8px">${csv.rows.length} rows found. Match each CSV column to a field. Fields marked * are required.</p>
        <div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>CSV column</th><th>Sample values</th><th style="width:220px">Import as</th></tr></thead><tbody>
        ${csv.header.map((h, i) => `<tr><td style="padding:6px 10px"><b>${esc(h)}</b></td>
          <td style="padding:6px 10px;color:var(--text-muted)">${esc(csv.rows.slice(0, 3).map(r => r[i]).filter(Boolean).join(' · ').slice(0, 90))}</td>
          <td><select data-col="${i}">${opts(map[i])}</select></td></tr>`).join('')}
        </tbody></table></div>
        <p style="margin-top:12px"><b>${ok.length}</b> of ${rows.length} rows will import${rows.length - ok.length ? ` (${rows.length - ok.length} are missing a required field and will be skipped)` : ''}.
          ${badDates ? `<span style="color:var(--yellow)">${badDates} dates couldn't be read and will be blank.</span>` : ''}</p>
        ${ok.length ? `<div class="tbl-wrap" style="margin-top:8px;max-height:220px"><table class="tbl"><thead><tr>${Object.keys(t.fields).map(k => `<th>${k}</th>`).join('')}</tr></thead><tbody>
          ${ok.slice(0, 5).map(r => `<tr>${Object.keys(t.fields).map(k => `<td>${esc(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
        <p style="margin-top:12px"><button class="btn-primary" id="im-go"${ok.length ? '' : ' disabled'}>Import ${ok.length} rows</button>
          <span class="hint">Importing twice creates duplicates.</span></p>`;
      box.querySelectorAll('[data-col]').forEach(s => s.onchange = () => { map[s.dataset.col] = s.value; drawMap(); });
      box.querySelector('#im-go')?.addEventListener('click', async e => {
        if (!confirm(`Import ${ok.length} rows into ${t.label}?`)) return;
        e.target.disabled = true;
        try {
          let ins = 0, skip = 0;
          for (let i = 0; i < ok.length; i += 500) {
            const r = await FP.post('/api/import', { table: target, rows: ok.slice(i, i + 500) });
            ins += r.inserted; skip += r.skipped;
          }
          FP.toast(`Imported ${ins} rows${skip ? `, skipped ${skip}` : ''}`);
          await FP.loadBootstrap();
          csv = null; box.querySelector('#im-map').innerHTML = `<p><b>Done.</b> ${ins} rows imported. Calendar events for imported releases are created over the next few sync runs.</p>`;
        } catch (err) { FP.toast(err.message, true); e.target.disabled = false; }
      });
    }
  }

  // ── CALENDAR SYNC ──────────────────────────────────────────
  async function drawCalendar(box) {
    const c = FP.state.calendar;
    const calLink = id => id ? `<a href="https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(id)}" target="_blank" rel="noopener">Add to my Google Calendar ↗</a>` : '<span style="color:var(--red)">Not configured</span>';
    box.innerHTML = `<div class="form-section" style="max-width:820px"><h3>Two-way Google Calendar sync</h3><div class="fs-body">
        <p><b>Release Schedule calendar:</b> ${calLink(c.releases)}</p>
        <p><b>Internal Dates calendar:</b> ${calLink(c.internal)}</p>
        <p class="hint" style="margin-top:10px">Changes in the app show up in Google Calendar within seconds. Changes made in Google Calendar come back to the app every 5 minutes:
          moving an event changes its date, renaming it changes the title, and new events become releases or unassigned internal dates.
          Deleting an internal-date event deletes it here. Deleting a release event only unlinks it; the release stays on the schedule.
          Release event titles must keep the format <span class="mono">Artist — Title [Format]</span> to be read back.</p>
        ${FP.isAdmin() ? '<p style="margin-top:12px;display:flex;gap:8px"><button class="btn" id="c-sync">Sync now</button><button class="btn" id="c-reset">Full resync</button></p><pre id="c-out" class="mono hint" style="margin-top:8px;white-space:pre-wrap"></pre>' : ''}
      </div></div>
      <div class="form-section" style="max-width:820px"><h3>Sync log</h3><div class="fs-body" id="c-log">Loading…</div></div>`;
    const loadLog = async () => {
      const log = await FP.get('/api/sync/log');
      box.querySelector('#c-log').innerHTML = log.length ? `<div style="max-height:360px;overflow:auto">${log.map(l => `<div class="mono" style="font-size:11px;padding:2px 0;color:${l.level === 'error' ? 'var(--red)' : l.level === 'warn' ? 'var(--yellow)' : 'var(--text-muted)'}">${esc(l.ts)} · ${esc(l.msg)}</div>`).join('')}</div>` : '<span class="hint">No sync activity yet.</span>';
    };
    const run = async (path, btn) => {
      btn.disabled = true;
      try { box.querySelector('#c-out').textContent = JSON.stringify(await FP.post(path), null, 2); loadLog(); }
      catch (e) { FP.toast(e.message, true); }
      finally { btn.disabled = false; }
    };
    box.querySelector('#c-sync')?.addEventListener('click', e => run('/api/sync', e.target));
    box.querySelector('#c-reset')?.addEventListener('click', e => confirm('Re-read every event from both calendars?') && run('/api/sync/reset', e.target));
    loadLog();
  }
})();
