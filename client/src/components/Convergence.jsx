// Shared non-convergence reporting (P1.3 fix 3). A load flow that hasn't converged is never
// trusted as a pass by the engine, and every page that runs load flows says so when it happens,
// rather than presenting unconverged numbers as if they were results.

import { hostingLimitText } from '../lib/format.js';

// Red warning box; renders nothing when `show` is false.
export function ConvergenceWarning({ show, children }) {
  if (!show) return null;
  return (
    <div className="note" role="alert" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', marginTop: 12 }}>
      {children}
    </div>
  );
}

export function HostingLimitCell({ row, capLabel }) {
  const nonConv = row && row.limit === 'nonConvergence';
  return <td style={nonConv ? { color: 'var(--bad)' } : undefined}>{hostingLimitText(row, capLabel)}</td>;
}

// Warning shown above a hosting table when any location was limited by non-convergence rather
// than by a statutory or thermal limit — those numbers are a solver limit, not a network one.
export function HostingNonConvergenceWarning({ rows }) {
  const n = (rows || []).filter(r => r.limit === 'nonConvergence').length;
  return (
    <ConvergenceWarning show={n > 0}>
      {n} location{n === 1 ? ' was' : 's were'} limited because the load flow stopped converging, not by a voltage or
      thermal limit. Those figures are the largest size the solver could still solve reliably — treat them as unverified.
    </ConvergenceWarning>
  );
}
