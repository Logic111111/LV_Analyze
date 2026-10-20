// Small, dependency-free text formatters shared by pages and the HTML report, so both describe a
// result in the same words.

/** "09:00" */
export function hourLabel(h) { return String(h).padStart(2, '0') + ':00'; }

// "Limited by" text for one hosting row (see HostingLimit in engine/hosting.js). `capLabel` names
// what the ceiling was in that table (the Setup cap, or the independent amount in a queue).
export function hostingLimitText(row, capLabel) {
  if (!row || !row.limit) return '—';
  if (row.limit === 'cap') return capLabel;
  const d = row.limitDetail || {};
  if (row.limit === 'nonConvergence') return `load flow stopped converging (${hourLabel(d.hour)})`;
  if (row.limit === 'collapse') return `voltage collapse (${hourLabel(d.hour)})`;
  const where = d.phase && d.phase !== '-' ? `${d.pole} ${d.phase}` : d.pole;
  return `${d.type} at ${where}, ${hourLabel(d.hour)}`;
}

// Transformer current over a scan, one entry per transformer: the solver's true worst phase
// current first, then the balanced-equivalent estimate from peak kVA (kVA·1000 / (√3·415 V)),
// labelled — e.g. "TX 121 A (bal.-eq. 54 A)". See summarizeScan in engine/scan.js for why both.
export function txCurrentSummary(transformers) {
  if (!transformers || !transformers.length) return '—';
  return transformers.map(t => `${t.name || t.id} ${t.txMaxPhaseCurrentA.toFixed(0)} A (bal.-eq. ${t.peakCurrentA.toFixed(0)} A)`).join(' / ');
}

// Voltage unbalance factor text, e.g. "1.70 %". Older stored results (from before P2.1) have no
// VUF field — shown as "—" rather than a misleading 0.
export function vufText(v) { return Number.isFinite(v) ? v.toFixed(2) + ' %' : '—'; }
