// PCM WAV keeps capture independent of WebM/Ogg support in the OS webview.
export function pcmWav(chunks, sampleRate, outputRate = 16000) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
  const count = Math.floor(length * outputRate / sampleRate);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, outputRate, true); view.setUint32(28, outputRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data");
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * sampleRate / outputRate);
    const end = Math.min(length, Math.max(start + 1, Math.floor((i + 1) * sampleRate / outputRate)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  return new Uint8Array(buffer);
}

export class DesktopRecognition {
  constructor() { this.chunks = []; this.controller = new AbortController(); }
  async start() {
    if (this.started || this.cancelled || this.stopping) return;
    this.started = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
      if (this.cancelled || this.stopping) { this.cleanup(); this.end(); return; }
      this.context = new AudioContext();
      await this.context.resume();
      // Permission and resume can settle after Stop, Cancel or unmount.
      if (this.cancelled || this.stopping) { this.cleanup(); this.end(); return; }
      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = event => {
        this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        this.samples = (this.samples || 0) + event.inputBuffer.length;
        if (this.samples >= this.context.sampleRate * 60) this.stop();
      };
      this.source.connect(this.processor);
      this.processor.connect(this.context.destination);
    } catch (error) {
      if (!this.cancelled && !this.stopping)
        this.onerror?.({ error: error.name === "NotAllowedError" ? "not-allowed" : "audio-capture" });
      this.abort();
    }
  }
  end() {
    if (this.ended) return;
    this.ended = true;
    this.onend?.();
  }
  cleanup() {
    const { processor, source, stream, context } = this;
    this.processor = this.source = this.stream = this.context = null;
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
    source?.disconnect();
    stream?.getTracks().forEach(track => track.stop());
    context?.close().catch(() => {});
  }
  async stop() {
    if (this.stopping || this.cancelled) return;
    this.stopping = true;
    this.onprocessing?.();
    const rate = this.context?.sampleRate;
    this.cleanup();
    if (!rate || !this.chunks.length) { this.end(); return; }
    try {
      const bytes = pcmWav(this.chunks, rate);
      this.chunks = [];
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const session = await (await fetch("/api/session", { signal: this.controller.signal })).json();
      const response = await fetch("/api/transcribe", {
        method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf },
        body: JSON.stringify({ audio: btoa(binary) }), signal: this.controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Dictation could not be transcribed.");
      if (!this.cancelled) this.onresult?.({ results: [[{ transcript: data.text }]] });
    } catch (error) {
      if (!this.cancelled) this.onerror?.({ error: "transcription", message: error.message });
    } finally { this.end(); }
  }
  abort() { this.cancelled = true; this.controller.abort(); this.cleanup(); this.chunks = []; this.end(); }
}
