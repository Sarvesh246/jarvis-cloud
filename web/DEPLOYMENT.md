# Production runtime settings

The Vercel project's production feedback toolbar is disabled
(`enableProductionFeedback: false`). This is a project setting, not a
`vercel.json` option. Keep it disabled when recreating the project so injected
feedback scripts do not conflict with the strict Content Security Policy.

Chat requests wait up to two minutes for the Render backend's health endpoint
before starting a reply. Readiness checks use GET requests only, wake the
public root once if necessary, and stop when the browser cancels.

Replies run on the relay in the Render container, not in a Vercel function.
`POST /api/chat` starts a reply under the reply's own id and follows it;
`GET /api/chat?run=<id>&after=<n>` picks a reply back up after event `n`;
`POST /api/stop` ends one. Each function follows a reply for under five
minutes and then tells the page to ask again, so a reply can run longer than
any one function. Starting a reply twice with the same id follows the first
run rather than starting another.

Conversations, saved work and desktop sign-in grants live in a Postgres
database (Neon, via the Vercel Marketplace) in one `kv_store` table that the
server creates on first use. `DATABASE_URL` is server-only and must be set on
each deployment environment. The authenticated `/api/chats` endpoint partitions
storage by the verified Google subject; writes require the existing origin and
CSRF checks. Compare-and-swap writes use a per-row `etag`, so other devices
always see committed updates. (This replaced Vercel Blob, whose free tier of
operations ran out under five-second sync polling.)

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
