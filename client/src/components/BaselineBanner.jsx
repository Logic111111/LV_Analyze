// Lists the violations a design already has at the hosting test hours, before anything is added
// (see hostingBaseline in engine/hosting.js). Hosting candidates are judged relative to these —
// rejected only for a new violation or for making one of these more than 0.01 (V or %) worse — so
// the user needs to see them to read the results correctly. Renders nothing for a clean baseline.
const hh = (h) => String(h).padStart(2, '0') + ':00';

export default function BaselineBanner({ baseline, kind }) {
  if (!baseline) return null;
  const { violations, nonConvergedHours } = baseline;
  if (!violations.length && !nonConvergedHours.length) return null;
  return (
    <div className="note" role="status" style={{ borderColor: 'var(--warn)', marginTop: 14 }}>
      {violations.length > 0 && (
        <>
          <b>This design already has {violations.length} violation{violations.length === 1 ? '' : 's'} at the {kind} test hours, before anything is added.</b>{' '}
          A candidate is rejected only if it creates a new violation or makes one of these more than 0.01 (V or %) worse,
          so the results below aren't zeroed out by problems the candidate didn't cause — but these still need fixing.
          <div className="tbl-wrap" style={{ marginTop: 8, maxHeight: 200 }}>
            <table>
              <thead><tr><th>Hour</th><th>Pole</th><th>Phase</th><th>Issue</th><th>Value</th></tr></thead>
              <tbody>
                {violations.map((v, i) => (
                  <tr key={i}>
                    <td>{hh(v.hour)}</td><td>{v.pole}</td>
                    <td className={v.phase !== '-' ? 'phase' + v.phase : ''}>{v.phase}</td>
                    <td>{v.type}</td>
                    <td>{v.value.toFixed(2)}{v.type === 'undervoltage' || v.type === 'overvoltage' ? ' V' : ' %'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {nonConvergedHours.length > 0 && (
        <p style={{ margin: violations.length ? '8px 0 0' : 0, color: 'var(--bad)' }}>
          The load flow for the design as it stands did not converge at {nonConvergedHours.map(hh).join(', ')} — results that depend on those hours are unreliable.
        </p>
      )}
    </div>
  );
}
