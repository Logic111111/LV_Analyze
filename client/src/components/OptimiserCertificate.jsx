import { certificateLabel } from '../lib/loadflow.js';

// How good an optimiser's answer is (O7): a badge — "Exact optimum", "Within x % of bound" or
// "Best found (x/N restarts agree)" — and an "Explain" section: what was searched, how long it
// took, why the certificate holds and why the answer differs from the legacy method. The badge
// text carries the meaning; its colour only repeats it.
const PILL = { exact: 'ok', 'lp-bound': 'warn', heuristic: '' };
const LOGIC = {
  exact: 'Exact: every candidate in the stated search space was evaluated (or the method is a proof, like dynamic programming over all arrangements), so no better answer exists under this objective and these constraints.',
  'lp-bound': 'Bounded: the answer passed full load flows; a linear model of the network around it gives an optimistic estimate of the best possible. The gap is how far the answer could be from that estimate — as far as the linear model is right.',
  heuristic: 'Best found: a randomised search (seeded, so it repeats exactly) — not a proof. Several independent restarts reaching the same answer is evidence it is the optimum.'
};

export function CertificateBadge({ result }) {
  if (!result || !result.certificate) return null;
  return <span className={'pill ' + PILL[result.certificate]} title={LOGIC[result.certificate]}>{certificateLabel(result)}</span>;
}

/**
 * @param {{ result: any, space?: string, why?: import('react').ReactNode }} props
 *   space: what was searched, in words; why: why the answer differs from the legacy method
 */
export default function OptimiserCertificate({ result, space, why }) {
  if (!result || !result.certificate) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <CertificateBadge result={result} /> <span className="hint">{result.method} · {result.evaluations.toLocaleString()} evaluations · {(result.ms / 1000).toFixed(1)} s</span>
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: 'pointer' }}>Explain this result</summary>
        <div className="hint" style={{ marginTop: 6 }}>
          {space && <p style={{ margin: '4px 0' }}><b>Searched:</b> {space}</p>}
          <p style={{ margin: '4px 0' }}><b>Certificate:</b> {LOGIC[result.certificate]}
            {result.certificate === 'lp-bound' && Number.isFinite(result.bound) ? ` Estimate ${Number(result.bound).toFixed(2)}, gap ${Number(result.gapPct).toFixed(1)} %.` : ''}
            {result.restartsFoundBest ? ` ${result.restartsFoundBest.found} of ${result.restartsFoundBest.of} restarts reached it.` : ''}</p>
          {why && <p style={{ margin: '4px 0' }}><b>Why it differs from the legacy method:</b> {why}</p>}
          <p style={{ margin: '4px 0' }}><b>Verified:</b> {result.verified ? 'yes — full load flows, converged, at every checked hour and year.' : 'not load-flow checked (a linear goal) — preview it to see voltages.'}</p>
          {result.notes && result.notes.length > 0 && <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </div>
      </details>
    </div>
  );
}
