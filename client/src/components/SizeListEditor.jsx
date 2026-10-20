// Editable discrete size distribution: rows of { kva, weight }. Used by the Monte Carlo page for
// EV charger and PV system sizes. Sizes are the user's (or copied from the design) — never
// filled in with assumed values.
export default function SizeListEditor({ label, sizes, onChange, onLoadFromDesign }) {
  const set = (i, key, value) => onChange(sizes.map((s, k) => (k === i ? { ...s, [key]: value } : s)));
  const total = sizes.reduce((n, s) => n + (Number(s.weight) > 0 ? Number(s.weight) : 0), 0);
  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, margin: 0 }}>
      <legend style={{ fontSize: 12, color: 'var(--muted)', padding: '0 4px' }}>{label}</legend>
      {sizes.length === 0 && <p className="hint" style={{ margin: '0 0 6px' }}>No sizes — data missing. Add sizes, or load the ones already in this design.</p>}
      {sizes.length > 0 && (
        <div className="tbl-wrap"><table>
          <thead><tr><th scope="col">kVA</th><th scope="col">Weight</th><th scope="col">Share</th><th></th></tr></thead>
          <tbody>
            {sizes.map((s, i) => (
              <tr key={i}>
                <td><input type="number" min="0" step="0.1" aria-label={`${label} size ${i + 1}, kVA`} value={s.kva} onChange={e => set(i, 'kva', e.target.value)} /></td>
                <td><input type="number" min="0" step="1" aria-label={`${label} size ${i + 1}, weight`} value={s.weight} onChange={e => set(i, 'weight', e.target.value)} /></td>
                <td>{total > 0 && Number(s.weight) > 0 ? (Number(s.weight) / total * 100).toFixed(0) + ' %' : '—'}</td>
                <td><button className="mini" onClick={() => onChange(sizes.filter((_, k) => k !== i))} aria-label={`Remove ${label} size ${i + 1}`}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <button className="mini" onClick={() => onChange([...sizes, { kva: '', weight: 1 }])}>Add size</button>{' '}
      <button className="mini" onClick={onLoadFromDesign}>Load from design</button>
    </fieldset>
  );
}
