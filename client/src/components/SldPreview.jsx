import { useMemo } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { buildSldScene } from '../lib/sld/scene.js';
import SingleLineDiagram from './SingleLineDiagram.jsx';

// Before/after single-line diagram for an advisor's preview (P5.1): moved connections are boxed
// with an arrow from their old phase, upgraded spans drawn thick with old→new conductor, a new
// transformer dashed, a tap change annotated. Used by Load Balance, Tap advisor, Reconductor,
// Feeder Split and the Fix-it ladder.
export default function SldPreview({ design, before, res, label = 'Proposal preview' }) {
  const { theme } = useTheme();
  const scene = useMemo(() => (res ? buildSldScene(design, res, { compareTo: before }) : null), [design, before, res]);
  if (!scene) return null;
  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>Changes against the current design are drawn in the accent colour: moved connections are boxed with an arrow from their old phase (dashed box), upgraded spans thick with "old→new" conductor, a new transformer dashed, a tap change as "tap a → b".</p>
      <SingleLineDiagram scene={scene} theme={theme} maxHeight="60vh" label={label} />
    </div>
  );
}
