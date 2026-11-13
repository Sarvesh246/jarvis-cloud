/* One IndexedDB record per conversation. Legacy localStorage is read only
   during migration and removed only after a successful durable write. */
import { fingerprint, mergeChats, syncKey } from "./chat-sync.js";
const snapshots = new Map(), seen = new Map();
let opening;
function database() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("Local database is unavailable."));
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("vaelo-chat-cache", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("chats", { keyPath: ["sub", "id"] }).createIndex("account", "sub");
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = null; }; resolve(request.result); };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { opening = null; reject(new Error("Close other Vaelo tabs to update local storage.")); };
  });
  return opening;
}
export function cachedChats(sub) { return snapshots.get(sub); }
export async function loadChatCache(sub) {
  const db = await database();
  const rows = await new Promise((resolve, reject) => {
    const request = db.transaction("chats").objectStore("chats").index("account").getAll(sub);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const value = { chats: rows.filter(row => row.chat).map(row => row.chat),
    base: Object.fromEntries(rows.filter(row => row.base).map(row => [row.id, row.base])),
    deleted: rows.filter(row => row.deleted).map(row => row.id) };
  seen.set(sub, new Map(rows.map(row => [row.id, row.mark])));
  if (rows.length) snapshots.set(sub, value);
  return rows.length ? value : null;
}
export async function saveChatCache(sub, value) {
  const db = await database();
  const previous = snapshots.get(sub), known = seen.get(sub) || new Map();
  const prior = new Map(previous?.chats.map(chat => [chat.id, chat]) || []);
  const changes = value.chats.filter(chat => prior.get(chat.id) !== chat || JSON.stringify(previous?.base[chat.id]) !== JSON.stringify(value.base[chat.id]));
  const removals = value.deleted.filter(id => !previous?.deleted.includes(id));
  const write = () => new Promise((resolve, reject) => {
    const tx = db.transaction("chats", "readwrite"), store = tx.objectStore("chats");
    for (const chat of changes) {
      const read = store.get([sub, chat.id]);
      read.onsuccess = () => {
        const existing = read.result, mark = fingerprint(chat);
        if (existing && !existing.chat && (existing.deleted || existing.base) && known.get(chat.id) != null) {
          const copy = { ...chat, id: crypto.randomUUID(), title: `${chat.title} (device copy)` };
          store.put({ sub, id: copy.id, chat: copy, mark: fingerprint(copy) });
          return;
        }
        if (existing?.chat && existing.mark !== known.get(chat.id) && existing.mark !== mark) {
          const merged = mergeChats(chat, existing.chat);
          if (merged) {
            store.put({ sub, id: chat.id, chat: merged, mark: fingerprint(merged), base: value.base[chat.id] });
            known.set(chat.id, mark); return;
          }
          // Preserve both offline edits, including renames, before publishing a
          // new local copy. The regular server sync also resolves device edits.
          const copy = { ...existing.chat, id: crypto.randomUUID(), title: `${existing.chat.title} (device copy)` };
          store.put({ sub, id: copy.id, chat: copy, mark: fingerprint(copy) });
        }
        store.put({ sub, id: chat.id, chat, mark, base: value.base[chat.id] }); known.set(chat.id, mark);
      };
    }
    for (const id of removals) store.put({ sub, id, chat: null, mark: null, base: value.base[id], deleted: true });
    // Acknowledged deletions keep their server baseline so stale tabs cannot
    // resurrect them; explicit deletion intent stays separate.
    for (const [id, base] of Object.entries(value.base)) if (!value.chats.some(chat => chat.id === id) && !value.deleted.includes(id))
      store.put({ sub, id, chat: null, mark: null, base, deleted: false });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error("Local backup failed."));
  });
  if (globalThis.navigator?.locks) await navigator.locks.request(`vaelo-cache:${sub}`, write); else await write();
  snapshots.set(sub, value); seen.set(sub, known);
  globalThis.dispatchEvent?.(new Event("vaelo-cache-saved"));
  try { localStorage.removeItem(syncKey(sub)); localStorage.removeItem(`jarvis-chats:${sub}`); } catch { /* durable data already committed */ }
}
