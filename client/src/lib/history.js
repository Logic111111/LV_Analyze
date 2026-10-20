// Undo / redo for the design being edited (P7.3), as pure state transitions so they're tested
// without React. Every change made through setDesign is undoable — form edits, table edits and
// applied proposals alike. A burst of changes less than COALESCE_MS apart (typing in a field, a
// slider being dragged) is one undo step, so undo doesn't walk back one keystroke at a time.
// Loading or starting a design clears the history.
export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 600;

export const historyInit = (design) => ({ design, past: [], future: [], lastEdit: 0 });

export function historyApply(h, updater, now) {
  const next = typeof updater === 'function' ? updater(h.design) : updater;
  if (next === h.design) return h;
  const coalesce = h.past.length > 0 && now - h.lastEdit < COALESCE_MS;
  return { design: next, past: coalesce ? h.past : [...h.past, h.design].slice(-HISTORY_LIMIT), future: [], lastEdit: now };
}

export function historyUndo(h) {
  if (!h.past.length) return h;
  return { design: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.design, ...h.future], lastEdit: 0 };
}

export function historyRedo(h) {
  if (!h.future.length) return h;
  return { design: h.future[0], past: [...h.past, h.design].slice(-HISTORY_LIMIT), future: h.future.slice(1), lastEdit: 0 };
}
