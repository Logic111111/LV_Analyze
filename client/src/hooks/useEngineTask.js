import { useCallback, useEffect, useRef, useState } from 'react';
import { runInWorker, isAbortError } from '../lib/runInWorker.js';

// One long engine action on a page (e.g. "Compute hosting capacity"), run in the engine worker:
//
//   const task = useEngineTask();
//   const r = await task.run('hostingCapacity', { design }, 'Scanning poles');
//   if (r.ok) setResults(r.result);
//   ...
//   <TaskProgress task={task} />
//
// Starting a new run cancels the previous one, Cancel stops it immediately (the worker is
// terminated), and leaving the page cancels whatever is still running. `run` never throws: it
// resolves to { ok: true, result }, { ok: false, cancelled: true } or { ok: false, error }, and the
// hook's state carries the same outcome so <TaskProgress> can show it.
export function useEngineTask() {
  const [state, setState] = useState({ running: false, progress: null, label: '', error: null, cancelled: false });
  const ctrlRef = useRef(null);

  const run = useCallback(async (task, args, label = 'Working') => {
    if (ctrlRef.current) ctrlRef.current.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setState({ running: true, progress: null, label, error: null, cancelled: false });
    try {
      const result = await runInWorker(task, args, {
        signal: ctrl.signal,
        onProgress: (progress) => { if (ctrlRef.current === ctrl) setState(s => ({ ...s, progress })); }
      });
      if (ctrlRef.current === ctrl) { ctrlRef.current = null; setState({ running: false, progress: null, label, error: null, cancelled: false }); }
      return { ok: true, result };
    } catch (err) {
      const cancelled = isAbortError(err);
      // A run superseded by a newer one is cancelled silently — the newer run owns the state.
      if (ctrlRef.current === ctrl) {
        ctrlRef.current = null;
        setState({ running: false, progress: null, label, error: cancelled ? null : (err.message || String(err)), cancelled });
      }
      if (!cancelled) console.error(err);
      return cancelled ? { ok: false, cancelled: true } : { ok: false, error: err };
    }
  }, []);

  const cancel = useCallback(() => { if (ctrlRef.current) ctrlRef.current.abort(); }, []);

  useEffect(() => () => { if (ctrlRef.current) ctrlRef.current.abort(); }, []);

  return { ...state, run, cancel };
}
