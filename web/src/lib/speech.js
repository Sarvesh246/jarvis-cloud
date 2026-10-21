/* Vaelo reading a reply aloud, with the voice and pace chosen in Settings.
   Playback uses the browser's speech service. */

import { withoutFencedCode } from "./markdown-fences.js";

export function speechSupport() {
  return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

/* Voices arrive a moment after the page loads on some browsers */
export function listVoices() {
  if (!speechSupport()) return [];
  try {
    return speechSynthesis.getVoices().filter((voice) => voice.localService || voice.lang.startsWith(navigator.language.slice(0, 2)));
  } catch {
    return [];
  }
}

export function onVoices(callback) {
  if (!speechSupport()) return () => {};
  const engine = speechSynthesis;
  try {
    engine.addEventListener("voiceschanged", callback);
  } catch {
    return () => {};
  }
  return () => {
    try { engine.removeEventListener("voiceschanged", callback); } catch { /* Engine already closed. */ }
  };
}

/* Words only: code, tables and links read badly aloud, so they are left out */
export function speakable(markdown) {
  // Container markers are silent; remove them before recognizing code fences.
  const text = String(markdown)
    .replace(/^(?: {0,3}>[ \t]?)+/gm, "")
    .replace(/^ {0,3}(?:[-+*]|\d{1,9}[.)]) +(?=[`~]{3})/gm, "")
    .replace(/^[ \t]+(?=[`~]{3})/gm, "");
  return withoutFencedCode(text)
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

export function speak(text, { voice = "", rate = 1 } = {}) {
  if (!speechSupport()) return false;
  const words = speakable(text);
  if (!words) return false;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(words);
    utterance.rate = rate;
    const chosen = voice && speechSynthesis.getVoices().find((item) => item.voiceURI === voice);
    if (chosen) utterance.voice = chosen;
    speechSynthesis.speak(utterance);
    return true;
  } catch {
    // Optional audio must not interrupt saving or completing the written reply.
    return false;
  }
}

export function stopSpeaking() {
  if (speechSupport()) {
    try { speechSynthesis.cancel(); } catch { /* Playback is already unavailable. */ }
  }
}
