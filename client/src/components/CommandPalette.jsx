import { useEffect, useMemo, useRef, useState } from 'react';
import { searchPalette } from '../lib/paletteSearch.js';
import { useI18n } from '../i18n/i18n.jsx';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import Icon from './icons.jsx';

const optId = (id) => 'pal-opt-' + String(id).replace(/[^\w-]/g, '_');

// Ctrl/⌘+K command palette (UI stage 1): an accessible combobox over pages and actions. Keys are
// handled on the dialog itself and Escape stops there, so only the top-most overlay closes.
export default function CommandPalette({ open, onClose, items, onSelect }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const results = useMemo(() => searchPalette(query, items), [query, items]);

  useEffect(() => { if (open) { setQuery(''); setActive(0); inputRef.current?.focus(); } }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (open && results[active]) document.getElementById(optId(results[active].id))?.scrollIntoView({ block: 'nearest' });
  }, [open, active, results]);
  useFocusTrap(dialogRef, open);

  if (!open) return null;

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (results.length ? (a + 1) % results.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (results.length ? (a - 1 + results.length) % results.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) onSelect(results[active]); }
  };

  return (
    <div className="palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('Command palette')} ref={dialogRef} onKeyDown={onKeyDown}>
        <div className="palette-input-row">
          <Icon name="search" size={18} />
          <input ref={inputRef} className="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list"
            aria-autocomplete="list" aria-activedescendant={results[active] ? optId(results[active].id) : undefined}
            aria-label={t('Search pages and actions…')} placeholder={t('Search pages and actions…')}
            value={query} onChange={e => setQuery(e.target.value)} spellCheck={false} autoComplete="off" />
          <kbd>Esc</kbd>
        </div>
        <ul id="palette-list" className="palette-list" role="listbox" aria-label={t('Command palette')}>
          {results.map((r, i) => (
            <li key={r.id} id={optId(r.id)} role="option" aria-selected={i === active}
              className={'palette-option' + (i === active ? ' active' : '')}
              onMouseMove={() => { if (i !== active) setActive(i); }} onClick={() => onSelect(r)}>
              <Icon name={r.icon} size={18} />
              <span className="palette-label">{r.label}</span>
              {r.group && <span className="palette-group">{r.group}</span>}
            </li>
          ))}
        </ul>
        <div className="palette-empty" role="status">{results.length === 0 ? t('No matches') : ''}</div>
      </div>
    </div>
  );
}
