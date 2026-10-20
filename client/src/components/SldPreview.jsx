import { useMemo, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { useDesign } from '../context/DesignContext.jsx';
import { designPatch, describePatch } from '../lib/loadflow.js';
import { buildSldScene } from '../lib/sld/scene.js';
import SingleLineDiagram from './SingleLineDiagram.jsx';

// Before/after single-line diagram for an advisor's preview (P5.1): moved connections are boxed
// with an arrow from their old phase, upgraded spans drawn thick with old→new conductor, a new
// transformer dashed, a tap change annotated. Used by Load Balance, Tap advisor, Reconductor,
// Feeder Split and the Fix-it ladder.
export default function SldPreview({ design, before, res, label = 'Proposal preview' }) {
  const { theme } = useTheme();
  const { setDesign } = useDesign();
  const [kept, setKept] = useState('');
  // "Keep as scenario" (P5.4): the proposal's changes, as a patch on the current design.
  function keep() {
    const patch = designPatch(before, design);
    const name = label;
    setDesign(d => ({ ...d, scenarios: [...(d.scenarios || []), { id: 'sc' + Date.now().toString(36), name, year: 0, loadMult: 1, solarMult: 1, taps: {}, standardsProfileId: null, patch, note: '' }] }));
    setKept(`Kept as scenario "${name}" (${describePatch(patch)}) — compare it on the Scenarios page.`);
  }
  const scene = useMemo(() => (res ? buildSldScene(design, res, { compareTo: before }) : null), [design, before, res]);
  if (!scene) return null;
  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>Changes against the current design are drawn in the accent colour: moved connections are boxed with an arrow from their old phase (dashed box), upgraded spans thick with "old→new" conductor, a new transformer dashed, a tap change as "tap a → b".</p>
      <SingleLineDiagram scene={scene} theme={theme} maxHeight="60vh" label={label} />
      {before && <div style={{ marginTop: 8 }}><button type="button" className="mini" onClick={keep}>Keep as scenario</button>{kept && <span className="hint" role="status" style={{ marginLeft: 8 }}>{kept}</span>}</div>}
    </div>
  );
}
