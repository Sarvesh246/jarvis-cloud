// Persist observations once. Replaying a relay run is reading history.
export function completedTiming(message, timing = {}, now = Date.now()) {
  const completedAt = message.completedAt || (Number.isFinite(timing.completedAt) ? timing.completedAt : now);
  const firstAnswerMs = Number.isFinite(timing.firstAnswerMs) ? timing.firstAnswerMs : message.thoughtMs;
  return {
    completedAt,
    thoughtMs: message.completedAt ? message.thoughtMs : firstAnswerMs ?? Math.max(0, completedAt - (message.startedAt || completedAt)),
    ...(Number.isFinite(timing.totalMs) && !message.completedAt && { totalMs: timing.totalMs }),
    ...(Number.isFinite(timing.queueMs) && !message.completedAt && { queueMs: timing.queueMs }),
  };
}
