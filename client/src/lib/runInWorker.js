// Promise-based client for the engine worker (workers/engine.worker.js).
//
//   const result = await runInWorker('hostingCapacity', { design }, { onProgress, signal });
//
// Each call gets its own worker, so cancelling is simply terminating it: the engine needs no
// cooperative cancellation checks, a cancelled search stops mid-iteration, and there's no shared
// state for a later task to inherit. Spawning costs a few tens of milliseconds — negligible next
// to the multi-second runs that go through here. Rejects with an error whose name is 'AbortError'
// when `signal` aborts (check with isAbortError), and with the engine's own message when a task
// throws.

let nextId = 1;

/** The real worker. Kept as one literal `new Worker(new URL(...))` so Vite can bundle it. */
export function createEngineWorker() {
  return new Worker(new URL('../workers/engine.worker.js', import.meta.url), { type: 'module' });
}

export function abortError() {
  const err = new Error('Cancelled.');
  err.name = 'AbortError';
  return err;
}
export function isAbortError(err) { return !!err && err.name === 'AbortError'; }

/**
 * @param {string} task Name of an ENGINE_TASKS entry (lib/engineTasks.js).
 * @param {any} args Plain data (structured-cloned into the worker).
 * @param {{ onProgress?: (p: { stage?: string, done: number, total: number }) => void, signal?: AbortSignal, createWorker?: () => any }} [options]
 *   createWorker is injectable for tests; the default spawns the real module worker.
 * @returns {Promise<any>}
 */
export function runInWorker(task, args, { onProgress, signal, createWorker = createEngineWorker } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(abortError()); return; }
    const worker = createWorker();
    const id = nextId++;
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      worker.terminate();
      settle(value);
    };
    const onAbort = () => finish(reject, abortError());
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.id !== id) return;
      if (msg.type === 'progress') { if (onProgress && !settled) onProgress(msg.progress); }
      else if (msg.type === 'result') finish(resolve, msg.result);
      else if (msg.type === 'error') {
        const err = new Error(msg.error);
        err.name = 'EngineError';
        if (msg.stack) err.engineStack = msg.stack;
        finish(reject, err);
      }
    };
    worker.onerror = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      finish(reject, new Error((e && e.message) || 'The engine worker failed.'));
    };
    worker.postMessage({ id, task, args });
  });
}
