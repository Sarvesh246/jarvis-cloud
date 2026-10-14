const PART_SIZE = 500_000;
const MAX_PARTS = 128;
export const syncKey = (sub) => `vaelo-sync:${sub}`;

export function fingerprint(chat) {
  if (!chat) return null;
  const text = JSON.stringify(chat);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}

export function readSyncCache(sub, storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(syncKey(sub)) || "null");
    return Array.isArray(saved?.chats) && saved?.base ? saved : null;
  } catch { return null; }
}

// The acknowledged baseline and local edits survive offline restarts together.
// The server uses conditional writes; a conflicting local edit becomes a copy.
export class ChatSync {
  constructor({ sub, chats, base = {}, request, onChange, onStatus, onConflict,
    storage = localStorage, uuid = () => crypto.randomUUID(), busy = () => null }) {
    Object.assign(this, { sub, request, onChange, onStatus, onConflict, storage, uuid, busy });
    this.current = new Map(chats.map((chat) => [chat.id, chat]));
    this.base = { ...base };
    this.stopped = false;
    this.running = false;
  }
  observe(chats) {
    this.current = new Map(chats.map((chat) => [chat.id, chat]));
    this.persist();
  }
  persist() {
    try {
      this.storage.setItem(syncKey(this.sub), JSON.stringify({ chats: [...this.current.values()], base: this.base }));
      this.storage.removeItem(`jarvis-chats:${this.sub}`);
    } catch { this.onStatus("Local backup is full. Keep this tab open until sync completes."); }
  }
  dirty(id) { return fingerprint(this.current.get(id)) !== (this.base[id]?.fingerprint || null); }
  emit() {
    if (this.stopped) return;
    this.persist();
    this.onChange([...this.current.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0)));
  }
  async download(id, entry) {
    const chunks = [];
    for (let part = 0; part < entry.parts; part++) {
      const query = new URLSearchParams({ id, version: entry.version, part: String(part) });
      chunks.push((await this.request(`/api/chats?${query}`)).text);
    }
    return JSON.parse(chunks.join(""));
  }
  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const remote = (await this.request("/api/chats")).entries;
      const blocked = new Set();
      for (const [id, entry] of Object.entries(remote)) {
        if (entry.version === this.base[id]?.version) continue;
        if (this.busy() && this.dirty(id)) { blocked.add(id); continue; }
        const chat = entry.deleted ? null : await this.download(id, entry);
        if (this.stopped) return;
        const local = this.current.get(id);
        if (this.dirty(id) && fingerprint(local) !== fingerprint(chat)) {
          if (local) {
            const copy = { ...local, id: this.uuid(), title: `${local.title} (device copy)` };
            this.current.set(copy.id, copy);
          }
          this.onConflict();
        }
        if (chat) this.current.set(id, chat);
        else this.current.delete(id);
        this.base[id] = { version: entry.version, fingerprint: fingerprint(chat) };
        this.emit();
      }
      const ids = new Set([...this.current.keys(), ...Object.keys(this.base)]);
      for (const id of ids) {
        if (this.stopped) return;
        if (blocked.has(id) || !this.dirty(id)) continue;
        const chat = this.current.get(id);
        const mark = fingerprint(chat);
        const version = this.uuid();
        const base = this.base[id]?.version || null;
        const text = chat ? JSON.stringify(chat) : "";
        const parts = Math.ceil(text.length / PART_SIZE);
        if (parts > MAX_PARTS) throw new Error("This conversation is too large to sync. Your local copy is safe.");
        for (let part = 0; part < parts; part++) {
          await this.request("/api/chats", { action: "part", id, version, part,
            text: text.slice(part * PART_SIZE, (part + 1) * PART_SIZE) });
          if (this.stopped) return;
        }
        await this.request("/api/chats", { action: "commit", id, version, base, parts, deleted: !chat });
        if (this.stopped) return;
        // Changes made during the upload remain dirty for the next pass.
        this.base[id] = { version, fingerprint: mark };
        this.persist();
      }
      this.onStatus("");
    } catch (error) {
      if (!this.stopped) this.onStatus(error.status === 409 ? "" :
        "Conversations aren’t syncing yet. Your changes are saved on this device; retrying automatically.");
    } finally { this.running = false; }
  }
  stop() { this.stopped = true; }
}
