import { useEffect } from 'react';
import { needsTabStop } from '../lib/scrollRegion.js';

const AUTO = 'data-auto-tabstop';

/**
 * Every `selector` element that actually scrolls (wide tables on phones, long tables in a capped
 * wrapper) gets tabindex="0" so keyboard users can scroll it; it loses the tab stop again once it
 * fits. Watches the whole document (drawers are portalled to <body>), batched to one pass per frame.
 */
export function useKeyboardScrollRegions(selector = '.tbl-wrap') {
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    const observed = new Set();
    const update = (el) => {
      if (needsTabStop(el)) {
        if (!el.hasAttribute('tabindex')) { el.setAttribute('tabindex', '0'); el.setAttribute(AUTO, ''); }
      } else if (el.hasAttribute(AUTO)) {
        el.removeAttribute('tabindex');
        el.removeAttribute(AUTO);
      }
    };
    const ro = new ResizeObserver(entries => entries.forEach(e => update(e.target)));
    let frame = 0;
    const scan = () => {
      frame = 0;
      observed.forEach(el => { if (!el.isConnected) { ro.unobserve(el); observed.delete(el); } });
      document.querySelectorAll(selector).forEach(el => {
        if (!observed.has(el)) { observed.add(el); ro.observe(el); }
        update(el);
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(scan); };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, characterData: true, subtree: true });
    scan();
    return () => { cancelAnimationFrame(frame); mo.disconnect(); ro.disconnect(); };
  }, [selector]);
}
