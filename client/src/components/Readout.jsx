import { useEffect, useRef, useState } from 'react';
import { countUpValue } from '../lib/countUp.js';

const DURATION_MS = 400;
const GLOW_MS = 600;
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// A result number that counts from its previous value to a new one and glows briefly, so a re-run
// shows what changed (UI stage 1). The first render shows the value as is; the final text is
// always exactly format(value). A missing or non-finite value shows `fallback` and never animates.
export default function Readout({ value, format, fallback = '—' }) {
  const [shown, setShown] = useState(Number.isFinite(value) ? value : null);
  const [changed, setChanged] = useState(false);
  const shownRef = useRef(shown);
  const prevRef = useRef(value);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (!Number.isFinite(value)) { shownRef.current = null; return undefined; }
    if (Object.is(prev, value)) return undefined;
    // Start from whatever is on screen now, so a new value mid-count continues smoothly.
    const from = Number.isFinite(shownRef.current) ? shownRef.current : value;
    const duration = reducedMotion() ? 0 : DURATION_MS;
    setChanged(true);
    const glow = setTimeout(() => setChanged(false), GLOW_MS);
    const start = performance.now();
    let frame = 0;
    const tick = (now) => {
      const v = countUpValue(from, value, now - start, duration);
      shownRef.current = v;
      setShown(v);
      if (v !== value) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); clearTimeout(glow); };
  }, [value]);

  if (!Number.isFinite(value)) return <span className="readout">{fallback}</span>;
  return <span className={'readout' + (changed ? ' changed' : '')}>{format(Number.isFinite(shown) ? shown : value)}</span>;
}
