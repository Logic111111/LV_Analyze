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
  const where = d.phase && d.phase !== '-' ? `${d.pole} ${d.phase}` : d.pole;
  return `${d.type} at ${where}, ${hourLabel(d.hour)}`;
}
