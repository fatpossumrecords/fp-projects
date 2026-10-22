/* ============================================================
   BUDGET — per-project budget planner (Budget tab on a project)
   Stored in project.data.budget. Saved with the project's Save
   button. Never included in the Google Doc (that's shared company-wide).
   ============================================================ */
(function () {
  const esc = FP.esc;
  const key = () => crypto.randomUUID().slice(0, 8);

  // Fat Possum's budget template: groups in three areas.
  const TEMPLATE = [
    ['marketing', 'Publicity', ['US Publicity', 'UK Publicity', 'Canada Publicity', 'LATAM PR', 'Germany PR', 'France PR', 'Benelux PR']],
    ['marketing', 'Videos', ['Video #1', 'Video #2', 'Video #3']],
    ['marketing', 'Radio', ['US - Non-Comm', 'US - Specialty', 'US - College', 'UK Radio', 'Australia']],
    ['marketing', 'Online / Digital Marketing', ['Facebook / Instagram', 'Twitter', 'YouTube', 'Google Ads', 'DSP / Playlisting', 'Third Party Ads (NPR / Aquarium Drunkard, etc.)']],
    ['marketing', 'Retail / Physical', ['Promo Merch / Value Add', 'Co-op', 'Poster', 'Poster Mailing']],
    ['marketing', 'Content', ['Bio', 'Photos', 'Styling / Wardrobe', 'Artwork', 'Digital Assets']],
    ['marketing', 'Tour Support', ['Tour Support', 'Ticket Buys']],
    ['marketing', 'Misc', ['Outdoor Advertising', 'Travel & Events', 'Release Event']],
    ['recording', 'Advance & Recording', ['Advance', 'Production', 'Studio Time', 'Mixing', 'Mastering']],
    ['manufacturing', 'Manufacturing', [['Vinyl', 4.70], ['CD', 1.20], ['Cassettes', null]]],
  ];
  const AREAS = [['marketing', 'Marketing'], ['recording', 'Advance & Recording'], ['manufacturing', 'Manufacturing']];

  function template() {
    return {
      groups: TEMPLATE.map(([area, name, lines]) => ({
        key: key(), area, name,
        lines: lines.map(l => Array.isArray(l)
          ? { key: key(), account: l[0], qty: '', unit_cost: l[1] ?? '', budgeted: '', paid: '', notes: '' }
          : { key: key(), account: l, budgeted: '', paid: '', notes: '' }),
      })),
    };
  }

  const num = v => (v === '' || v == null || !Number.isFinite(Number(v))) ? 0 : Number(v);
  // Manufacturing lines with qty and unit cost budget themselves.
  const budgeted = l => (l.qty !== '' && l.qty != null && l.unit_cost !== '' && l.unit_cost != null) ? num(l.qty) * num(l.unit_cost) : num(l.budgeted);
  const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const sum = (lines, f) => lines.reduce((t, l) => t + f(l), 0);
  const totals = lines => { const b = sum(lines, budgeted), p = sum(lines, l => num(l.paid)); return { b, p, r: b - p }; };

  function render(box, proj, ro, onChange, hooks = {}) {
    // Fresh node each render so delegated listeners don't stack.
    const fresh = box.cloneNode(false); box.replaceWith(fresh); box = fresh;
    // A project with no budget yet shows the template, but it's only stored once
    // something is edited, so just opening the tab doesn't count as a change.
    const bd = proj.data.budget && Array.isArray(proj.data.budget.groups) ? proj.data.budget : template();
    const changed = onChange;
    onChange = () => { if (proj.data.budget !== bd) proj.data.budget = bd; changed(); };
    const dis = ro ? ' disabled' : '';
    const remCell = r => `<span style="color:${r < 0 ? 'var(--red)' : r > 0 ? 'var(--text)' : 'var(--text-muted)'};font-weight:${r < 0 ? 600 : 400}">${r < 0 ? money(-r) + ' over' : money(r)}</span>`;

    const summary = () => {
      const all = bd.groups.flatMap(g => g.lines);
      const card = (label, t, strong) => {
        const pct = t.b ? Math.min(100, Math.round(t.p / t.b * 100)) : 0;
        return `<div class="card" style="cursor:default;gap:4px${strong ? ';border-color:var(--text)' : ''}">
          <div class="c-artist">${label}</div>
          <div style="font-size:18px;font-weight:600">${money(t.b)}</div>
          <div class="hint">Paid ${money(t.p)} · ${t.r < 0 ? `<b style="color:var(--red)">${money(-t.r)} over</b>` : `${money(t.r)} left`}</div>
          <div style="height:5px;background:var(--surface2);border-radius:3px;overflow:hidden"><div style="height:100%;width:${t.b ? pct : 0}%;background:${t.r < 0 ? 'var(--red)' : 'var(--green)'}"></div></div>
        </div>`;
      };
      const by = a => totals(bd.groups.filter(g => g.area === a).flatMap(g => g.lines));
      return `<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));margin-bottom:14px">
        ${card('Marketing', by('marketing'))}
        ${card('Advance & Recording', by('recording'))}
        ${card('Manufacturing', by('manufacturing'))}
        ${card('Grand total', totals(all), true)}</div>`;
    };

    const groupBox = (g, gi) => {
      const mfg = g.area === 'manufacturing';
      const t = totals(g.lines);
      const at = (li, k) => `data-g="${gi}" data-l="${li}" data-k="${k}"${dis}`;
      return `<div class="form-section" style="margin-bottom:10px">
        <h3 style="text-transform:none;letter-spacing:0;gap:8px;padding:6px 10px">
          <input type="text" data-g="${gi}" data-gk="name" value="${esc(g.name)}"${dis} style="font-weight:600;flex:1;max-width:320px">
          <select data-g="${gi}" data-gk="area"${dis}>${AREAS.map(([v, l]) => `<option value="${v}"${v === g.area ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <span class="spacer"></span>
          <span class="hint">${money(t.b)} budgeted · ${money(t.p)} paid</span>
          ${ro ? '' : `<button class="btn-ghost btn-sm" data-del-group="${gi}" title="Remove category">✕</button>`}
        </h3>
        <div class="fs-body" style="padding:4px 8px 8px"><div class="rep compact"><table>
          <thead><tr><th>Account</th>${mfg ? '<th style="width:80px">Qty</th><th style="width:90px">Unit cost</th>' : ''}<th style="width:120px">Budgeted</th><th style="width:120px">Paid</th><th style="width:120px">Remaining</th><th>Notes</th><th></th></tr></thead>
          <tbody>${g.lines.map((l, li) => {
            const auto = mfg && l.qty !== '' && l.unit_cost !== '' && l.qty != null && l.unit_cost != null;
            return `<tr>
              <td><input type="text" ${at(li, 'account')} value="${esc(l.account)}"></td>
              ${mfg ? `<td><input type="number" min="0" step="1" ${at(li, 'qty')} value="${esc(l.qty)}" placeholder="—"></td>
                <td><input type="number" min="0" step="0.01" ${at(li, 'unit_cost')} value="${esc(l.unit_cost)}" placeholder="—"></td>` : ''}
              <td>${auto ? `<span style="padding:3px 6px;display:block" data-auto="${gi}:${li}">${money(budgeted(l))}</span>` : `<input type="number" step="0.01" ${at(li, 'budgeted')} value="${esc(l.budgeted)}" placeholder="0">`}</td>
              <td><input type="number" step="0.01" ${at(li, 'paid')} value="${esc(l.paid)}" placeholder="0"></td>
              <td style="padding:3px 6px" data-rem="${gi}:${li}">${remCell(budgeted(l) - num(l.paid))}</td>
              <td><input type="text" ${at(li, 'notes')} value="${esc(l.notes)}"></td>
              <td style="width:30px">${ro ? '' : `<button class="btn-ghost btn-sm" data-del-line="${gi}:${li}" title="Remove">✕</button>`}</td></tr>`;
          }).join('')}
          <tr><td style="padding:4px 6px"><b>Total</b></td>${mfg ? '<td></td><td></td>' : ''}<td style="padding:4px 6px"><b data-gt="${gi}:b">${money(t.b)}</b></td><td style="padding:4px 6px"><b data-gt="${gi}:p">${money(t.p)}</b></td><td style="padding:4px 6px" data-gt="${gi}:r">${remCell(t.r)}</td><td></td><td></td></tr>
          </tbody></table>
          ${ro ? '' : `<button class="btn btn-sm add" data-add-line="${gi}">+ Add line</button>`}</div></div></div>`;
    };

    const draw = () => {
      const sheet = proj.data.budget_sheet;
      box.innerHTML = `<div class="toolbar" style="margin-bottom:10px">
          ${FP.safeUrl(sheet?.url) ? `<a class="btn btn-sm" href="${esc(sheet.url)}" target="_blank" rel="noopener">Open Google Sheet ↗</a>` : ''}
          ${!ro && hooks.pushSheet ? `<button class="btn btn-sm" data-push-sheet>${sheet?.id ? 'Update Google Sheet' : 'Create Google Sheet'}</button>` : ''}
          <span class="hint">${sheet?.updated ? `Sheet last updated ${new Date(sheet.updated).toLocaleString()}. ` : ''}The sheet keeps working formulas; editing it there doesn't change the app, and an update replaces it.</span></div>
        <div id="bd-summary">${summary()}</div>
        ${AREAS.map(([area, label]) => {
          const gs = bd.groups.map((g, i) => [g, i]).filter(([g]) => g.area === area);
          return gs.length ? `<h3 style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);margin:16px 0 8px">${label}</h3>${gs.map(([g, i]) => groupBox(g, i)).join('')}` : '';
        }).join('')}
        ${ro ? '' : `<div class="toolbar" style="margin-top:8px">${AREAS.map(([v, l]) => `<button class="btn btn-sm" data-add-group="${v}">+ ${l} category</button>`).join('')}
          <span class="spacer"></span><button class="btn-ghost btn-sm" data-reset>Reset to template</button></div>`}
        <p class="hint" style="margin-top:10px">Budget saves with the project's <b>Save</b> button. It isn't included in the Google Doc. Remaining is budgeted minus paid; overages show in red.</p>`;
    };

    // Typing updates numbers in place (no full re-render, so focus stays put).
    const refreshNumbers = gi => {
      const g = bd.groups[gi], t = totals(g.lines);
      g.lines.forEach((l, li) => {
        const rem = box.querySelector(`[data-rem="${gi}:${li}"]`); if (rem) rem.innerHTML = remCell(budgeted(l) - num(l.paid));
        const auto = box.querySelector(`[data-auto="${gi}:${li}"]`); if (auto) auto.textContent = money(budgeted(l));
      });
      const set = (k, html) => { const el = box.querySelector(`[data-gt="${gi}:${k}"]`); if (el) el.innerHTML = html; };
      set('b', money(t.b)); set('p', money(t.p)); set('r', remCell(t.r));
      box.querySelector('#bd-summary').innerHTML = summary();
    };

    box.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.gk === 'name') { bd.groups[+t.dataset.g].name = t.value; onChange(); return; }
      if (t.dataset.l === undefined) return;
      const gi = +t.dataset.g, line = bd.groups[gi].lines[+t.dataset.l];
      line[t.dataset.k] = t.value;
      onChange();
      if (['budgeted', 'paid'].includes(t.dataset.k)) refreshNumbers(gi);
    });
    box.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.gk === 'area') { bd.groups[+t.dataset.g].area = t.value; draw(); onChange(); }
      // Qty / unit cost switch Budgeted between typed and calculated, so redraw.
      if (['qty', 'unit_cost'].includes(t.dataset.k)) { draw(); onChange(); }
    });
    box.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.matches('[data-push-sheet]')) { t.disabled = true; Promise.resolve(hooks.pushSheet()).finally(() => { t.disabled = false; }); return; }
      if (t.dataset.addLine !== undefined) {
        const g = bd.groups[+t.dataset.addLine];
        g.lines.push(g.area === 'manufacturing' ? { key: key(), account: '', qty: '', unit_cost: '', budgeted: '', paid: '', notes: '' } : { key: key(), account: '', budgeted: '', paid: '', notes: '' });
        draw(); onChange();
        box.querySelector(`[data-g="${t.dataset.addLine}"][data-l="${g.lines.length - 1}"][data-k="account"]`)?.focus();
      }
      if (t.dataset.delLine) {
        const [gi, li] = t.dataset.delLine.split(':').map(Number);
        const l = bd.groups[gi].lines[li];
        if ((num(l.paid) || num(l.budgeted)) && !confirm(`Remove “${l.account || 'this line'}”? It has amounts entered.`)) return;
        bd.groups[gi].lines.splice(li, 1); draw(); onChange();
      }
      if (t.dataset.addGroup) {
        bd.groups.push({ key: key(), area: t.dataset.addGroup, name: 'New category', lines: [{ key: key(), account: '', budgeted: '', paid: '', notes: '' }] });
        draw(); onChange();
        box.querySelector(`[data-g="${bd.groups.length - 1}"][data-gk="name"]`)?.select();
      }
      if (t.dataset.delGroup !== undefined) {
        const g = bd.groups[+t.dataset.delGroup];
        if (g.lines.some(l => num(l.paid) || num(l.budgeted)) && !confirm(`Remove the “${g.name}” category and all its lines?`)) return;
        bd.groups.splice(+t.dataset.delGroup, 1); draw(); onChange();
      }
      if (t.matches('[data-reset]')) {
        if (!confirm('Replace this budget with a blank copy of the template? Amounts entered here will be cleared.')) return;
        proj.data.budget = template(); render(box, proj, ro, changed); changed();
      }
    });
    draw();
  }

  // ── GOOGLE SHEET ───────────────────────────────────────────
  // Rows for the Sheets API, with live formulas so the sheet keeps working on its own:
  // Remaining = Budgeted − Paid, Qty × Unit cost, category / area / grand totals.
  function sheetRows(proj) {
    const bd = proj.data.budget && Array.isArray(proj.data.budget.groups) ? proj.data.budget : template();
    const CUR = '"$"#,##0.00;[Red]-"$"#,##0.00';
    const fmt = (o = {}) => ({ textFormat: { bold: !!o.bold, fontSize: o.size || 10, foregroundColor: o.muted ? { red: .48, green: .45, blue: .41 } : undefined },
      ...(o.bg ? { backgroundColor: o.bg } : {}), ...(o.cur ? { numberFormat: { type: 'CURRENCY', pattern: CUR } } : {}), ...(o.num ? { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } : {}) });
    const S = (v, o) => ({ userEnteredValue: { stringValue: String(v ?? '') }, userEnteredFormat: fmt(o) });
    const N = (v, o) => (v === '' || v == null || !Number.isFinite(Number(v))) ? S('', o) : { userEnteredValue: { numberValue: Number(v) }, userEnteredFormat: fmt(o) };
    const F = (f, o) => ({ userEnteredValue: { formulaValue: f }, userEnteredFormat: fmt(o) });
    const shade = { red: .95, green: .94, blue: .92 }, band = { red: .99, green: .93, blue: .92 };
    const rows = [];
    const push = cells => { rows.push({ values: cells }); return rows.length; };   // returns the 1-based row number

    push([S(`${proj.artist} — ${proj.title} · Budget`, { bold: true, size: 14 })]);
    push([S(`Fat Possum Records · updated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} from the project system`, { muted: true })]);
    push([]);
    push(['Account', 'Qty', 'Unit cost', 'Budgeted', 'Paid', 'Remaining', 'Notes'].map(h => S(h, { bold: true, bg: shade })));
    const areaTotals = [];
    for (const [area, label] of AREAS) {
      const groups = bd.groups.filter(g => g.area === area);
      if (!groups.length) continue;
      push([S(label.toUpperCase(), { bold: true, bg: band }), ...Array(6).fill(S('', { bg: band }))]);
      const groupTotals = [];
      for (const g of groups) {
        push([S(g.name, { bold: true })]);
        const first = rows.length + 1;
        for (const l of g.lines) {
          const r = rows.length + 1;
          const hasQty = l.qty !== '' && l.qty != null && l.unit_cost !== '' && l.unit_cost != null;
          push([S('   ' + (l.account || '')), N(l.qty, { num: true }), N(l.unit_cost, { cur: true }),
            hasQty ? F(`=B${r}*C${r}`, { cur: true }) : N(l.budgeted === '' ? 0 : l.budgeted, { cur: true }),
            N(l.paid === '' ? 0 : l.paid, { cur: true }), F(`=D${r}-E${r}`, { cur: true }), S(l.notes)]);
        }
        const last = rows.length;
        const t = rows.length + 1;
        push([S('Total ' + g.name, { bold: true }), S(''), S(''),
          F(last >= first ? `=SUM(D${first}:D${last})` : '=0', { cur: true, bold: true }), F(last >= first ? `=SUM(E${first}:E${last})` : '=0', { cur: true, bold: true }),
          F(`=D${t}-E${t}`, { cur: true, bold: true }), S('')]);
        groupTotals.push(t);
      }
      const at = rows.length + 1;
      const sumOf = col => '=' + groupTotals.map(r => col + r).join('+');
      push([S(label + ' total', { bold: true, bg: shade }), S('', { bg: shade }), S('', { bg: shade }), F(sumOf('D'), { cur: true, bold: true, bg: shade }), F(sumOf('E'), { cur: true, bold: true, bg: shade }), F(`=D${at}-E${at}`, { cur: true, bold: true, bg: shade }), S('', { bg: shade })]);
      push([]);
      areaTotals.push(at);
    }
    const gt = rows.length + 1;
    const sumAreas = col => areaTotals.length ? '=' + areaTotals.map(r => col + r).join('+') : '=0';
    push([S('GRAND TOTAL', { bold: true, size: 11 }), S(''), S(''), F(sumAreas('D'), { cur: true, bold: true, size: 11 }), F(sumAreas('E'), { cur: true, bold: true, size: 11 }), F(`=D${gt}-E${gt}`, { cur: true, bold: true, size: 11 }), S('')]);
    return rows;
  }

  function sheetSpec(proj) {
    return {
      properties: { title: `${proj.artist} — ${proj.title} (Budget)` },
      sheets: [{
        properties: { title: 'Budget', gridProperties: { frozenRowCount: 4 } },
        data: [{ startRow: 0, startColumn: 0, rowData: sheetRows(proj), columnMetadata: [280, 70, 90, 110, 110, 120, 260].map(pixelSize => ({ pixelSize })) }],
      }],
    };
  }

  FP.budget = { render, template, sheetSpec, sheetRows, totals: b => totals((b?.groups || []).flatMap(g => g.lines)) };
})();
