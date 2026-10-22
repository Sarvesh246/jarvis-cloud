import { requestTrace } from '../../shared/request-trace.js';

/* Explicit local opt-in. Timings and ids only; no new network request. */
export function replyTrace(run) {
  let enabled = false;
  try { enabled = new URLSearchParams(location.search).get('diagnostics') === '1' || sessionStorage.getItem('vaelo.diagnostics') === '1'; } catch { /* unavailable storage */ }
  return requestTrace(run, 'browser', { report(record) {
    if(!enabled) return;
    const previous = Array.isArray(window.__vaeloTraces) ? window.__vaeloTraces : [];
    window.__vaeloTraces = [...previous.slice(-49), record];
    console.info(JSON.stringify(record));
  } });
}
