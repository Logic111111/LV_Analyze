import { useT } from '../i18n/i18n.jsx';
// Progress bar + Cancel for one useEngineTask() action, and the outcome afterwards (cancelled, or
// the error). The bar is determinate once the engine reports `done/total`, indeterminate before.
// Stage text and percentage are always written out, so nothing relies on the bar's colour.
export default function TaskProgress({ task }) {
  const t = useT();
  if (task.running) {
    const p = task.progress;
    const pct = p && p.total > 0 ? Math.min(100, Math.round(p.done / p.total * 100)) : null;
    const text = `${p && p.stage ? p.stage : task.label}${p && p.total > 0 ? ` — ${p.done} of ${p.total} (${pct} %)` : '…'}`;
    return (
      <div className="task-progress" role="status" aria-live="polite">
        <div className="task-progress-text">{text}</div>
        <div className="task-progress-row">
          <div
            className={'task-progress-bar' + (pct == null ? ' indeterminate' : '')}
            role="progressbar" aria-label={task.label}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct == null ? undefined : pct}
          >
            <div className="task-progress-fill" style={pct == null ? undefined : { width: pct + '%' }} />
          </div>
          <button type="button" className="ghost" onClick={task.cancel}>{t('Cancel')}</button>
        </div>
      </div>
    );
  }
  if (task.cancelled) return <div className="task-progress-done" role="status">{task.label} — {t('cancelled')}.</div>;
  if (task.error) return <div className="note" role="alert" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', marginTop: 12 }}>{task.label} {t('failed')}: {task.error}</div>;
  return null;
}
