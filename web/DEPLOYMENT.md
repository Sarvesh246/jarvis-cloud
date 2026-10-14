# Production runtime settings

The Vercel project's production feedback toolbar is disabled
(`enableProductionFeedback: false`). This is a project setting, not a
`vercel.json` option. Keep it disabled when recreating the project so injected
feedback scripts do not conflict with the strict Content Security Policy.

Chat requests wait up to two minutes for the Render backend's health endpoint
before submitting the prompt. Readiness checks use GET requests only, wake the
public root once if necessary, and stop when the browser cancels. A chat POST
is never retried automatically.

Conversations use the project's **private** `vaelo-chats` Vercel Blob store.
`BLOB_READ_WRITE_TOKEN` is server-only and must be connected to each deployment
environment. The authenticated `/api/chats` endpoint partitions storage by the
verified Google subject; writes require the existing origin and CSRF checks.
Reads bypass the Blob CDN cache so other devices see committed updates.

Visible, online clients sync every five seconds and on focus, visibility and
network recovery. Existing browser history migrates on the first authenticated
visit. Both devices must sign in with the same Google account. Offline changes
and their acknowledged revisions are saved together locally. Conditional index
writes prevent lost updates; conflicting edits retain a separate device copy.
Messages, reply versions, pins and documents travel with each conversation.
The old 30-conversation truncation has been removed.

Conversation JSON is uploaded in immutable chunks, then published through an
atomic index update. A failed upload never publishes a partial conversation.
Superseded chunks are removed after a replacement is published. Interrupted
uploads or failed cleanup can leave private chunks; there is currently no
background cleanup of those orphaned chunks. The per-conversation sync
limit is 64 million JSON characters. Browser backup capacity can be smaller;
the app shows a notice if a local save or cloud sync fails.
