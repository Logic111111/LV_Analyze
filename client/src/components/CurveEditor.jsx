import { useRef, useState } from 'react';

export default function CurveEditor({ values, onChange, max = 1.2, colorVar = '--accent-2' }) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);

  function setFromEvent(e) {
    const rect = ref.current.getBoundingClientRect();
    let frac = 1 - (e.clientY - rect.top) / rect.height;
    frac = Math.min(1, Math.max(0, frac));
    const col = Math.min(23, Math.max(0, Math.floor((e.clientX - rect.left) / (rect.width / 24))));
    const next = values.slice();
    next[col] = Math.round(frac * max * 20) / 20;
    onChange(next);
  }

  // Fixed 0.1 gridlines from 0 up to `max` (rather than quarters of max) so the Y axis reads
  // consistently across curves regardless of each curve's own max.
  const tickCount = Math.round(max / 0.1);
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => Math.round((max - i * 0.1) * 100) / 100);
  const chartH = 140;

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: chartH, marginBottom: 6, fontSize: 8, color: 'var(--muted)', fontFamily: 'var(--mono)', textAlign: 'right' }}>
        {ticks.map((t, i) => <span key={i}>{t.toFixed(1)}×</span>)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
            {ticks.map((_, i) => <div key={i} style={{ borderTop: '1px dashed var(--line)', height: 0 }} />)}
          </div>
          <div
            ref={ref}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(24,1fr)', gap: 3, height: chartH, alignItems: 'end', marginBottom: 6, cursor: 'ns-resize', position: 'relative' }}
            onMouseDown={(e) => { setDragging(true); setFromEvent(e); }}
            onMouseMove={(e) => { if (dragging) setFromEvent(e); }}
            onMouseUp={() => setDragging(false)}
            onMouseLeave={() => setDragging(false)}
          >
            {values.map((v, h) => (
              <div
                key={h}
                title={`${h}:00 — ${v.toFixed(2)}×`}
                style={{
                  height: Math.max(2, (v / max) * (chartH - 2)),
                  background: `var(${colorVar})`,
                  borderRadius: '2px 2px 0 0',
                  pointerEvents: 'none'
                }}
              />
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24,1fr)', gap: 3, fontSize: 8, color: 'var(--muted)', fontFamily: 'var(--mono)', textAlign: 'center' }}>
          {values.map((_, h) => <span key={h}>{h}</span>)}
        </div>
      </div>
    </div>
  );
}
