// Engine Web Worker: runs long engine tasks (hosting searches, feeder split, 24 h scans, report
// generation) off the UI thread. All the logic is in lib/engineTasks.js; this file only connects it
// to the worker's message port. Spawned per task by lib/runInWorker.js, which cancels by
// terminating it.
import { handleEngineMessage } from '../lib/engineTasks.js';

self.onmessage = (e) => handleEngineMessage(e.data, (msg) => self.postMessage(msg));
