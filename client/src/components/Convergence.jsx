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

// One snapshot's solve status (P4.3), in words: voltage collapse is a network finding (the load
// is more than the network can deliver), so it gets its own message rather than "not converged".
// Renders nothing for a clean solve. Older stored results have no `status`, only `converged`.
export function SolveStatusWarning({ res, what = 'the results below' }) {
  if (!res) return null;
  const retry = res.convergence && res.convergence.some(c => c.retried) ? ', including one retry with gentler damping (α = 0.3)' : '';
  if (res.status === 'collapse') {
    return (
      <ConvergenceWarning show>
        <strong>Voltage collapse.</strong> At this hour the load is more than the network can deliver: a voltage fell below half of nominal{res.converged ? '' : ', or the iteration kept diverging'} after {res.iterUsed} iterations{retry}. {what[0].toUpperCase() + what.slice(1)} are not a valid operating point — reduce the load or reinforce the network (see the fix-it ladder).
      </ConvergenceWarning>
    );
  }
  return (
    <ConvergenceWarning show={!res.converged}>
      Load flow did not fully converge after {res.iterUsed} iterations{retry} (final mismatch {res.lastDelta.toFixed(3)} V) — {what} may be inaccurate.
    </ConvergenceWarning>
  );
}

export function HostingLimitCell({ row, capLabel }) {
  const nonConv = row && (row.limit === 'nonConvergence' || row.limit === 'collapse');
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
