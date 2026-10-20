/* Vaelo reading a reply aloud, with the voice and pace chosen in Settings.
   Uses the system's own speech, so nothing leaves the device. */

export function speechSupport() {
  return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

/* Voices arrive a moment after the page loads on some browsers */
export function listVoices() {
  if (!speechSupport()) return [];
  return speechSynthesis.getVoices().filter((voice) => voice.localService || voice.lang.startsWith(navigator.language.slice(0, 2)));
}

export function onVoices(callback) {
  if (!speechSupport()) return () => {};
  speechSynthesis.addEventListener("voiceschanged", callback);
  return () => speechSynthesis.removeEventListener("voiceschanged", callback);
}

/* Words only: code, tables and links read badly aloud, so they are left out */
export function speakable(markdown) {
  return String(markdown)
    .replace(/```[\s\S]*?(```|$)/g, " ")
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
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(words);
  utterance.rate = rate;
  const chosen = voice && speechSynthesis.getVoices().find((item) => item.voiceURI === voice);
  if (chosen) utterance.voice = chosen;
  speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  if (speechSupport()) speechSynthesis.cancel();
}
