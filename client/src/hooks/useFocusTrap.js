import { useEffect } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** While `active`, Tab and Shift+Tab cycle through the focusable elements inside containerRef. */
export function useFocusTrap(containerRef, active) {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      const el = containerRef.current;
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [containerRef, active]);
}
