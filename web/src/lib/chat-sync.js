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

/* A reply older than this is no longer running anywhere (the relay forgets
   runs after an hour), whatever the saved conversation still says. */
export const LIVE_MS = 55 * 60 * 1000;

/* The reply still being written at the end of a conversation, if any. Its
   words come to every device straight from the relay, so the conversation
   isn't uploaded again and again while it streams: it is saved when the
   reply starts and when it ends. */
export function liveReply(chat, now = Date.now()) {
  const last = chat?.messages?.at(-1);
  return last?.role === "assistant" && last.running && last.run &&
    now - (last.startedAt || 0) < LIVE_MS ? last : null;
}

/* Two devices changed the same conversation. When one history extends the
   other, the two are merged message by message, preferring a finished reply
   to one still running and otherwise the saved copy. Histories that truly
   diverged, or other edits on both sides (a rename, a pin), return null and
   are kept as a copy. */
const outside = ({ messages, updated, pinned, pinnedAt, ...rest }) => JSON.stringify(rest);
export function mergeChats(local, remote) {
  if (!local || !remote || outside(local) !== outside(remote)) return null;
  // A pin is a flag, not an edit worth a copy: the device that toggled it last wins.
  const pin = (local.pinnedAt || 0) > (remote.pinnedAt || 0) ? local : remote;
  const mine = local.messages, theirs = remote.messages;
  for (let i = 0; i < Math.min(mine.length, theirs.length); i++)
    if (mine[i].id !== theirs[i].id) return null;
  const longer = mine.length > theirs.length ? mine : theirs;
  const messages = longer.map((message, i) => {
    const a = mine[i], b = theirs[i];
    if (!a || !b) return message;
    return a.running && !b.running ? b : b.running && !a.running ? a : b;
  });
  return { ...remote, messages, updated: Math.max(local.updated || 0, remote.updated || 0),
    pinned: pin.pinned, pinnedAt: pin.pinnedAt };
}

// The acknowledged baseline and local edits survive offline restarts together.
// The server uses conditional writes; a conflicting local edit is merged, or
// kept as a copy when the two histories diverged.
export class ChatSync {
  constructor({ sub, chats, base = {}, request, onChange, onStatus, onConflict,
    storage = localStorage, uuid = () => crypto.randomUUID(), busy = () => null }) {
    Object.assign(this, { sub, request, onChange, onStatus, onConflict, storage, uuid, busy });
    this.current = new Map(chats.map((chat) => [chat.id, chat]));
    this.base = { ...base };
    this.stopped = false;
    this.running = false;
    this.again = false;
    this.forced = new Set();
    this.saveTimer = null;
    // Leaving the page writes the backup at once rather than after the pause.
    this.flush = () => { if (this.saveTimer) this.persist(); };
    globalThis.addEventListener?.("pagehide", this.flush);
    globalThis.document?.addEventListener?.("visibilitychange", this.flush);
  }
  observe(chats) {
    this.current = new Map(chats.map((chat) => [chat.id, chat]));
    /* A streaming reply changes the chats every frame; writing the whole
       list to localStorage each time stalls the page, so while one streams
       writes are batched. Anything else (a delete, a rename) is saved now. */
    if (![...this.current.values()].some((chat) => liveReply(chat))) this.persist();
    else this.saveTimer ??= setTimeout(() => this.persist(), 400);
    if (this.forced.size) void this.tick();
  }
  /* Save this conversation now, even mid-reply: a reply starting, or moving
     to a new run, is what other devices need to see to follow along. */
  push(id) {
    this.forced.add(id);
    // The change is usually still on its way through observe(), which saves
    // it; this only covers a push that changes nothing on screen.
    setTimeout(() => { if (this.forced.size) void this.tick(); }, 1000);
  }
  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
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
    if (this.stopped) return;
    // Asked again mid-pass (a live update, a push): one more pass follows.
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      const remote = (await this.request("/api/chats")).entries;
      const blocked = new Set();
      for (const [id, entry] of Object.entries(remote)) {
        if (entry.version === this.base[id]?.version) continue;
        if (this.busy() && this.dirty(id)) { blocked.add(id); continue; }
        let chat;
        try {
          chat = entry.deleted ? null : await this.download(id, entry);
        } catch (error) {
          // Replaced while this pass read it; the next pass reads the new one.
          if (error.status !== 404) throw error;
          blocked.add(id);
          this.again = true;
          continue;
        }
        if (this.stopped) return;
        const local = this.current.get(id);
        let next = chat;
        if (this.dirty(id) && fingerprint(local) !== fingerprint(chat)) {
          const merged = mergeChats(local, chat);
          if (merged) next = merged;
          else {
            if (local) {
              const copy = { ...local, id: this.uuid(), title: `${local.title} (device copy)` };
              this.current.set(copy.id, copy);
            }
            this.onConflict();
          }
        }
        if (next) this.current.set(id, next);
        else this.current.delete(id);
        this.base[id] = { version: entry.version, fingerprint: fingerprint(chat) };
        this.emit();
      }
      const ids = new Set([...this.current.keys(), ...Object.keys(this.base)]);
      /* One conversation that can't sync (too large, refused) must not hold
         back the rest; the first failure is reported once they've all tried. */
      let failure = null;
      for (const id of ids) {
        if (this.stopped) return;
        try {
        if (blocked.has(id) || !this.dirty(id)) continue;
        if (liveReply(this.current.get(id)) && !this.forced.has(id)) continue;
        this.forced.delete(id);
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
        } catch (error) {
          if (error.status === 409 || error.status === 401) throw error;
          failure ??= error;
        }
      }
      if (failure) throw failure;
      this.onStatus("");
    } catch (error) {
      if (!this.stopped) this.onStatus(error.status === 409 ? "" :
        "Conversations aren’t syncing yet. Your changes are saved on this device; retrying automatically.");
      if (error.status === 409) this.again = true;
    } finally {
      this.running = false;
      if (this.again && !this.stopped) {
        this.again = false;
        setTimeout(() => void this.tick(), 300);
      }
    }
  }
  stop() {
    this.flush();
    globalThis.removeEventListener?.("pagehide", this.flush);
    globalThis.document?.removeEventListener?.("visibilitychange", this.flush);
    this.stopped = true;
  }
}
