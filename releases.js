/* ============================================================
   RELEASE SCHEDULE — spreadsheet view + calendar view
   ============================================================ */
(function () {
  const esc = FP.esc;
  const COLS = [
    { key: 'artist', label: 'Artist', w: 170 },
    { key: 'title', label: 'Title', w: 220 },
    { key: 'format', label: 'Format', list: 'formats', w: 120 },
    { key: 'release_date', label: 'Date', w: 140 },
    { key: 'pm', label: 'Project Manager', users: true, w: 150 },
    { key: 'status', label: 'Status', list: 'statuses', w: 125 },
    { key: 'territory', label: 'Territory', list: 'territories', w: 120 },
    { key: 'label', label: 'Label', list: 'labels', w: 130 },
  ];
  // Rows generated from a project's Formats list: these fields belong to the project.
  const PROJECT_OWNED = ['artist', 'pm', 'label'];
  // Timeline rows (announce, video…) only own their title and date; the rest follows the project.
  const TIMELINE_OWNED = ['artist', 'pm', 'label', 'format', 'status', 'territory', 'catalog'];
  const owned = r => !r.format_key ? [] : r.kind === 'timeline' ? TIMELINE_OWNED : PROJECT_OWNED;
  const isTimeline = r => r.kind === 'timeline';

  let ui = { view: 'table', group: 'month', range: 'upcoming', q: '', status: '', label: '', pm: '', territory: '', sort: 'release_date', dir: 1, dates: false, timeline: true };
  try { Object.assign(ui, JSON.parse(localStorage.getItem('fp_rel_ui') || '{}')); } catch { /* defaults */ }
  const saveUi = () => { try { localStorage.setItem('fp_rel_ui', JSON.stringify(ui)); } catch { /* ignore */ } };

  let rows = [], cal = null;

  FP.route('releases', async (main, _rest, params) => {
    rows = await FP.get('/api/releases');
    main.innerHTML = `
      <div class="page-head">
        <h2>Release Schedule</h2>
        <div class="seg" id="r-view"><button data-v="table">Spreadsheet</button><button data-v="calendar">Calendar</button></div>
        ${FP.canWrite() ? '<button class="btn-primary" id="r-add">+ Release</button>' : ''}
      </div>
      <div class="page-body">
        <div class="toolbar" style="margin-bottom:12px">
          <input type="search" id="r-q" placeholder="Search artist, title, cat #…" style="width:220px">
          <select id="r-range"><option value="upcoming">This month onward</option><option value="past">Before this month</option><option value="all">All dates</option></select>
          <span id="r-status">${FP.statusToggle(ui.status, { all: true })}</span>
          <select id="r-label">${FP.options(FP.list('labels'), ui.label, { blankLabel: 'All labels' })}</select>
          <select id="r-pm">${FP.options(FP.userNames(), ui.pm, { blankLabel: 'All PMs' })}</select>
          <select id="r-territory">${FP.options(FP.list('territories'), ui.territory, { blankLabel: 'All territories' })}</select>
          <span class="spacer"></span>
          <span class="tbl-only">Group by <select id="r-group"><option value="month">Month</option><option value="artist">Artist</option><option value="none">None</option></select></span>
          <label><input type="checkbox" id="r-timeline"> Show timeline items</label>
          <label class="cal-only"><input type="checkbox" id="r-dates"> Show internal dates</label>
          <button class="btn tbl-only" id="r-csv">Export CSV</button>
        </div>
        <div id="r-content"></div>
      </div>`;
    const $ = s => main.querySelector(s);
    $('#r-q').value = ui.q; $('#r-range').value = ui.range; $('#r-group').value = ui.group; $('#r-dates').checked = ui.dates; $('#r-timeline').checked = ui.timeline;
    $('#r-status').addEventListener('click', e => {
      const b = e.target.closest('[data-status]'); if (!b) return;
      ui.status = b.dataset.status; saveUi();
      $('#r-status').innerHTML = FP.statusToggle(ui.status, { all: true });
      render(main);
    });
    for (const k of ['q', 'range', 'label', 'pm', 'territory', 'group']) {
      $('#r-' + k).addEventListener(k === 'q' ? 'input' : 'change', e => { ui[k] = e.target.value; saveUi(); render(main); });
    }
    $('#r-dates').onchange = e => { ui.dates = e.target.checked; saveUi(); render(main); };
    $('#r-timeline').onchange = e => { ui.timeline = e.target.checked; saveUi(); render(main); };
    main.querySelectorAll('#r-view button').forEach(b => b.onclick = () => { ui.view = b.dataset.v; saveUi(); render(main); });
    $('#r-add')?.addEventListener('click', () => openRelease({ status: FP.list('statuses')[0] }, () => render(main)));
    $('#r-csv').onclick = () => FP.downloadCsv(`release-schedule-${FP.today()}.csv`,
      [...COLS.map(c => c.label), 'Catalog #', 'Notes'], filtered().map(r => [...COLS.map(c => r[c.key]), r.catalog, r.notes]));
    render(main);
    if (params.id) { const r = rows.find(x => x.id === params.id); if (r) openRelease(r, () => render(main)); }
  });

  // "Upcoming" starts at the 1st of the current month, so this month's releases
  // don't vanish from the spreadsheet the day after they come out.
  const rangeStart = () => FP.today().slice(0, 8) + '01';
  const inRange = r => ui.range === 'all' || (ui.range === 'upcoming'
    ? (!r.release_date || r.release_date >= rangeStart())
    : (r.release_date && r.release_date < rangeStart()));

  function filtered({ ignoreRange } = {}) {
    const q = ui.q.toLowerCase();
    return rows.filter(r =>
      (ignoreRange || inRange(r)) &&
      (!q || [r.artist, r.title, r.catalog, r.format, r.notes].some(v => String(v || '').toLowerCase().includes(q))) &&
      (!ui.status || r.status === ui.status) && (!ui.label || r.label === ui.label) &&
      (!ui.pm || r.pm === ui.pm) && (!ui.territory || r.territory === ui.territory) && (ui.timeline || !isTimeline(r)));
  }

  function render(main) {
    main.querySelectorAll('#r-view button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.view));
    main.querySelectorAll('.tbl-only').forEach(e => e.classList.toggle('hidden', ui.view !== 'table'));
    main.querySelectorAll('.cal-only').forEach(e => e.classList.toggle('hidden', ui.view !== 'calendar'));
    main.querySelector('#r-range').classList.toggle('hidden', ui.view !== 'table');
    const box = main.querySelector('#r-content');
    if (cal) { cal.destroy(); cal = null; }
    if (ui.view === 'calendar') renderCalendar(box); else renderTable(box);
  }

  // ── SPREADSHEET ────────────────────────────────────────────
  function sortRows(list) {
    const k = ui.sort, d = ui.dir;
    return [...list].sort((a, b) => {
      const av = a[k] || '', bv = b[k] || '';
      if (!av && bv) return 1; if (av && !bv) return -1;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * d ||
        String(a.artist).localeCompare(String(b.artist));
    });
  }

  function renderTable(box) {
    let list = sortRows(filtered());
    if (ui.group === 'artist') list = [...list].sort((a, b) => a.artist.localeCompare(b.artist) || String(a.release_date || '9').localeCompare(String(b.release_date || '9')));
    const hidden = ui.range === 'all' ? 0 : filtered({ ignoreRange: true }).length - list.length;
    const hiddenNote = hidden ? ` · <a href="#" data-showall>${hidden} ${ui.range === 'upcoming' ? 'earlier' : 'later'} release${hidden === 1 ? '' : 's'} hidden. Show all</a>` : '';
    const wireShowAll = () => box.querySelector('[data-showall]')?.addEventListener('click', e => {
      e.preventDefault(); ui.range = 'all'; saveUi(); box.closest('#main').querySelector('#r-range').value = 'all'; renderTable(box);
    });
    if (!list.length) { box.innerHTML = `<div class="empty">No releases match these filters.${hiddenNote}</div>`; wireShowAll(); return; }
    const editable = FP.canWrite();
    const today = FP.today();
    let lastGroup = null, html = '';
    for (const r of list) {
      const g = ui.group === 'month' ? (r.release_date ? FP.monthLabel(r.release_date.slice(0, 7) + '-01') : 'No date') : ui.group === 'artist' ? r.artist : null;
      if (g !== null && g !== lastGroup) { html += `<tr class="group"><td colspan="${COLS.length + 1}">${esc(g)}</td></tr>`; lastGroup = g; }
      html += `<tr data-id="${r.id}" class="${r.release_date && r.release_date < today ? 'past' : ''}">${COLS.map(c => cell(r, c, editable)).join('')}
        <td class="row-actions">
          ${r.project_id ? `<a class="btn-ghost btn-sm" href="#/projects/${r.project_id}" title="Open project">Project ↗</a>` : ''}
          <button class="btn-ghost btn-sm" data-open title="Details">⋯</button>
        </td></tr>`;
    }
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl ${editable ? 'edit' : ''}">
      <thead><tr>${COLS.map(c => `<th class="sortable" data-k="${c.key}" style="min-width:${c.w}px">${c.label}${ui.sort === c.key ? (ui.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th style="min-width:110px"></th></tr></thead>
      <tbody>${html}</tbody></table></div>
      <div class="hint" style="margin-top:8px">${list.length} release${list.length === 1 ? '' : 's'} · Edits save as you go. Rows marked ↗ come from a project's Formats or Timeline. Artist, PM and label are edited on the project.${hiddenNote}</div>`;
    wireShowAll();
    box.querySelectorAll('th.sortable').forEach(th => th.onclick = () => {
      ui.dir = ui.sort === th.dataset.k ? -ui.dir : 1; ui.sort = th.dataset.k; saveUi(); renderTable(box);
    });
    box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
      const r = rows.find(x => x.id === b.closest('tr').dataset.id);
      openRelease(r, () => renderTable(box));
    });
    box.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', () => saveCell(inp)));
    box.querySelectorAll('td .status-seg').forEach(seg => seg.addEventListener('click', async e => {
      const b = e.target.closest('[data-status]'); if (!b || b.classList.contains('on')) return;
      const tr = seg.closest('tr'), r = rows.find(x => x.id === tr.dataset.id);
      tr.classList.add('saving');
      try { Object.assign(r, await FP.saveRecord('releases', r, { status: b.dataset.status })); seg.outerHTML = FP.statusToggle(r.status, { small: true }); renderTable(box); }
      catch (err) { if (err.status !== 409) FP.toast(err.message, true); }
      finally { tr.classList.remove('saving'); }
    }));
  }

  function cell(r, c, editable) {
    const v = r[c.key] || '';
    const locked = owned(r).includes(c.key);
    if (!editable || locked) {
      const shown = c.key === 'format' && isTimeline(r) ? '<span class="badge">Timeline</span>'
        : c.key === 'release_date' ? FP.fmtDate(v) : c.key === 'status' ? FP.statusBadge(v) : esc(v);
      return `<td${locked ? ' title="Edit on the project"' : ''} style="padding:6px 10px">${c.key === 'artist' ? `<span class="dot" style="background:${FP.statusColor(r.status)}"></span>` : ''}${shown}</td>`;
    }
    if (c.key === 'release_date') return `<td><input type="date" data-f="${c.key}" value="${esc(v)}"></td>`;
    if (c.key === 'status') return `<td style="padding:4px 6px">${FP.statusToggle(v, { small: true })}</td>`;
    if (c.list || c.users) return `<td><select data-f="${c.key}">${FP.options(c.users ? FP.userNames() : FP.list(c.list), v)}</select></td>`;
    return `<td><input type="text" data-f="${c.key}" value="${esc(v)}"${c.key === 'artist' ? ` list="${FP.artistDatalist()}"` : ''}></td>`;
  }

  async function saveCell(inp) {
    const tr = inp.closest('tr');
    const r = rows.find(x => x.id === tr.dataset.id);
    const k = inp.dataset.f, val = inp.value.trim();
    if ((k === 'artist' || k === 'title') && !val) { inp.value = r[k]; return FP.toast(`${k} can’t be blank`, true); }
    tr.classList.add('saving');
    try {
      Object.assign(r, await FP.saveRecord('releases', r, { [k]: val }));
      if (k === 'artist') FP.ensureArtistLocal(val);
    } catch (e) {
      inp.value = r[k] || '';
      if (e.status !== 409) FP.toast(e.message, true);
    } finally { tr.classList.remove('saving'); }
  }

  // ── CALENDAR ───────────────────────────────────────────────
  function renderCalendar(box) {
    box.innerHTML = '<div id="r-cal"></div>';
    cal = new FullCalendar.Calendar(box.querySelector('#r-cal'), {
      initialView: localStorageGet('fp_rel_calview') || 'dayGridMonth',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek,listMonth' },
      buttonText: { today: 'Today', month: 'Month', week: 'Week', list: 'List' },
      height: 'auto', firstDay: 0, editable: FP.canWrite(), dayMaxEvents: 6,
      datesSet: info => { try { localStorage.setItem('fp_rel_calview', info.view.type); } catch { /* ignore */ } },
      events: async (info, ok, fail) => {
        try {
          const from = FP.ymd(info.start), to = FP.ymd(info.end);
          const evs = filtered({ ignoreRange: true }).filter(r => r.release_date && r.release_date >= from && r.release_date < to).map(r => ({
            // Timeline items use their status color too; the ◆ marks them as campaign moments.
            id: 'r:' + r.id, title: `${isTimeline(r) ? '◆ ' : ''}${r.artist} — ${r.title}${r.format ? ' [' + r.format + ']' : ''}`, start: r.release_date, allDay: true,
            backgroundColor: FP.statusColor(r.status), borderColor: FP.statusColor(r.status), textColor: FP.statusTextColor(r.status),
            extendedProps: { kind: 'release', rec: r },
          }));
          if (ui.dates) {
            const ms = await FP.get(`/api/milestones?from=${from}&to=${to}`);
            const proj = await projectIndex();
            for (const m of ms) evs.push({
              id: 'm:' + m.id, title: `${m.done ? '✓ ' : ''}${proj[m.project_id]?.artist ? proj[m.project_id].artist + ': ' : ''}${m.title}`,
              start: m.date, allDay: true, backgroundColor: FP.INTERNAL_COLOR.bg, borderColor: FP.INTERNAL_COLOR.bg, textColor: FP.INTERNAL_COLOR.text,
              extendedProps: { kind: 'milestone', rec: m },
            });
          }
          ok(evs);
        } catch (e) { fail(e); FP.toast(e.message, true); }
      },
      eventClick: info => {
        const { kind, rec } = info.event.extendedProps;
        if (kind === 'release') openRelease(rec, () => cal.refetchEvents());
        else if (rec.project_id) location.hash = `#/projects/${rec.project_id}?tab=dates`;
        else FP.openMilestone(rec, () => cal.refetchEvents());
      },
      eventDrop: async info => {
        const { kind, rec } = info.event.extendedProps;
        const date = FP.ymd(info.event.start);
        try {
          if (kind === 'release') Object.assign(rec, await FP.saveRecord('releases', rec, { release_date: date }));
          else Object.assign(rec, await FP.saveRecord('milestones', rec, { date }));
          FP.toast(`Moved to ${FP.fmtDate(date)}`);
        } catch (e) { info.revert(); if (e.status !== 409) FP.toast(e.message, true); }
      },
    });
    cal.render();
  }

  function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }

  let _projIdx = null;
  async function projectIndex() {
    if (!_projIdx) _projIdx = Object.fromEntries((await FP.get('/api/projects')).map(p => [p.id, p]));
    return _projIdx;
  }

  // ── RELEASE MODAL ──────────────────────────────────────────
  function openRelease(r, after) {
    const linked = !!r.format_key;
    const ro = k => owned(r).includes(k) ? ' disabled' : '';
    const body = `
      ${linked ? `<p class="hint" style="margin-bottom:12px">${isTimeline(r)
        ? 'This is an item from a project\'s Timeline. Changes to its title and date are saved back to the project.'
        : 'This row comes from a project\'s Formats list. Changes to title, format, date, status, territory and cat # are saved back to the project.'} <a href="#/projects/${r.project_id}">Open project ↗</a></p>` : ''}
      <div class="grid">
        ${FP.field('Artist', `<input type="text" name="artist" list="${FP.artistDatalist()}" value="${esc(r.artist)}"${ro('artist')}>`)}
        ${FP.field('Title', `<input type="text" name="title" value="${esc(r.title)}">`)}
        ${FP.field('Format', `<select name="format">${FP.options(FP.list('formats'), r.format)}</select>`)}
        ${FP.field('Release date', `<input type="date" name="release_date" value="${esc(r.release_date)}">`)}
        ${FP.field('Project manager', `<select name="pm"${ro('pm')}>${FP.options(FP.userNames(), r.pm)}</select>`)}
        ${FP.field('Status', `<input type="hidden" name="status" value="${esc(r.status || FP.list('statuses')[0] || '')}"><div data-modal-status>${FP.statusToggle(r.status || FP.list('statuses')[0], { disabled: !!ro('status') })}</div>`)}
        ${FP.field('Territory', `<select name="territory">${FP.options(FP.list('territories'), r.territory)}</select>`)}
        ${FP.field('Label', `<select name="label"${ro('label')}>${FP.options(FP.list('labels'), r.label)}</select>`)}
        ${FP.field('Catalog #', `<input type="text" name="catalog" value="${esc(r.catalog)}">`)}
        ${FP.field('Notes', `<textarea name="notes">${esc(r.notes)}</textarea>`, 'wide')}
      </div>
      ${r.id && !r.project_id && FP.canWrite() ? '<p style="margin-top:12px"><button class="btn btn-sm" data-mkproj>Create a project from this release</button></p>' : ''}`;
    const m = FP.modal({
      title: r.id ? `${r.artist} — ${r.title}` : 'New release', body,
      onSave: FP.canWrite() ? async el => {
        const f = FP.readForm(el);
        for (const k of owned(r)) delete f[k];
        if (!r.id && (!f.artist || !f.title)) throw new Error('Artist and title are required');
        const saved = await FP.saveRecord('releases', r, f);
        if (r.id) Object.assign(r, saved); else rows.push(saved);
        FP.ensureArtistLocal(saved.artist);
        after?.();
      } : null,
      onDelete: r.id && FP.canWrite() ? async () => {
        if (linked && !confirm(`This also removes it from the project's ${isTimeline(r) ? 'Timeline' : 'Formats'}. Continue?`)) return false;
        await FP.del('/api/releases/' + r.id);
        rows = rows.filter(x => x.id !== r.id);
        after?.();
      } : null,
    });
    m.el.querySelector('[data-modal-status]')?.addEventListener('click', e => {
      const b = e.target.closest('[data-status]'); if (!b || b.disabled) return;
      m.el.querySelector('[name=status]').value = b.dataset.status;
      m.el.querySelector('[data-modal-status]').innerHTML = FP.statusToggle(b.dataset.status);
    });
    m.el.querySelector('[data-mkproj]')?.addEventListener('click', async () => {
      // Create the project, tie this row to it as a format, then save the
      // format list so the project's sync adopts the row instead of duplicating it.
      const p = await FP.post('/api/projects', {
        artist: r.artist, title: r.title, release_date: r.release_date, label: r.label, catalog: r.catalog, territory: r.territory, pm: r.pm, status: r.status,
        data: { formats: [] },
      });
      const key = crypto.randomUUID().slice(0, 8);
      await FP.put('/api/releases/' + r.id, { project_id: p.id, format_key: key });
      await FP.put('/api/projects/' + p.id, { data: { formats: [{ key, format: r.format || '', title: r.title, catalog: r.catalog || '', upc: '', release_date: r.release_date || '' }] } });
      m.close();
      location.hash = '#/projects/' + p.id;
    });
  }
  FP.openRelease = openRelease;
})();
