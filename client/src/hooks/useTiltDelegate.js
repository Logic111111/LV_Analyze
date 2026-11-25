import { useEffect } from 'react';
import { tiltFor } from '../lib/tilt.js';

/**
 * One delegated pointer listener on `containerRef` tilts whichever `selector` element the pointer
 * is over (sets --rx/--ry in degrees, once per animation frame) and resets it when the pointer
 * leaves. Off for touch-only devices and for reduced motion.
 */
export function useTiltDelegate(containerRef, selector = '.stat') {
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !window.matchMedia) return undefined;
    if (window.matchMedia('(hover: none)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let frame = 0, current = null, lastEvent = null;
    const reset = (el) => { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); };
    const onMove = (e) => {
      const el = e.target instanceof Element ? e.target.closest(selector) : null;
      if (current && current !== el) { reset(current); current = null; }
      if (!el || !root.contains(el)) return;
      current = el;
      lastEvent = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!current || !lastEvent) return;
        const { rx, ry } = tiltFor(lastEvent.clientX, lastEvent.clientY, current.getBoundingClientRect());
        current.style.setProperty('--rx', rx.toFixed(2) + 'deg');
        current.style.setProperty('--ry', ry.toFixed(2) + 'deg');
      });
    };
    const onLeave = () => { if (current) reset(current); current = null; };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    return () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(frame);
      if (current) reset(current);
    };
  }, [containerRef, selector]);
}
