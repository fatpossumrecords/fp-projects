/* ============================================================
   TOUR DATES — every artist's shows in one list (#/tour)
   Shows for artists with a project live in that project's Tour
   Dates (added here, they go into the artist's current projects);
   artists without a project are stored on their own. City filters
   use map coordinates looked up by the Worker (OpenStreetMap).
   ============================================================ */
(function () {
  const esc = FP.esc;
  // Distance filters: centre + radius in miles.
  const REGIONS = [
    { key: 'nyc', label: 'New York', lat: 40.7128, lon: -74.0060, mi: 30 },
    { key: 'london', label: 'London', lat: 51.5074, lon: -0.1278, mi: 30 },
    { key: 'la', label: 'Los Angeles', lat: 34.0522, lon: -118.2437, mi: 40 },
    { key: 'oxford', label: 'Oxford, MS', lat: 34.3665, lon: -89.5192, mi: 100 },
  ];
  const miles = (a, b) => {
    const r = x => x * Math.PI / 180, R = 3958.8;
    const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const placeKey = c => String(c || '').trim().toLowerCase().replace(/\s+/g, ' ');

  let ui = { region: '', artist: '', when: 'upcoming', q: '' };
  try { Object.assign(ui, JSON.parse(localStorage.getItem('fp_tour_ui') || '{}')); } catch { /* defaults */ }
  const saveUi = () => { try { localStorage.setItem('fp_tour_ui', JSON.stringify(ui)); } catch { /* ignore */ } };

  FP.route('tour', async main => {
    const w = FP.canWrite();
    main.innerHTML = `<div class="page-head"><h2>Tour Dates</h2>
        ${w ? '<button class="btn" id="t-paste">Paste dates…</button><button class="btn-primary" id="t-add">+ Show</button>' : ''}</div>
      <div class="page-body">
        <div class="toolbar" style="margin-bottom:10px">
          <div class="seg" id="t-region"><button data-v="">Everywhere</button>${REGIONS.map(r => `<button data-v="${r.key}" title="Within ${r.mi} miles">${esc(r.label)}${r.key === 'oxford' ? ' (100 mi)' : ''}</button>`).join('')}</div>
        </div>
        <div class="toolbar" style="margin-bottom:12px">
          <div class="seg" id="t-when"><button data-v="upcoming">Upcoming</button><button data-v="past">Past</button><button data-v="all">All</button></div>
          <select id="t-artist"></select>
          <input type="search" id="t-q" placeholder="Search city, venue, notes…" value="${esc(ui.q)}" style="width:220px">
          <span class="spacer"></span><span class="hint" id="t-count"></span>
        </div>
        <div id="t-body"><div class="empty">Loading…</div></div>
      </div>`;
    const $ = s => main.querySelector(s);
    let data = { shows: [], places: {}, pending: 0 };

    const load = async () => {
      try { data = await FP.get('/api/tour'); }
      catch (e) { $('#t-body').innerHTML = `<div class="empty">Couldn't load tour dates: ${esc(e.message)}</div>`; return; }
      const artists = [...new Set(data.shows.map(s => s.artist))].sort((a, b) => a.localeCompare(b));
      if (ui.artist && !artists.includes(ui.artist)) ui.artist = '';
      $('#t-artist').innerHTML = `<option value="">All artists</option>` + artists.map(a => `<option${a === ui.artist ? ' selected' : ''}>${esc(a)}</option>`).join('');
      draw();
    };

    const draw = () => {
      main.querySelectorAll('#t-region button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.region));
      main.querySelectorAll('#t-when button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.when));
      const today = FP.today(), q = ui.q.trim().toLowerCase();
      const region = REGIONS.find(r => r.key === ui.region);
      let unplaced = 0;
      const list = data.shows.filter(s => {
        if (ui.when === 'upcoming' && s.date < today) return false;
        if (ui.when === 'past' && s.date >= today) return false;
        if (ui.artist && s.artist !== ui.artist) return false;
        if (q && ![s.city, s.venue, s.notes, s.artist].some(v => String(v || '').toLowerCase().includes(q))) return false;
        if (region) {
          const p = data.places[placeKey(s.city)];
          if (!p) { unplaced++; return false; }
          s.miles = Math.round(miles(region, p));
          if (s.miles > region.mi) return false;
        }
        return true;
      });
      if (ui.when === 'past') list.reverse();
      $('#t-count').textContent = `${list.length} show${list.length === 1 ? '' : 's'}`;
      const notes = [];
      if (region) notes.push(`Within ${region.mi} miles of ${esc(region.label)}.`);
      if (region && (unplaced || data.pending)) notes.push(`${unplaced} show${unplaced === 1 ? '' : 's'} not on the map yet${data.pending ? ' (cities are being located; check back in a few minutes)' : ' (city not recognised)'}.`);
      let html = '', month = '';
      for (const s of list) {
        const m = s.date.slice(0, 7);
        if (m !== month) { month = m; html += `<tr class="group"><td colspan="7">${esc(FP.fmtDate(m + '-01', { month: 'long', year: 'numeric' }))}</td></tr>`; }
        const i = data.shows.indexOf(s);
        html += `<tr data-i="${i}"${s.date < today ? ' class="past"' : ''}${w ? ' style="cursor:pointer"' : ''}>
          <td class="mono" style="white-space:nowrap">${esc(FP.fmtDate(s.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</td>
          <td><b>${esc(s.artist)}</b></td>
          <td>${esc(s.city)}${region && s.miles != null && s.miles > 5 ? ` <span class="hint">${s.miles} mi</span>` : ''}</td>
          <td>${FP.safeUrl(s.ticket_url) ? `<a href="${esc(s.ticket_url)}" target="_blank" rel="noopener">${esc(s.venue || 'Tickets')} ↗</a>` : esc(s.venue)}</td>
          <td>${s.cancelled ? '<span class="badge s-cancelled">Cancelled</span> ' : ''}${!s.announced && !s.cancelled ? '<span class="badge s-planning">Not announced</span> ' : ''}${esc(s.notes)}</td>
          <td>${s.projects.length ? s.projects.map(p => `<a href="#/projects/${p.id}?tab=info" title="Open the project">${esc(p.title)}</a>`).join(', ') : '<span class="hint">No project</span>'}</td>
          <td class="row-actions">${w ? '<button class="btn-ghost btn-sm" data-edit>Edit</button>' : ''}</td></tr>`;
      }
      $('#t-body').innerHTML = (notes.length ? `<p class="hint" style="margin:0 0 10px">${notes.join(' ')}</p>` : '') + (html
        ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Artist</th><th>City</th><th>Venue</th><th>Notes</th><th>Project</th><th></th></tr></thead><tbody>${html}</tbody></table></div>`
        : `<div class="empty">No shows ${region ? 'in this area ' : ''}${ui.when === 'past' ? 'in the past' : ui.when === 'upcoming' ? 'coming up' : ''}.</div>`);
      if (w) $('#t-body').querySelectorAll('tr[data-i]').forEach(tr => tr.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        openShow(data.shows[+tr.dataset.i]);
      }));
    };

    // Add or edit one show. Editing a show that several projects list changes it in all of them.
    function openShow(s) {
      const isNew = !s;
      s = s || { artist: ui.artist || '', date: '', city: '', venue: '', notes: '', ticket_url: '', announced: false, cancelled: false };
      FP.modal({
        title: isNew ? 'New show' : `${s.artist} · ${FP.fmtDate(s.date)}`,
        body: `<div class="grid">
          ${isNew ? FP.field('Artist', `<input type="text" name="artist" value="${esc(s.artist)}" list="${FP.artistDatalist()}" autocomplete="off">`, 'wide') : ''}
          ${FP.field('Date', `<input type="date" name="date" value="${esc(s.date)}">`)}
          ${FP.field('City', `<input type="text" name="city" value="${esc(s.city)}" placeholder="e.g. Memphis, TN or London, UK">`)}
          ${FP.field('Venue', `<input type="text" name="venue" value="${esc(s.venue)}">`)}
          ${FP.field('Ticket link', `<input type="url" name="ticket_url" value="${esc(s.ticket_url)}">`)}
          ${FP.field('Notes', `<input type="text" name="notes" value="${esc(s.notes)}" placeholder="e.g. supporting X, festival name">`, 'wide')}
          <label><input type="checkbox" name="announced"${s.announced ? ' checked' : ''}> Announced publicly</label>
          ${isNew ? '' : `<label><input type="checkbox" name="cancelled"${s.cancelled ? ' checked' : ''}> Cancelled</label>`}
        </div>
        <p class="hint" style="margin-top:8px">${isNew ? 'If the artist has a current project, the show is added to it too.' : s.projects.length ? `Also changes it on: ${s.projects.map(p => esc(p.title)).join(', ')}.` : 'This artist has no project yet; the show moves into their first project when one is created.'}</p>`,
        saveLabel: isNew ? 'Add show' : 'Save',
        onSave: async el => {
          const f = FP.readForm(el);
          if (isNew) {
            if (!f.artist) throw new Error('Artist is required');
            const r = await FP.post('/api/tour', f);
            FP.toast(r.added ? (r.projects.length ? `Added, and on the project${r.projects.length === 1 ? '' : 's'} too` : 'Added') : 'That show is already listed');
            if (!FP.state.artists.some(a => a.name.toLowerCase() === f.artist.toLowerCase())) FP.loadBootstrap().catch(() => {});
          } else {
            const { artist, ...fields } = f;
            await FP.post('/api/tour/edit', { refs: s.refs, fields });
            FP.toast('Saved');
          }
          load();
        },
        onDelete: isNew ? null : async () => {
          await FP.post('/api/tour/delete', { refs: s.refs });
          FP.toast(s.projects.length ? 'Deleted, and removed from the project' : 'Deleted');
          load();
        },
      });
    }

    // Paste many shows for one artist (same parser as a project's "Paste tour dates").
    function pasteShows() {
      const m = FP.modal({
        title: 'Paste tour dates', wide: true, saveLabel: 'Add these dates',
        body: `<div class="grid">${FP.field('Artist', `<input type="text" id="tp-artist" value="${esc(ui.artist)}" list="${FP.artistDatalist()}" autocomplete="off">`, 'wide')}</div>
          <p class="hint" style="margin:8px 0">One show per line starting with the date, or copy the list from Songkick, Bandsintown or the artist's site. Shows already listed are skipped.</p>
          <textarea id="tp-text" rows="10" style="font-family:var(--mono);font-size:12px"></textarea>
          <label style="display:block;margin-top:8px"><input type="checkbox" id="tp-ann"> These dates are already announced publicly</label>
          <div id="tp-prev" class="hint" style="margin-top:8px"></div>`,
        onSave: async el => {
          const artist = el.querySelector('#tp-artist').value.trim();
          if (!artist) throw new Error('Artist is required');
          const ann = el.querySelector('#tp-ann').checked;
          const shows = FP.projectInfo.parseTour(el.querySelector('#tp-text').value).filter(r => !r.error)
            .map(r => ({ date: r.date, city: r.city || '', venue: r.venue || '', notes: r.notes || '', ticket_url: r.ticket_url || '', announced: ann }));
          if (!shows.length) throw new Error('No dates found. Each line needs to start with a date.');
          const r = await FP.post('/api/tour', { artist, shows });
          FP.toast(`Added ${r.added} show${r.added === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} already listed)` : ''}${r.projects.length && r.added ? ', also on the project' : ''}`);
          load();
        },
      });
      m.el.querySelector('#tp-text').addEventListener('input', e => {
        const rows = FP.projectInfo.parseTour(e.target.value), good = rows.filter(r => !r.error);
        m.el.querySelector('#tp-prev').innerHTML = rows.length ? `${good.length} show${good.length === 1 ? '' : 's'} found${rows.length - good.length ? `; couldn't read a date on ${rows.length - good.length} line${rows.length - good.length === 1 ? '' : 's'}` : ''}.`
          + (good.length ? `<br>${good.slice(0, 5).map(r => esc(`${FP.fmtDate(r.date)} · ${[r.city, r.venue].filter(Boolean).join(' · ')}`)).join('<br>')}${good.length > 5 ? '<br>…' : ''}` : '') : '';
      });
    }

    main.querySelectorAll('#t-region button').forEach(b => b.onclick = () => { ui.region = b.dataset.v; saveUi(); draw(); });
    main.querySelectorAll('#t-when button').forEach(b => b.onclick = () => { ui.when = b.dataset.v; saveUi(); draw(); });
    $('#t-artist').onchange = e => { ui.artist = e.target.value; saveUi(); draw(); };
    $('#t-q').oninput = e => { ui.q = e.target.value; saveUi(); draw(); };
    $('#t-add')?.addEventListener('click', () => openShow(null));
    $('#t-paste')?.addEventListener('click', pasteShows);
    load();
  });
})();
