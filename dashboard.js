/* ============================================================
   DASHBOARD — Spotify monthly listeners for current projects
   One stat tile per artist: value · change vs 30 days ago · sparkline.
   Data comes from Chartmetric via the Worker (cached 12 hours).
   ============================================================ */
(function () {
  const esc = FP.esc;
  const C = { line: '#b8b3aa', now: '#b83228', up: '#1e7e4a', down: '#b83228', flat: '#7a7468', grid: '#e4e0d8' };
  let ui = { range: 90, sort: 'release', view: 'tiles' };
  try { Object.assign(ui, JSON.parse(localStorage.getItem('fp_dash_ui') || '{}')); } catch { /* defaults */ }
  const saveUi = () => { try { localStorage.setItem('fp_dash_ui', JSON.stringify(ui)); } catch { /* ignore */ } };

  const compact = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(Math.round(n));
  const full = n => n == null ? '—' : Math.round(n).toLocaleString('en-US');

  // Change over the chosen window, from the series itself (first vs last point in range).
  function windowed(a) {
    const from = FP.addDays(FP.today(), -ui.range);
    const pts = a.points.filter(([d]) => d >= from);
    if (pts.length < 2) return { pts, diff: null, pct: null };
    const first = pts[0][1], last = pts[pts.length - 1][1];
    return { pts, diff: last - first, pct: first ? (last - first) / first * 100 : null };
  }

  FP.route('dashboard', async main => {
    main.innerHTML = `<div class="page-head"><h2>Dashboard</h2>
        <span class="hint" id="db-status"></span></div>
      <div class="page-body">
        <div class="toolbar" style="margin-bottom:14px">
          <div class="seg" id="db-range">${[[30, '30 days'], [90, '90 days'], [182, '6 months']].map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>
          <select id="db-sort"><option value="release">Sort: release date</option><option value="growth">Sort: biggest growth</option><option value="listeners">Sort: most listeners</option></select>
          <span class="spacer"></span>
          <div class="seg" id="db-view"><button data-v="tiles">Tiles</button><button data-v="table">Table</button></div>
          <button class="btn btn-sm" id="db-refresh" title="Fetch fresh numbers from Chartmetric">Refresh</button>
        </div>
        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);margin:0 0 4px">Spotify monthly listeners</h3>
        <p class="hint" style="margin:0 0 12px">Artists with a current project (unreleased, or released in the last 12 months).</p>
        <div id="db-body"><div class="empty">Loading…</div></div>
      </div>`;
    const $ = s => main.querySelector(s);
    $('#db-sort').value = ui.sort;
    let data = null;

    const load = async refresh => {
      $('#db-status').textContent = refresh ? 'Refreshing from Chartmetric…' : '';
      try { data = await FP.get('/api/dashboard/listeners' + (refresh ? '?refresh=1' : '')); }
      catch (e) { $('#db-body').innerHTML = `<div class="empty">Couldn't load listener data: ${esc(e.message)}</div>`; return; }
      $('#db-status').textContent = '';
      draw();
    };

    const draw = () => {
      main.querySelectorAll('#db-range button').forEach(b => b.classList.toggle('on', +b.dataset.v === ui.range));
      main.querySelectorAll('#db-view button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.view));
      const body = $('#db-body');
      if (!data.configured) { body.innerHTML = '<div class="empty">Connect Chartmetric to see listener trends.</div>'; return; }
      const items = data.artists.map(a => ({ ...a, w: windowed(a) }));
      const withData = items.filter(a => a.w.pts.length >= 2);
      if (ui.sort === 'growth') items.sort((x, y) => (y.w.pct ?? -1e9) - (x.w.pct ?? -1e9));
      if (ui.sort === 'listeners') items.sort((x, y) => (y.latest?.value ?? -1) - (x.latest?.value ?? -1));
      const ups = withData.filter(a => a.w.diff > 0).length, downs = withData.filter(a => a.w.diff < 0).length;
      const label = { 30: '30 days', 90: '90 days', 182: '6 months' }[ui.range];
      const summary = withData.length ? `<p style="margin:0 0 12px;font-size:13px">${ups} of ${withData.length} artist${withData.length === 1 ? '' : 's'} up over the last ${label}${downs ? `, ${downs} down` : ''}.</p>` : '';
      body.innerHTML = summary + (ui.view === 'table' ? table(items, label) : `<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr))">${items.map(tile).join('')}</div>`);
      body.querySelectorAll('[data-spark]').forEach(wireSpark);
    };

    const delta = (w, label) => {
      if (w.diff == null) return '<span class="hint">Not enough history yet</span>';
      const dir = w.diff > 0 ? 'up' : w.diff < 0 ? 'down' : 'flat';
      const arrow = { up: '▲', down: '▼', flat: '■' }[dir];
      return `<span style="color:${C[dir]};font-weight:600">${arrow} ${w.diff > 0 ? '+' : w.diff < 0 ? '−' : ''}${compact(Math.abs(w.diff))}${w.pct != null ? ` (${w.pct >= 0 ? '+' : '−'}${Math.abs(w.pct).toFixed(1)}%)` : ''}</span> <span class="hint">vs ${label} ago</span>`;
    };

    const tile = a => {
      const label = { 30: '30 days', 90: '90 days', 182: '6 months' }[ui.range];
      const proj = a.projects[0];
      return `<div class="card" style="cursor:default;gap:4px;border-top:3px solid ${FP.statusColor(proj.status)}">
        <div style="display:flex;align-items:baseline;gap:6px"><div class="c-artist" style="flex:1">${esc(a.artist)}</div>
          <a class="hint" href="#/projects/${proj.id}" title="${esc(a.projects.map(p => p.title).join(', '))}">${esc(proj.title)}${a.projects.length > 1 ? ` +${a.projects.length - 1}` : ''} ↗</a></div>
        ${a.error && !a.latest ? `<div class="hint" style="padding:16px 0">${esc(a.error)}. Use <b>Look up online</b> on the project to link it.</div>` : `
          <div style="font-size:24px;font-weight:600;line-height:1.1">${compact(a.latest?.value)}</div>
          <div style="font-size:12px">${delta(a.w, label)}</div>
          ${spark(a)}`}
      </div>`;
    };

    // Sparkline: de-emphasis line, today's point in the accent; hover shows date + value.
    const W = 230, Hh = 56, P = 4;
    const spark = a => {
      const pts = a.w.pts;
      if (pts.length < 2) return '';
      const t0 = FP.parseYmd(pts[0][0]).getTime(), t1 = FP.parseYmd(pts[pts.length - 1][0]).getTime() || t0 + 1;
      const vs = pts.map(p => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
      const xy = pts.map(([d, v]) => [P + (FP.parseYmd(d).getTime() - t0) / ((t1 - t0) || 1) * (W - 2 * P), P + (1 - (v - lo) / span) * (Hh - 2 * P)]);
      const path = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
      const [lx, ly] = xy[xy.length - 1];
      return `<div style="position:relative" data-spark='${esc(JSON.stringify({ pts, xy }))}'>
        <svg viewBox="0 0 ${W} ${Hh}" width="100%" height="${Hh}" preserveAspectRatio="none" role="img" aria-label="${esc(a.artist)} monthly listeners, ${compact(vs[0])} to ${compact(vs[vs.length - 1])}">
          <path d="${path}" fill="none" stroke="${C.line}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
          <line class="sp-x" x1="0" x2="0" y1="0" y2="${Hh}" stroke="${C.flat}" stroke-width="1" vector-effect="non-scaling-stroke" style="display:none"/>
        </svg>
        <span style="position:absolute;left:${(lx / W * 100).toFixed(2)}%;top:${ly.toFixed(1)}px;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:${C.now};box-shadow:0 0 0 2px #fff;pointer-events:none"></span>
        <div class="sp-tip" style="display:none;position:absolute;top:-30px;transform:translateX(-50%);background:var(--text);color:var(--surface);font-size:11px;padding:2px 7px;border-radius:4px;white-space:nowrap;pointer-events:none"></div>
        <div style="display:flex;justify-content:space-between" class="hint"><span>${esc(FP.fmtDate(pts[0][0], { month: 'short', day: 'numeric' }))}</span><span>${esc(FP.fmtDate(pts[pts.length - 1][0], { month: 'short', day: 'numeric' }))}</span></div>
      </div>`;
    };

    function wireSpark(el) {
      const { pts, xy } = JSON.parse(el.dataset.spark);
      const svg = el.querySelector('svg'), line = el.querySelector('.sp-x'), tip = el.querySelector('.sp-tip');
      const show = clientX => {
        const r = svg.getBoundingClientRect();
        const x = (clientX - r.left) / r.width * W;
        let i = 0; for (let j = 1; j < xy.length; j++) if (Math.abs(xy[j][0] - x) < Math.abs(xy[i][0] - x)) i = j;
        line.setAttribute('x1', xy[i][0]); line.setAttribute('x2', xy[i][0]); line.style.display = '';
        tip.textContent = `${full(pts[i][1])} · ${FP.fmtDate(pts[i][0], { month: 'short', day: 'numeric', year: 'numeric' })}`;
        tip.style.left = (xy[i][0] / W * r.width) + 'px'; tip.style.display = '';
      };
      const hide = () => { line.style.display = 'none'; tip.style.display = 'none'; };
      svg.addEventListener('pointermove', e => show(e.clientX));
      svg.addEventListener('pointerleave', hide);
      svg.setAttribute('tabindex', '0');
      svg.addEventListener('focus', () => { const r = svg.getBoundingClientRect(); show(r.right - 1); });
      svg.addEventListener('blur', hide);
    }

    const table = (items, label) => `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Artist</th><th>Project</th><th style="text-align:right">Monthly listeners</th>
        <th style="text-align:right">Change vs ${label} ago</th><th style="text-align:right">Low in range</th><th style="text-align:right">High in range</th><th>As of</th></tr></thead><tbody>
      ${items.map(a => { const vs = a.w.pts.map(p => p[1]); return `<tr><td>${esc(a.artist)}</td><td><a href="#/projects/${a.projects[0].id}">${esc(a.projects.map(p => p.title).join(', '))}</a></td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${full(a.latest?.value)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${a.w.diff == null ? '<span class="hint">—</span>' : delta(a.w, label).replace(/<span class="hint">vs.*$/, '')}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${vs.length ? full(Math.min(...vs)) : '—'}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${vs.length ? full(Math.max(...vs)) : '—'}</td>
        <td class="hint">${a.latest?.date ? esc(FP.fmtDate(a.latest.date)) : esc(a.error || '')}</td></tr>`; }).join('')}
      </tbody></table></div>`;

    main.querySelectorAll('#db-range button').forEach(b => b.onclick = () => { ui.range = +b.dataset.v; saveUi(); draw(); });
    main.querySelectorAll('#db-view button').forEach(b => b.onclick = () => { ui.view = b.dataset.v; saveUi(); draw(); });
    $('#db-sort').onchange = e => { ui.sort = e.target.value; saveUi(); draw(); };
    $('#db-refresh').onclick = () => load(true);
    load(false);
  });
})();
