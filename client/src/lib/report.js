import { getTransformerType, TAPS, runSnapshot, runDailyScan, transformerOfPole, isTransformerId, systemLossW, dailyEnergyLossKwh, pvHostingBaseline, bessHostingBaseline, faultLevels, protectionCheck, C, describeReconductor, standardsOf, inverterSettings, transformerAgeing, thermalSettings } from './loadflow.js';
import { hostingLimitText, vufText } from './format.js';

function esc(v) {
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const LOAD_TYPE_LABEL = { general: 'General', ev: 'EV', evcs: 'EVCS', shop: 'Commercial Shop' };

function section(title, bodyHtml) {
  return `<div class="section"><h2>${esc(title)}</h2>${bodyHtml}</div>`;
}
function table(headers, rows) {
  if (rows.length === 0) return '<p class="empty">None</p>';
  return `<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
// A violation's `pole` is either a real pole id, or (for a "transformer overload" entry) the
// transformer's own id — this resolves either case to the owning transformer.
function txOfViolation(design, v) { return isTransformerId(design, v.pole) ? v.pole : transformerOfPole(design, v.pole); }

// Which pole/phase actually holds the highest (or lowest) voltage across a snapshot's poles —
// not just the value — so the daily profile can point at the specific location behind each
// hour's extreme, matching the same helper in the Daily Profile page.
function extremeVoltage(poleResults, better) {
  let best = null;
  poleResults.forEach(p => {
    ['A', 'B', 'C'].forEach(ph => {
      const value = p.volt[ph];
      if (!best || better(value, best.value)) best = { value, pole: p.id, phase: ph };
    });
  });
  return best;
}

// Renders `items` as one table per transformer (grouped by `groupKeyOf`) once a design has
// more than one, each prefixed with the transformer's name — otherwise a single flat table,
// identical to the single-transformer behaviour before this existed.
function perTxTable(design, items, groupKeyOf, headers, rowOf, emptyMsg) {
  const empty = emptyMsg || '<p class="empty">None</p>';
  if (design.transformers.length <= 1) {
    return items.length ? table(headers, items.map(rowOf)) : empty;
  }
  return design.transformers.map(tx => {
    const own = items.filter(it => groupKeyOf(it) === tx.id);
    return `<p style="font-weight:600;margin:10px 0 4px">${esc(tx.name || tx.id)}</p>` + (own.length ? table(headers, own.map(rowOf)) : empty);
  }).join('');
}

function snapshotSectionBody(design, res) {
  if (!res) return '<p class="empty">No simulation has been run yet.</p>';
  const { txLossW: totalTxLossW, totalLossW: totalSystemLossW } = systemLossW(res);
  const violationsTable = perTxTable(
    design, res.violations, v => txOfViolation(design, v),
    ['Pole', 'Phase', 'Issue', 'Value'], v => [esc(v.pole), esc(v.phase), esc(v.type), v.value.toFixed(1)],
    '<p class="empty">None at this snapshot.</p>'
  );
  const poleVoltTable = perTxTable(
    design, res.poleResults, p => transformerOfPole(design, p.id),
    ['Pole', 'Feeder', 'V-A', 'V-B', 'V-C', 'VUF'], p => [esc(p.id), esc(p.feeder), p.volt.A.toFixed(1), p.volt.B.toFixed(1), p.volt.C.toFixed(1), vufText(p.vufPct)]
  );
  const currentTable = perTxTable(
    design, res.poleResults, p => transformerOfPole(design, p.id),
    ['Pole', 'I-A (A)', 'I-B (A)', 'I-C (A)', 'I-N (A)', 'Rating (A)', 'Max loading'],
    p => { const maxPct = Math.max(p.condPct.A, p.condPct.B, p.condPct.C); return [esc(p.id), p.cur.A.toFixed(1), p.cur.B.toFixed(1), p.cur.C.toFixed(1), p.In.toFixed(1), p.rating, maxPct.toFixed(0) + '%']; }
  );
  const txRows = res.transformers.map(t => {
    const rating = design.transformers.find(dt => dt.id === t.id)?.txRating;
    const exporting = t.flowDirection === 'export';
    return [
      esc(t.name), exporting ? 'EXPORT' : 'IMPORT', Math.abs(t.netKW).toFixed(1),
      `${t.txPct.toFixed(1)}% (${t.txKVA.toFixed(1)} / ${getTransformerType(design, rating).kVA} kVA)`,
      `${t.busVoltPct.A.toFixed(1)} / ${t.busVoltPct.B.toFixed(1)} / ${t.busVoltPct.C.toFixed(1)}`,
      (t.txLossW / 1000).toFixed(3), (t.txNoLoadW / 1000).toFixed(3)
    ];
  });

  return `
    <div class="kv">
      <div><span>Year / hour</span><b>Year ${res.year} · ${String(res.hour).padStart(2, '0')}:00</b></div>
      <div><span>Load / solar multiplier</span><b>${res.loadMult}× / ${res.solarMult}×</b></div>
      <div><span>Statutory band</span><b>${res.vLimLow.toFixed(1)} – ${res.vLimHigh.toFixed(1)} V phase-neutral</b></div>
      <div><span>Line (conductor) losses</span><b>${(res.totalLossW / 1000).toFixed(2)} kW</b></div>
      <div><span>Total transformer losses (copper + no-load)</span><b>${(totalTxLossW / 1000).toFixed(3)} kW</b></div>
      <div><span>Total system losses</span><b>${(totalSystemLossW / 1000).toFixed(2)} kW</b></div>
      ${res.worstVuf ? `<div><span>Worst voltage unbalance (VUF, limit ${res.vufLimitPct} %)</span><b>${vufText(res.worstVuf.value)} at ${esc(res.worstVuf.pole)}</b></div>` : ''}
    </div>
    ${res.status === 'collapse' ? `<p class="warn"><strong>Voltage collapse:</strong> at this hour the load is more than the network can deliver (a voltage below half of nominal, after ${res.iterUsed} iterations). The figures below are not a valid operating point.</p>`
    : !res.converged ? `<p class="warn">Load flow did not fully converge after ${res.iterUsed} iterations (final mismatch ${res.lastDelta.toFixed(3)} V) — results may be inaccurate.</p>` : ''}
    <h3>Per-transformer summary</h3>${table(['Transformer', 'Direction', 'Net kW', 'Loading', 'LV bus V (A/B/C)', 'Copper loss (kW)', 'No-load loss (kW)'], txRows)}
    <h3>Violations</h3>${violationsTable}
    <h3>Pole voltages (V, phase-neutral)</h3>${poleVoltTable}
    <h3>Span currents &amp; loading</h3>${currentTable}
    ${res.poleResults.some(p => p.inverters && p.inverters.length) ? `<h3>Smart-inverter PV output</h3>${table(['Pole', 'Unit', 'Phase', 'Mode', 'V (pu)', 'Available (kW)', 'P (kW)', 'Q (kVAR)', 'Curtailed (kW)'],
      res.poleResults.flatMap(p => (p.inverters || []).map(u => [esc(p.id), esc(u.id || 'candidate'), u.phase, esc(u.mode), u.vPu.toFixed(3), u.pAvailKw.toFixed(2), u.pKw.toFixed(2), u.qKvar.toFixed(2), u.curtailedKw.toFixed(2)])))}` : ''}
  `;
}

// Renders one 24-hour scan scenario (a {rows, loadMult, solarMult} entry from Daily Profile's
// combined/lowLoad/lowSolar scans). `notRunMsg` is shown in place of the whole body when this
// particular scenario hasn't been run yet.
function dailyScenarioBody(design, scenario, notRunMsg) {
  if (!scenario) return `<p class="empty">${esc(notRunMsg)}</p>`;
  const { rows: daily, loadMult, solarMult } = scenario;
  const minVInfo = daily.map(r => extremeVoltage(r.poleResults, (v, best) => v < best));
  const maxVInfo = daily.map(r => extremeVoltage(r.poleResults, (v, best) => v > best));
  const allViolations = [];
  daily.forEach(r => r.violations.forEach(v => allViolations.push({ hour: r.hour, ...v })));
  const anyNonConverged = daily.some(r => !r.converged);
  const worstVuf = daily.reduce((w, r) => (r.worstVuf && (!w || r.worstVuf.value > w.value) ? { ...r.worstVuf, hour: r.hour } : w), null);
  const hoursExporting = daily.filter(r => r.transformers.some(t => t.flowDirection === 'export')).length;
  const hoursWithViolations = new Set(allViolations.map(v => v.hour)).size;
  const worstOver = allViolations.filter(v => v.type === 'overvoltage').sort((a, b) => b.value - a.value)[0];
  const worstUnder = allViolations.filter(v => v.type === 'undervoltage').sort((a, b) => a.value - b.value)[0];
  const txIds = daily[0].transformers.map(t => t.id);
  const txName = id => daily[0].transformers.find(t => t.id === id)?.name || id;
  const hourRows = daily.map((r, i) => [
    String(r.hour).padStart(2, '0') + ':00',
    ...txIds.map(id => {
      const t = r.transformers.find(t => t.id === id);
      const exp = t.flowDirection === 'export';
      return `${esc(txName(id))}: ${exp ? 'EXPORT' : 'IMPORT'} ${t.netKW.toFixed(1)}kW · ${t.txPct.toFixed(0)}%${exp ? ' (uncapped)' : ''}`;
    }),
    `${minVInfo[i].value.toFixed(1)} (${esc(minVInfo[i].pole)}/${esc(minVInfo[i].phase)})`,
    `${maxVInfo[i].value.toFixed(1)} (${esc(maxVInfo[i].pole)}/${esc(maxVInfo[i].phase)})`,
    r.violations.length
  ]);
  const violationsTable = perTxTable(
    design, allViolations, v => txOfViolation(design, v),
    ['Hour', 'Pole', 'Phase', 'Issue', 'Value'],
    v => [String(v.hour).padStart(2, '0') + ':00', esc(v.pole), esc(v.phase), esc(v.type), v.value.toFixed(1)],
    '<p class="empty">None across the full 24-hour profile.</p>'
  );
  const txBusRows = daily.map(r => [
    String(r.hour).padStart(2, '0') + ':00',
    ...txIds.flatMap(id => {
      const t = r.transformers.find(t => t.id === id);
      return ['A', 'B', 'C'].map(ph => t.busVoltPct[ph].toFixed(1));
    })
  ]);
  const txBusTable = table(['Hour', ...txIds.flatMap(id => ['A', 'B', 'C'].map(ph => `${esc(txName(id))} V-${ph}`))], txBusRows);

  return `
    <div class="kv">
      <div><span>Year scanned</span><b>Year ${daily[0].year}</b></div>
      <div><span>Load / solar multiplier</span><b>${(loadMult * 100).toFixed(0)}% / ${(solarMult * 100).toFixed(0)}%</b></div>
      <div><span>Hours with a violation</span><b>${hoursWithViolations}/24</b></div>
      <div><span>Hours exporting to grid</span><b>${hoursExporting}/24</b></div>
      ${worstVuf ? `<div><span>Worst voltage unbalance (VUF)</span><b>${vufText(worstVuf.value)} (h${worstVuf.hour}, ${esc(worstVuf.pole)})</b></div>` : ''}
      <div><span>Peak overvoltage</span><b>${worstOver ? worstOver.value.toFixed(1) + ` V (h${worstOver.hour}, ${worstOver.pole}/${worstOver.phase})` : '—'}</b></div>
      <div><span>Worst undervoltage</span><b>${worstUnder ? worstUnder.value.toFixed(1) + ` V (h${worstUnder.hour}, ${worstUnder.pole}/${worstUnder.phase})` : '—'}</b></div>
    </div>
    ${anyNonConverged ? '<p class="warn">One or more hours did not fully converge — treat those hours\' figures with caution.</p>' : ''}
    ${daily.some(r => r.status === 'collapse') ? `<p class="warn"><strong>Voltage collapse</strong> at ${daily.filter(r => r.status === 'collapse').map(r => String(r.hour).padStart(2, '0') + ':00').join(', ')} — the load there is more than the network can deliver.</p>` : ''}
    <h3>Hour-by-hour summary</h3>${table(['Hour', ...txIds.map(id => txName(id)), 'Min V (pole/phase)', 'Max V (pole/phase)', 'Violations'], hourRows)}
    ${daily[0].bess && daily[0].bess.length ? `<h3>Battery state of charge</h3>${table(['Hour', ...daily[0].bess.map(b => `${esc(b.id)} kW (+ discharge) · SOC`)],
      daily.map(r => [String(r.hour).padStart(2, '0') + ':00', ...r.bess.map(b => (b.dataMissing ? 'kWh missing' : `${b.pKw.toFixed(2)} · ${(b.socEnd * 100).toFixed(0)} %`))]))}` : ''}
    <h3>Transformer LV bus voltage (post-transformer drop, pre-feeder drop)</h3>${txBusTable}
    ${daily.length === 24 ? (() => {
      const ag = transformerAgeing(design, daily);
      const flatRef = thermalSettings(design).ambientC.every(v => v === 20);
      return `<h3>Transformer hot spot and ageing (IEC 60076-7)</h3>${flatRef ? '<p class="warn">Flat 20 °C reference ambient — not site climate data.</p>' : ''}` +
        table(['Transformer', 'Peak hot spot', 'At', 'Relative ageing', 'Loss of life (h/day)'], ag.map(a => [esc(a.name), a.peakHotSpotC.toFixed(1) + ' °C', String(a.peakHour).padStart(2, '0') + ':00', a.relativeAgeing.toFixed(3), a.lossOfLifeHoursPerDay.toFixed(2)]));
    })() : ''}
    <h3>Violations — all 24 hours</h3>${violationsTable}
  `;
}

// Runs a fresh 24-hour scan for the given year and reduces it to one summary row —
// used to build the 5-year growth outlook without dumping five full hour-by-hour tables.
function yearOutlookRow(design, year) {
  const daily = runDailyScan(design, year);
  const allViolations = [];
  daily.forEach(r => r.violations.forEach(v => allViolations.push({ hour: r.hour, ...v })));
  const hoursWithViolations = new Set(allViolations.map(v => v.hour)).size;
  const hoursExporting = daily.filter(r => r.transformers.some(t => t.flowDirection === 'export')).length;
  const importPct = daily.flatMap(r => r.transformers.filter(t => t.flowDirection === 'import').map(t => t.txPct));
  const peakImportPct = importPct.length ? Math.max(...importPct) : 0;
  const worstOver = allViolations.filter(v => v.type === 'overvoltage').sort((a, b) => b.value - a.value)[0];
  const worstUnder = allViolations.filter(v => v.type === 'undervoltage').sort((a, b) => a.value - b.value)[0];
  return [
    'Year ' + year,
    hoursWithViolations + '/24',
    hoursExporting + '/24',
    (importPct.length ? peakImportPct.toFixed(0) + '%' : '— (always exporting)'),
    worstOver ? worstOver.value.toFixed(1) + ' V' : '—',
    worstUnder ? worstUnder.value.toFixed(1) + ' V' : '—'
  ];
}

// The violations the design already has at the hosting test hours (see hostingBaseline in
// engine/hosting.js): candidates are judged relative to these, so the report lists them next to
// the hosting results. Empty string for a clean baseline.
function hostingBaselineNote(baseline) {
  const hh = h => String(h).padStart(2, '0') + ':00';
  let out = '';
  if (baseline.violations.length) {
    out += `<p class="warn">The design already has ${baseline.violations.length} violation(s) at the test hours before anything is added. A candidate was rejected only if it created a new violation or made one of these more than 0.01 (V or %) worse.</p>` +
      table(['Hour', 'Pole', 'Phase', 'Issue', 'Value'], baseline.violations.map(v => [hh(v.hour), esc(v.pole), esc(v.phase), esc(v.type), v.value.toFixed(2)]));
  }
  if (baseline.nonConvergedHours.length) {
    out += `<p class="warn">The load flow for the design as it stands did not converge at ${baseline.nonConvergedHours.map(hh).join(', ')}.</p>`;
  }
  return out;
}

// Renders the network's daily energy-loss picture — line losses plus transformer copper and
// no-load loss, integrated over a fresh 24-hour scan (year 0, nominal load/solar) so this
// section is always populated regardless of what the user last ran elsewhere in the app.
function energyLossSectionBody(design) {
  const daily = runDailyScan(design, 0, { loadMult: 1, solarMult: 1 });
  const perHour = daily.map(res => ({ hour: res.hour, ...systemLossW(res) }));
  const { lineKwh, txKwh, groundKwh, totalKwh } = dailyEnergyLossKwh(design, []);
  const anyGrounded = design.poles.some(p => p.grounded);

  const txRows = design.transformers.map(tx => {
    let copperKwh = 0, noLoadKwh = 0;
    daily.forEach(res => {
      const t = res.transformers.find(t => t.id === tx.id);
      copperKwh += t.txLossW / 1000; noLoadKwh += t.txNoLoadW / 1000;
    });
    return [esc(tx.name || tx.id), copperKwh.toFixed(3), noLoadKwh.toFixed(3), (copperKwh + noLoadKwh).toFixed(3)];
  });

  const importedKwh = daily.reduce((s, res) => s + res.transformers.reduce((s2, t) => s2 + Math.max(t.netKW, 0), 0), 0);
  const lossPct = importedKwh > 0 ? (totalKwh / importedKwh * 100) : 0;

  const hourRows = perHour.map(h => [
    String(h.hour).padStart(2, '0') + ':00', (h.lineLossW / 1000).toFixed(3), (h.txLossW / 1000).toFixed(3),
    ...(anyGrounded ? [(h.groundLossW / 1000).toFixed(3)] : []),
    (h.totalLossW / 1000).toFixed(3)
  ]);

  return `
    <div class="kv">
      <div><span>Line (conductor) loss</span><b>${lineKwh.toFixed(2)} kWh/day</b></div>
      <div><span>Transformer loss (copper + no-load)</span><b>${txKwh.toFixed(2)} kWh/day</b></div>
      ${anyGrounded ? `<div><span>Ground-electrode loss</span><b>${groundKwh.toFixed(2)} kWh/day</b></div>` : ''}
      <div><span>Total distribution network loss</span><b>${totalKwh.toFixed(2)} kWh/day</b></div>
      <div><span>Annualised estimate</span><b>${(totalKwh * 365).toFixed(0)} kWh/yr</b></div>
      <div><span>Loss as % of energy imported that day</span><b>${importedKwh > 0 ? lossPct.toFixed(2) + '%' : '— (net exporting all day)'}</b></div>
    </div>
    <h3>Transformer loss by unit (kWh/day)</h3>${table(['Transformer', 'Copper loss', 'No-load loss', 'Total'], txRows)}
    <h3>Hour-by-hour loss (kW)</h3>${table(['Hour', 'Line loss', 'Transformer loss', ...(anyGrounded ? ['Ground loss'] : []), 'Total loss'], hourRows)}
  `;
}

// Fault levels at every node and the fuse protection check (see engine/faults.js). Always computed
// fresh; the protection check reruns the year-0 24 h scan for its load check.
function faultSectionBody(design) {
  const fl = faultLevels(design);
  const s = fl.settings;
  const kA = a => (a / 1000).toFixed(2);
  const rows = [
    ...fl.transformers.map(t => [esc(t.id) + ' LV terminals', '0', kA(t.ik3MaxA), kA(t.ik1MinA), C.abs(C.add(t.zSource, t.zTx)).toFixed(4)]),
    ...fl.poles.map(p => [esc(p.id), String(p.distanceM), kA(p.ik3MaxA), kA(p.ik1MinA), C.abs(p.zLoop).toFixed(4)])
  ];
  const pc = protectionCheck(design, runDailyScan(design, 0));
  const statusText = { pass: 'PASS', fail: 'FAIL', missing: 'DATA MISSING' };
  const fuseText = f => (f ? esc(`${f.type ? f.type + ' ' : ''}${f.ratingA ?? '?'} A`) : 'none');
  const checkCell = c => `<b>${statusText[c.status]}</b><br><span style="color:var(--muted);font-size:11px">${esc(c.detail)}</span>`;
  const devRows = pc.devices.map(d => [esc(d.label), fuseText(d.fuse), esc(d.zonePoles.join(', ')), checkCell(d.checks.disconnection), checkCell(d.checks.breaking), checkCell(d.checks.load), checkCell(d.checks.cable), `<b>${statusText[d.overall]}</b>`]);
  return `
    <p>IEC 60909-style. Source: ${s.hvFaultMVA ? `${s.hvFaultMVA} MVA, X/R ${s.hvXR}` : 'infinite (no HV fault level entered)'}; cmax ${s.cMax}, cmin ${s.cMin}; Ik1min with conductors at ${s.condTempC} °C; disconnection time ${pc.disconnectTimeS} s.</p>
    <h3>Fault levels</h3>${table(['Location', 'Distance (m)', 'Ik3max (kA)', 'Ik1min (kA)', '|Zloop| (Ω)'], rows)}
    <h3>Protection check</h3>
    ${pc.fuseLibraryEmpty ? '<p class="warn">No fuse data has been entered, so every protection check is "data missing".</p>' : ''}
    ${table(['Device', 'Fuse', 'Protects', 'Disconnection', 'Breaking capacity', 'Load', 'Cable overload', 'Overall'], devRows)}
    <p class="empty">Protection results are reported here only; they are not counted as load-flow violations.</p>
  `;
}

// The last tap advisor run (P2.4), if any.
function tapAdviceSectionBody(design, advice) {
  if (!advice) return '<p class="empty">The tap advisor has not been run — open Setup → Tap advisor, compare tap positions, then regenerate this report.</p>';
  const hh = h => String(h).padStart(2, '0') + ':00';
  const w = x => `${x.value.toFixed(1)} V (${esc(x.pole)} ${esc(x.phase)}, ${hh(x.hour)}, yr ${x.year})`;
  const rows = advice.byTap.map(t => [
    t.tap + (t.tap === advice.currentTap ? ' (current)' : ''), t.hvWindingV + ' V', t.noLoadV.toFixed(1) + ' V',
    ...advice.years.map(y => String(t.violationsByYear[y])), w(t.minV), w(t.maxV), t.marginV.toFixed(2) + ' V', t.kwhYear0.toFixed(2),
    t.tap === advice.recommendedTap ? '<b>Recommended</b>' : t.totalViolations > advice.ranked[0].totalViolations ? 'Rejected' : 'Acceptable'
  ]);
  return `
    <p>Transformer ${esc(advice.txId)}; band ${advice.vLow.toFixed(1)}–${advice.vHigh.toFixed(1)} V; full day for years ${advice.years.join(' and ')}. ${esc(advice.note)}</p>
    ${advice.diagnosis ? `<p class="warn"><b>No tap clears every violation.</b> ${esc(advice.diagnosis.message)}</p>` : ''}
    ${table(['Tap', 'HV winding', 'No-load LV', ...advice.years.map(y => 'Violations yr ' + y), 'Lowest V', 'Highest V', 'Worst margin', 'Loss (kWh/day)', 'Status'], rows)}
  `;
}

// The last reconductoring advisor run (P2.5), top ten options.
function reconductorSectionBody(r) {
  if (!r) return '<p class="empty">The reconductoring advisor has not been run — open "Reconductor", run it, then regenerate this report.</p>';
  if (!r.candidates.length) return '<p class="empty">No reconductoring option: no span uses a conductor with higher resistance than another in the library.</p>';
  const money = v => (v == null ? 'cost unknown' : Math.round(v).toLocaleString('en-US') + ' LKR');
  const rows = r.candidates.slice(0, 10).map((c, i) => [
    i + 1, esc(describeReconductor(c.changes)), c.lengthM + ' m', ...r.years.map(y => String(c.violationsByYear[y])),
    c.kwhYear0.toFixed(2), c.kwhSavedPerDay.toFixed(2), money(c.capex), c.lkrPerViolationRemoved == null ? '—' : money(c.lkrPerViolationRemoved)
  ]);
  return `
    <p>Current design: ${r.years.map(y => `${r.baseline.violationsByYear[y]} violation(s) in year ${y}`).join(', ')}; ${r.baseline.kwhYear0.toFixed(2)} kWh/day loss (year 0). Ranked by voltage + thermal violations, then capital cost, then loss.${r.truncated ? ` Only ${r.candidates.length} of ${r.candidateCount} options were scanned.` : ''}</p>
    ${table(['Rank', 'Restring', 'Length', ...r.years.map(y => 'Violations yr ' + y), 'Loss (kWh/day)', 'Saved (kWh/day)', 'Capex', 'Per violation removed'], rows)}
  `;
}

// The last fix-it ladder run (P2.6).
function fixItSectionBody(r) {
  if (!r) return '<p class="empty">The fix-it ladder has not been run — open "Fix-it Ladder", run it, then regenerate this report.</p>';
  if (r.alreadyCompliant) return `<p>The design had no voltage violation in years ${r.years.join(' and ')} — nothing to fix.</p>`;
  const rows = [
    ['—', 'Current design', ...r.years.map(y => String(r.baseline.violationsByYear[y])), r.baseline.kwhYear0.toFixed(2), '—', ''],
    ...r.steps.map((s, i) => [
      i + 1, `${esc(s.label)}${s.actions.length ? `<br><span style="color:var(--muted);font-size:11px">${esc(s.actions.join('; '))}</span>` : ''}`,
      ...r.years.map(y => (s.metrics ? String(s.metrics.violationsByYear[y]) : '—')),
      s.metrics ? s.metrics.kwhYear0.toFixed(2) : '—',
      s.metrics ? ((r.baseline.kwhYear0 - s.metrics.kwhYear0) * 365).toFixed(0) : '—',
      !s.design ? 'Nothing to change' : s.solves ? '<b>Fixes it</b>' : 'Not enough'
    ])
  ];
  return `
    <p>${r.solvedBy ? `Fixed by: <b>${esc(r.steps.find(s => s.step === r.solvedBy).label)}</b>.` : 'No step fixed every violation.'} Checked years ${r.years.join(' and ')}, full day. kWh/yr = year-0 daily figure × 365. Energy cost of losses not yet set (Economics, P6.1).</p>
    ${table(['#', 'Remedy', ...r.years.map(y => 'Violations yr ' + y), 'Loss (kWh/day)', 'Saved (kWh/yr)', 'Result'], rows)}
  `;
}

// Builds a standalone, printable HTML report combining the design's setup, network and
// (if available) the latest simulation snapshot, hosting-capacity scan and 24-hour scan.
// `extras` carries the latest advisor results the pages have stored (tap advisor, …).
export function buildReportHtml(design, res, hosting, daily, bessHosting, extras = {}) {
  const now = new Date().toLocaleString();

  const txRows = design.transformers.map(t => [
    esc(t.name || t.id), esc(t.id), t.txRating + ' kVA', 'Tap ' + t.tap + ' — ' + TAPS[t.tap] + ' : 415 V',
    t.txXR, t.hvActual + ' V', (design.txNoLoadW?.[t.txRating] ?? getTransformerType(design, t.txRating).noLoadW) + ' W',
    (t.txGroundOhms ?? 7.5) + ' Ω'
  ]);
  const setupBody = `
    <h3>Transformers</h3>${table(['Name', 'Id', 'Rating', 'Tap', 'X/R', 'Assumed HV supply', 'No-load (core) loss', 'Star point ground'], txRows)}
    <div class="kv">
      <div><span>General connection ADMD</span><b>${design.admd} kVA</b></div>
      <div><span>Power factor (general + EV)</span><b>${design.pf}</b></div>
      <div><span>Annual load growth</span><b>${design.growth}%/yr</b></div>
      <div><span>Nominal phase-neutral voltage</span><b>${design.vnom} V</b></div>
      <div><span>Allowed deviation</span><b>±${design.vdev}%</b></div>
      <div><span>Standards profile</span><b>${esc(standardsOf(design).profileName)}</b></div>
      <div><span>Smart-inverter PV</span><b>${esc(inverterSettings(design).mode)}${inverterSettings(design).exportLimitKw !== null ? `, export limit ${inverterSettings(design).exportLimitKw} kW` : ''}</b></div>
      <div><span>Loading limits (cable / transformer)</span><b>${standardsOf(design).cableLoadingLimitPct}% / ${standardsOf(design).txLoadingLimitPct}%</b></div>
      <div><span>VUF limit</span><b>${standardsOf(design).vufLimitPct}% (${standardsOf(design).vufAsViolation ? 'counted as a violation' : 'reported only'})</b></div>
      <div><span>Max single-phase PV per connection</span><b>${design.maxpv} kW</b></div>
      <div><span>Connection types included</span><b>${[
        design.includeGeneral && 'General', design.includeEV && 'EV', design.includeShop && 'Commercial Shop', design.includeSolar && 'Solar PV', design.includeBess && 'BESS'
      ].filter(Boolean).join(', ') || 'none'}</b></div>
      <div><span>Max single-phase BESS per connection</span><b>${design.maxbess} kW</b></div>
      <div><span>BESS charge window (from grid)</span><b>${String(design.bessChargeStartHour).padStart(2, '0')}:00 – ${String(design.bessChargeEndHour).padStart(2, '0')}:00</b></div>
      <div><span>BESS discharge window (peak support)</span><b>${String(design.bessDischargeStartHour).padStart(2, '0')}:00 – ${String(design.bessDischargeEndHour).padStart(2, '0')}:00</b></div>
    </div>`;

  const polesTable = perTxTable(
    design, design.poles, p => transformerOfPole(design, p.id),
    ['Pole', 'Feeder', 'Parent', 'Span (m)', 'Conductor', 'Grounded'],
    p => [esc(p.id), esc(p.feeder), esc(p.parent), p.spanM, esc(p.cond), p.grounded ? `Rg=${p.groundOhms}Ω` : '—']
  );
  const connectionsTable = perTxTable(
    design, design.loads, l => transformerOfPole(design, l.pole),
    ['Pole', 'Type', 'Phase', 'kVA'], l => [esc(l.pole), LOAD_TYPE_LABEL[l.type] || esc(l.type), esc(l.phase), l.kva == null ? 'ADMD' : l.kva]
  );
  const pvTable = perTxTable(
    design, design.pv, p => transformerOfPole(design, p.pole),
    ['Pole', 'Phase', 'kVA'], p => [esc(p.pole), esc(p.phase), p.kva]
  );
  const bessTable = perTxTable(
    design, design.bess, b => transformerOfPole(design, b.pole),
    ['Pole', 'Phase', 'kVA'], b => [esc(b.pole), esc(b.phase), b.kva]
  );

  const networkBody =
    `<h3>Poles &amp; spans</h3>${polesTable}` +
    `<h3>Connections</h3>${connectionsTable}` +
    `<h3>Rooftop solar PV</h3>${pvTable}` +
    `<h3>Battery storage (BESS)</h3>${bessTable}`;

  const snapshotBody = res
    ? snapshotSectionBody(design, res)
    : '<p class="empty">No simulation has been run yet — open "Run &amp; Reports", run a snapshot, then regenerate this report to include results.</p>';

  // Always computed fresh at report time, independent of whatever the user last ran on the
  // Reports page, so the report reliably bookends the daily cycle regardless of prior navigation.
  const solarPeakRes = runSnapshot(design, { year: 0, hour: 12, loadMult: 1, solarMult: 1 });
  const nightPeakRes = runSnapshot(design, { year: 0, hour: 20, loadMult: 1, solarMult: 0 });
  const solarPeakBody = snapshotSectionBody(design, solarPeakRes);
  const nightPeakBody = snapshotSectionBody(design, nightPeakRes);

  let hostingBody = '<p class="empty">No hosting-capacity scan has been run yet — open "Solar Hosting", compute it, then regenerate this report to include results.</p>';
  if (hosting) {
    if (hosting.length === 0) {
      hostingBody = hostingBaselineNote(pvHostingBaseline(design)) + '<p class="empty">No additional headroom found at solar-peak conditions in the last scan.</p>';
    } else {
      const total = hosting.reduce((s, r) => s + r.kva, 0);
      hostingBody = hostingBaselineNote(pvHostingBaseline(design)) + `<p><b>Total additional PV headroom: ${total.toFixed(2)} kVA</b> across ${hosting.length} pole/phase location${hosting.length === 1 ? '' : 's'} (each tested independently — an upper bound, not a guaranteed simultaneous addition).</p>` +
        table(['Rank', 'Pole', 'Phase', 'Additional PV headroom (kVA)', 'Limited by'], hosting.map((r, i) => [i + 1, esc(r.pole), esc(r.phase), r.kva.toFixed(2), esc(hostingLimitText(r, `Setup cap (${design.maxpv} kW)`))]));
    }
  }

  const energyLossBody = energyLossSectionBody(design);

  let bessHostingBody = '<p class="empty">No BESS hosting-capacity scan has been run yet — open "BESS Hosting", compute the maximum simultaneous capacity, then regenerate this report to include results.</p>';
  if (bessHosting) {
    const accepted = bessHosting.results.filter(r => r.achievableKva > 0);
    if (accepted.length === 0) {
      bessHostingBody = hostingBaselineNote(bessHostingBaseline(design)) + '<p class="empty">No additional BESS headroom found across the charge/discharge windows in the last scan.</p>';
    } else {
      bessHostingBody = hostingBaselineNote(bessHostingBaseline(design)) + `
        <p><b>Total simultaneous BESS hosting capacity: ${bessHosting.totalKva.toFixed(2)} kVA</b> across ${accepted.length} pole/phase location${accepted.length === 1 ? '' : 's'}, priority-ordered by loss-reduction impact.</p>
        <div class="kv">
          <div><span>Baseline network loss (no BESS)</span><b>${bessHosting.baselineLossKwh.totalKwh.toFixed(2)} kWh/day</b></div>
          <div><span>Loss with accepted BESS allocation</span><b>${bessHosting.withBessLossKwh.totalKwh.toFixed(2)} kWh/day</b></div>
          <div><span>Loss reduction</span><b>${bessHosting.lossReductionKwh.toFixed(2)} kWh/day (${bessHosting.baselineLossKwh.totalKwh > 0 ? (bessHosting.lossReductionKwh / bessHosting.baselineLossKwh.totalKwh * 100).toFixed(1) : '0.0'}%)</b></div>
        </div>
        ${table(['Priority', 'Pole', 'Phase', 'Independent, uncapped estimate (kVA)', 'Achievable simultaneously (kVA)', 'Limited by'],
          bessHosting.results.map((r, i) => [i + 1, esc(r.pole), esc(r.phase), r.independentKva.toFixed(2), r.achievableKva.toFixed(2), esc(hostingLimitText(r, 'its independent estimate still fits'))]))}
      `;
    }
  }

  const notRun = (scenario) => `No 24-hour scan has been run for this scenario yet — open "Daily Profile", run "${scenario}", then regenerate this report to include it.`;
  const dailyCombinedBody = dailyScenarioBody(design, daily?.combined, notRun('the combined scenario'));
  const dailyLowLoadBody = dailyScenarioBody(design, daily?.lowLoad, notRun('typical solar / low load'));
  const dailyLowSolarBody = dailyScenarioBody(design, daily?.lowSolar, notRun('low solar / typical load'));

  // Fresh 5-year growth outlook, always computed at report time regardless of what year the
  // user last scanned on the Daily Profile page.
  const outlookRows = [1, 2, 3, 4, 5].map(y => yearOutlookRow(design, y));
  const outlookBody = `
    <p style="color:var(--muted);font-size:12.5px;margin:0 0 10px">Re-runs the 24-hour scan for each of the next 5 years at ${design.growth}%/yr load growth (general, EV and shop connections; PV capacity is held fixed), summarising how the daily cycle shifts as demand grows.</p>
    ${table(['Year', 'Hours with a violation', 'Hours exporting', 'Peak transformer loading (import, worst of all transformers)', 'Peak overvoltage', 'Worst undervoltage'], outlookRows)}
  `;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(design.name)} — Feeder Island Report</title>
<style>
  :root{--bg:#fff;--text:#1a2233;--muted:#5b6b85;--line:#dbe2ee;--accent:#2f6fed;--head:#f4f7fc}
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--text);background:var(--bg);margin:0;padding:32px 40px;line-height:1.5}
  h1{font-size:22px;margin:0 0 4px}
  .meta{color:var(--muted);font-size:12px;margin-bottom:28px}
  .section{margin-bottom:30px;page-break-inside:avoid}
  .section>h2{font-size:15px;border-bottom:2px solid var(--accent);padding-bottom:6px;margin:0 0 14px}
  h3{font-size:12.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);margin:18px 0 8px}
  .kv{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 24px}
  .kv div{display:flex;justify-content:space-between;border-bottom:1px dashed var(--line);padding:4px 0;font-size:13px}
  .kv span{color:var(--muted)}
  table{border-collapse:collapse;width:100%;margin-bottom:6px;font-size:12.5px}
  th,td{border:1px solid var(--line);padding:5px 8px;text-align:left}
  th{background:var(--head);font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:var(--muted)}
  .empty{color:var(--muted);font-style:italic;font-size:13px}
  .warn{background:#fff6e5;border:1px solid #f0c36b;padding:8px 12px;border-radius:6px;font-size:13px}
  @media print{body{padding:0 8mm}}
</style></head>
<body>
  <h1>${esc(design.name)}</h1>
  <div class="meta">Feeder Island comprehensive report — generated ${esc(now)}</div>
  ${section('Setup', setupBody)}
  ${section('Network', networkBody)}
  ${section('Energy loss — 24-hour distribution network (incl. transformer)', energyLossBody)}
  ${section('Latest simulation snapshot', snapshotBody)}
  ${section('Solar peak snapshot (year 0, 12:00, full PV)', solarPeakBody)}
  ${section('Night peak snapshot (year 0, 20:00, no solar)', nightPeakBody)}
  ${section('24-hour scan — combined (typical load & solar)', dailyCombinedBody)}
  ${section('24-hour scan — typical solar / low load', dailyLowLoadBody)}
  ${section('24-hour scan — low solar / typical load', dailyLowSolarBody)}
  ${section('5-year 24-hour scan outlook', outlookBody)}
  ${section('Latest solar hosting-capacity scan', hostingBody)}
  ${section('Latest BESS hosting-capacity scan', bessHostingBody)}
  ${section('Fault levels and protection', faultSectionBody(design))}
  ${section('Tap advisor', tapAdviceSectionBody(design, extras.tapAdvice))}
  ${section('Reconductoring advisor', reconductorSectionBody(extras.reconductor))}
  ${section('Fix-it ladder', fixItSectionBody(extras.fixIt))}
</body></html>`;
}

// File name for a design's report, e.g. "walkthrough-island-report.html".
export function reportFileName(design) {
  return (design.name || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-report.html';
}

// Browser-only: hands an already-built HTML string to the user as a file download. Split from
// buildReportHtml so the (slow) build can run in the engine worker, which has no DOM.
export function downloadHtml(html, fileName) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Builds and downloads in one go, on the calling thread (kept for existing callers).
export function downloadReport(design, res, hosting, daily, bessHosting) {
  downloadHtml(buildReportHtml(design, res, hosting, daily, bessHosting), reportFileName(design));
}
