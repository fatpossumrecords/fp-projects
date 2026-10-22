/* ============================================================
   P&L — per-project profit & loss forecast (P&L tab on a project)
   Income forecast + deductions + the Budget tab's costs, under the
   project's deal (net profit split or royalty). Stored in
   project.data.pnl, saved with the project. Not in the Google Doc.
   ============================================================ */
(function () {
  const esc = FP.esc;
  const key = () => crypto.randomUUID().slice(0, 8);
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v))) ? 0 : Number(v);
  // A forecast, so whole dollars.
  const money = n => (Math.round(n) < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  const isPhysical = f => f && !/^digital/i.test(f);

  // Starting assumptions: placeholders to adjust per project, not Fat Possum's terms.
  function defaults() {
    return {
      deal: 'profit_split', artist_split: 50,
      royalty_rate: 18, sync_share: 50, recoup_recording: 100, recoup_marketing: 50,
      dist_fee: 20, returns_reserve: 10,
      mech_rate: 0.127, mech_tracks: '', mech_cc: 100,
      physical: [],                 // { key, format_key, format, units, ppd }
      streams: '', stream_rate: 0.004, downloads: '',
      d2c: [], d2c_fee: 15,         // { key, item, units, price }
      sync: [],                     // { key, name, amount }
      notes: '',
    };
  }

  // Physical rows follow the project's formats; extra rows the team added stay.
  function syncFormats(pl, proj) {
    const fmts = (proj.data.formats || []).filter(f => isPhysical(f.format));
    for (const f of fmts) {
      const row = pl.physical.find(r => r.format_key === f.key);
      if (row) row.format = f.format; else pl.physical.push({ key: key(), format_key: f.key, format: f.format, units: '', ppd: '' });
    }
    pl.physical = pl.physical.filter(r => !r.format_key || fmts.some(f => f.key === r.format_key));
  }

  function compute(pl, proj) {
    const bt = area => FP.budget.totals({ groups: (proj.data.budget?.groups || FP.budget.template().groups).filter(g => g.area === area) }).b;
    const costs = { marketing: bt('marketing'), recording: bt('recording'), manufacturing: bt('manufacturing') };
    costs.total = costs.marketing + costs.recording + costs.manufacturing;
    const physUnits = pl.physical.reduce((t, r) => t + num(r.units), 0);
    const physGross = pl.physical.reduce((t, r) => t + num(r.units) * num(r.ppd), 0);
    const returns = physGross * num(pl.returns_reserve) / 100;
    const digital = num(pl.streams) * num(pl.stream_rate) + num(pl.downloads);
    const distFee = (physGross - returns + digital) * num(pl.dist_fee) / 100;
    const d2cGross = pl.d2c.reduce((t, r) => t + num(r.units) * num(r.price), 0);
    const d2cUnits = pl.d2c.reduce((t, r) => t + num(r.units), 0);
    const d2cFees = d2cGross * num(pl.d2c_fee) / 100;
    const sync = pl.sync.reduce((t, r) => t + num(r.amount), 0);
    const tracks = pl.mech_tracks !== '' ? num(pl.mech_tracks) : (proj.data.tracks || []).filter(t => t.song).length;
    const mechanicals = (physUnits + d2cUnits) * tracks * num(pl.mech_rate) * num(pl.mech_cc) / 100;
    const netReceipts = physGross - returns + digital - distFee + d2cGross - d2cFees + sync;
    const r = { costs, physUnits, physGross, returns, digital, distFee, d2cGross, d2cFees, d2cUnits, sync, tracks, mechanicals, netReceipts };
    if (pl.deal === 'royalty') {
      const nonSync = netReceipts - sync;
      r.royalties = nonSync * num(pl.royalty_rate) / 100 + sync * num(pl.sync_share) / 100;
      r.recoupable = costs.recording * num(pl.recoup_recording) / 100 + costs.marketing * num(pl.recoup_marketing) / 100;
      r.unrecouped = Math.max(0, r.recoupable - r.royalties);
      r.artistPay = Math.max(0, r.royalties - r.recoupable);
      r.labelProfit = netReceipts - mechanicals - costs.total - r.artistPay;
      r.breakEven = r.labelProfit < 0 ? -r.labelProfit : 0;
    } else {
      r.profit = netReceipts - mechanicals - costs.total;
      r.artistPay = r.profit > 0 ? r.profit * num(pl.artist_split) / 100 : 0;
      r.labelProfit = r.profit - r.artistPay;
      r.breakEven = r.profit < 0 ? -r.profit : 0;
    }
    return r;
  }

  function render(box, proj, ro, onChange) {
    const fresh = box.cloneNode(false); box.replaceWith(fresh); box = fresh;
    // As with the budget: defaults are only stored once something is edited.
    const pl = proj.data.pnl ? Object.assign(defaults(), proj.data.pnl) : defaults();
    const changed = () => { if (proj.data.pnl !== pl) proj.data.pnl = pl; onChange(); };
    syncFormats(pl, proj);
    const dis = ro ? ' disabled' : '';
    const inp = (k, o = {}) => `<input type="number" data-pk="${k}" value="${esc(pl[k])}" step="${o.step || 'any'}" min="0"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${dis} style="width:${o.w || 90}px">`;
    const rowInp = (list, i, k, o = {}) => `<input type="${o.text ? 'text' : 'number'}" data-pl="${list}" data-i="${i}" data-k="${k}" value="${esc(pl[list][i][k])}"${o.text ? '' : ' step="any" min="0"'}${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${dis}>`;
    const field = (label, html, hint) => `<div class="field"><label>${label}</label><div style="display:flex;gap:6px;align-items:center">${html}</div>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
    const neg = n => n < 0 ? `<span style="color:var(--red);font-weight:600">${money(n)}</span>` : money(n);

    const statement = r => {
      const line = (label, v, o = {}) => `<tr${o.total ? ' style="font-weight:600;border-top:1px solid var(--border2)"' : ''}><td style="padding:3px 10px 3px ${o.indent ? 22 : 10}px">${label}</td><td style="padding:3px 10px;text-align:right;white-space:nowrap">${o.blank ? '' : (o.minus && v ? '−' + money(v).replace('−', '') : neg(v))}</td></tr>`;
      const head = t => `<tr><td colspan="2" style="padding:10px 10px 3px;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);font-weight:600">${t}</td></tr>`;
      return `<div class="tbl-wrap"><table class="tbl" style="font-size:13px"><tbody>
        ${head('Income')}
        ${line(`Physical sales <span class="hint">(${r.physUnits.toLocaleString('en-US')} units)</span>`, r.physGross, { indent: true })}
        ${line('Returns reserve', r.returns, { indent: true, minus: true })}
        ${line('Digital', r.digital, { indent: true })}
        ${line('Distribution fee', r.distFee, { indent: true, minus: true })}
        ${line(`Direct to fan <span class="hint">(${r.d2cUnits.toLocaleString('en-US')} units)</span>`, r.d2cGross, { indent: true })}
        ${line('Direct-to-fan fees', r.d2cFees, { indent: true, minus: true })}
        ${line('Sync &amp; licensing', r.sync, { indent: true })}
        ${line('Net receipts', r.netReceipts, { total: true })}
        ${head('Costs')}
        ${line(`Mechanicals <span class="hint">(${r.tracks} track${r.tracks === 1 ? '' : 's'})</span>`, r.mechanicals, { indent: true, minus: true })}
        ${line('Marketing <span class="hint">(Budget)</span>', r.costs.marketing, { indent: true, minus: true })}
        ${line('Advance &amp; recording <span class="hint">(Budget)</span>', r.costs.recording, { indent: true, minus: true })}
        ${line('Manufacturing <span class="hint">(Budget)</span>', r.costs.manufacturing, { indent: true, minus: true })}
        ${pl.deal === 'royalty'
          ? `${line('Artist royalty payout', r.artistPay, { indent: true, minus: true })}
             ${line('Label profit', r.labelProfit, { total: true })}`
          : `${line('Profit before split', r.profit, { total: true })}
             ${line(`Artist share (${num(pl.artist_split)}%)`, r.artistPay, { indent: true, minus: true })}
             ${line('Label profit', r.labelProfit, { total: true })}`}
      </tbody></table></div>`;
    };

    const cards = r => {
      const card = (label, v, sub, strong) => `<div class="card" style="cursor:default;gap:3px${strong ? ';border-color:var(--text)' : ''}">
        <div class="c-artist">${label}</div><div style="font-size:18px;font-weight:600">${neg(v)}</div>${sub ? `<div class="hint">${sub}</div>` : ''}</div>`;
      return `<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr));margin-bottom:12px">
        ${card('Net receipts', r.netReceipts, 'after fees and reserves')}
        ${card('Costs', r.costs.total + r.mechanicals, 'budget + mechanicals')}
        ${card('Label profit', r.labelProfit, r.breakEven ? `<span style="color:var(--red)">${money(r.breakEven)} short of break-even</span>` : 'at or above break-even', true)}
        ${pl.deal === 'royalty'
          ? card('Artist', r.artistPay, r.unrecouped ? `${money(r.unrecouped)} unrecouped` : `royalties ${money(r.royalties)}`)
          : card('Artist share', r.artistPay, r.profit > 0 ? `${num(pl.artist_split)}% of profit` : 'no profit to split')}
      </div>`;
    };

    const drawResults = () => {
      const r = compute(pl, proj);
      box.querySelector('#pl-cards').innerHTML = cards(r);
      box.querySelector('#pl-statement').innerHTML = statement(r);
    };

    const listTable = (list, cols, addLabel) => `<div class="rep compact"><table><thead><tr>${cols.map(c => `<th${c.w ? ` style="width:${c.w}px"` : ''}>${c.label}</th>`).join('')}<th></th></tr></thead><tbody>
      ${pl[list].map((row, i) => `<tr>${cols.map(c => `<td>${c.fixed && row.format_key ? `<span style="padding:3px 6px;display:block">${esc(row[c.k])}</span>` : rowInp(list, i, c.k, { ...c, text: c.text || c.fixed })}</td>`).join('')}
        <td style="width:30px">${ro || row.format_key ? '' : `<button class="btn-ghost btn-sm" data-pl-del="${list}:${i}" title="Remove">✕</button>`}</td></tr>`).join('')}
      </tbody></table>${ro || !addLabel ? '' : `<button class="btn btn-sm add" data-pl-add="${list}">${addLabel}</button>`}</div>`;

    const draw = () => {
      box.innerHTML = `
        <p class="hint" style="margin-bottom:10px">A forecast built from your estimates below and the costs on the <b>Budget</b> tab. Starting rates are placeholders, so adjust them to the project's real terms. Saves with the project; not included in the Google Doc.</p>
        <div id="pl-cards"></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:14px;align-items:start">
          <div>
            <section class="form-section"><h3>Deal</h3><div class="fs-body">
              <div class="seg" style="margin-bottom:10px">${[['profit_split', 'Net profit split'], ['royalty', 'Royalty']].map(([v, l]) => `<button type="button" data-deal="${v}" class="${pl.deal === v ? 'on' : ''}"${dis}>${l}</button>`).join('')}</div>
              <div class="grid">${pl.deal === 'royalty'
                ? field('Royalty on net receipts', inp('royalty_rate', { w: 70 }) + '%') + field('Artist share of sync', inp('sync_share', { w: 70 }) + '%')
                  + field('Recording recoupable', inp('recoup_recording', { w: 70 }) + '%', 'of Advance & Recording') + field('Marketing recoupable', inp('recoup_marketing', { w: 70 }) + '%', 'of Marketing')
                : field('Artist share of profit', inp('artist_split', { w: 70 }) + '%', 'after all costs are recovered')}
              </div></div></section>
            <section class="form-section"><h3>Physical sales</h3><div class="fs-body">
              ${pl.physical.length ? listTable('physical', [{ k: 'format', label: 'Format', fixed: true }, { k: 'units', label: 'Units', w: 100, ph: '0' }, { k: 'ppd', label: 'Dealer price (PPD)', w: 140, ph: '$' }], '+ Add physical item')
                : `<p class="hint">Add physical formats on the Project Info tab, or ${ro ? '' : '<button class="btn btn-sm" data-pl-add="physical">add a physical item</button>'}</p>`}
              <div class="grid" style="margin-top:10px">${field('Returns reserve', inp('returns_reserve', { w: 70 }) + '%', 'of physical sales')}</div>
            </div></section>
            <section class="form-section"><h3>Digital</h3><div class="fs-body"><div class="grid">
              ${field('Streams', inp('streams', { w: 120, ph: '0' }))}
              ${field('Per-stream rate', '$' + inp('stream_rate', { w: 90 }), 'label share per stream (estimate)')}
              ${field('Downloads income', '$' + inp('downloads', { w: 110, ph: '0' }))}
              ${field('Distribution fee', inp('dist_fee', { w: 70 }) + '%', 'on physical and digital')}
            </div></div></section>
          </div>
          <div>
            <section class="form-section"><h3>Direct to fan</h3><div class="fs-body">
              ${listTable('d2c', [{ k: 'item', label: 'Item', text: true, ph: 'e.g. Bandcamp LP' }, { k: 'units', label: 'Units', w: 90, ph: '0' }, { k: 'price', label: 'Price', w: 100, ph: '$' }], '+ Add item')}
              <div class="grid" style="margin-top:10px">${field('Platform / payment fees', inp('d2c_fee', { w: 70 }) + '%')}</div>
            </div></section>
            <section class="form-section"><h3>Sync &amp; licensing</h3><div class="fs-body">
              ${listTable('sync', [{ k: 'name', label: 'Deal', text: true, ph: 'e.g. TV placement' }, { k: 'amount', label: 'Amount', w: 120, ph: '$' }], '+ Add deal')}
            </div></section>
            <section class="form-section"><h3>Mechanicals</h3><div class="fs-body"><div class="grid">
              ${field('Rate per track', '$' + inp('mech_rate', { w: 80 }), 'US statutory physical rate was 12.7¢ in 2025; check the current rate')}
              ${field('Tracks', inp('mech_tracks', { w: 70, ph: String((proj.data.tracks || []).filter(t => t.song).length) }), 'blank = tracklist count')}
              ${field('Controlled composition', inp('mech_cc', { w: 70 }) + '%', '100% = full rate')}
            </div><p class="hint" style="margin-top:6px">Applied to physical and direct-to-fan units.</p></div></section>
          </div>
        </div>
        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);margin:6px 0 8px">Forecast P&amp;L</h3>
        <div id="pl-statement" style="max-width:640px"></div>
        <div class="field" style="margin-top:12px;max-width:640px"><label>Notes</label><textarea data-pnotes rows="3"${dis}>${esc(pl.notes)}</textarea></div>`;
      drawResults();
    };

    box.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.pk) { pl[t.dataset.pk] = t.value; changed(); drawResults(); }
      else if (t.dataset.pl) { pl[t.dataset.pl][+t.dataset.i][t.dataset.k] = t.value; changed(); drawResults(); }
      else if (t.matches('[data-pnotes]')) { pl.notes = t.value; changed(); }
    });
    box.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t || ro) return;
      if (t.dataset.deal) { pl.deal = t.dataset.deal; changed(); draw(); }
      if (t.dataset.plAdd) {
        const blank = { physical: { format: 'Other', units: '', ppd: '' }, d2c: { item: '', units: '', price: '' }, sync: { name: '', amount: '' } }[t.dataset.plAdd];
        pl[t.dataset.plAdd].push({ key: key(), ...blank });
        if (t.dataset.plAdd === 'physical') pl.physical.at(-1).format = 'Other physical';
        changed(); draw();
      }
      if (t.dataset.plDel) { const [list, i] = t.dataset.plDel.split(':'); pl[list].splice(+i, 1); changed(); draw(); }
    });
    draw();
  }

  FP.pnl = { render, compute, defaults };
})();
