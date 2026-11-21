// Narrow, drift-checked change to the pinned streaming proxy.
//
// Upstream holds every chunk, thinking included, until the model writes its
// first visible word, so a model that dies early can fail over unseen. The
// cost: a model that thinks for ten seconds shows nothing for ten seconds,
// then dumps its whole thought at once with the answer, and Vaelo's relay
// (which allows four seconds for a first byte) gives up on it and starts the
// slower agent instead. Once a model has been thinking for a moment it is
// committed to, and its thinking streams live. Short thoughts stay held, and
// structured-output requests keep holding everything, as upstream intends.
export const LIVE_THINKING_AFTER_MS = 1500;

export function patchLiveThinking(proxy) {
  const before = '                if (headerSent) writeChunk(cleaned); else preamble.push(cleaned);';
  const after = `                if (headerSent) writeChunk(cleaned); else {
                  preamble.push(cleaned);
                  if (reasoning.length > 0 && mode === 'undecided' && !samplingParams.response_format
                      && Date.now() - start >= ${LIVE_THINKING_AFTER_MS}) flushHeaders();
                }`;
  if (proxy.includes(after)) return proxy;
  if (proxy.split(before).length !== 2) throw new Error('Pinned live thinking contract changed');
  return proxy.replace(before, () => after);
}
