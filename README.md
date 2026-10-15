# Jarvis Cloud

Use Jarvis from my phone without leaving my PC running.

This repository is for a separate cloud deployment of [Hermes Agent](https://github.com/NousResearch/hermes-agent), connected to the Jarvis web interface. Keeping it separate means the local setup remains available if cloud hosting stops working. Computer access, local Ollama models and heavier rendering stay on the PC.

The service runs Hermes's native API gateway in Docker. The initial cloud profile uses OpenRouter's free pool, which runs out after 50 requests a day. Two optional fallbacks pick up after it, in this order: NVIDIA, then Google Gemini (`GEMINI_API_KEY`, model `gemini-2.5-flash` unless `GEMINI_MODEL` says otherwise). Gemini runs through Hermes's built-in Gemini provider, which adapts tool definitions for Google; its free tier is small (a few hundred requests a day), so it stretches a conversation rather than replacing the other two. Groq is left out on purpose: its free tier caps tokens per minute below the size of one agent request, and the 413 it returns makes Hermes wipe the conversation instead of falling back. Research uses Exa, Tavily and Firecrawl when their keys are configured.

To give the cloud the same 30-plus provider pool local Jarvis uses, set `FREELLMAPI_URL` (an HTTPS address that reaches a FreeLLMAPI router, such as a tunnel to the one on the PC) and `FREELLMAPI_API_KEY` (its unified key). The router then leads with model `auto`, and OpenRouter, NVIDIA and Gemini become its fallbacks for whenever the router can't be reached.

## Run locally

Copy `.env.example` to `.env`, generate a random `API_SERVER_KEY` of at least 32 characters, and add your OpenRouter key. Optional provider keys enable the corresponding fallbacks and research tools.

```sh
docker build -t jarvis-cloud .
docker run --rm --env-file .env -p 10000:10000 -v jarvis-data:/opt/data jarvis-cloud
```

Connect an OpenAI-compatible client to `http://localhost:10000/v1`, using the Jarvis API key and model name `jarvis`. The native API supports chat streaming, tool progress and sessions. Provider accounts are shared with local Jarvis, so their allowances don't increase.

## Deploy on Render

Use Docker, branch `main`, the repository root and the Free instance. Set the health check path to `/health` and leave the Docker command override empty. Add the required keys in Render's Environment settings. `render.yaml` contains the same service settings.

Without valid credentials, `/health` reports `setup_required` and chat stays disabled. Once configured, the gateway requires bearer authentication. A web frontend should keep that key server-side behind its own sign-in flow.

Render's free instance sleeps after 15 idle minutes and takes minutes to wake, so the container pings its own public `/health` every 10 minutes to stay up. One always-on free service uses about 744 of a workspace's 750 free hours a month; if other free services share the workspace, set `KEEP_AWAKE=0` and the web app falls back to waking it on demand. The instance also has no persistent disk. Conversations, memory and learned skills are temporary in this deployment; external storage still needs to be connected. Automatic background skill reviews are disabled here until their results can be retained. The local installation is unaffected.

Only one agent run is admitted at a time to limit memory use. A run gets up to 60 agent steps, and slow free models get 150 seconds of silence before a stream counts as stalled. Each reply streams through a Vercel function that stops at five minutes; anything longer ends with what arrived and a Continue option. Browser automation, voice, media generation and local Ollama aren't part of this initial cloud profile. The 512 MB hosting limit still needs to be checked under a real conversation workload.

Research calls Exa, Tavily and Firecrawl directly over HTTP rather than importing their SDKs at runtime. Downloads are capped at 512 KiB before JSON parsing; page content is capped at 10,000 characters. Extraction reads one page at a time, up to four per tool call, with a 20-second network timeout and fallback for failed pages. History compression starts at 24,000 tokens. The cloud profile keeps at most one cached agent, uses a 320 MB cache-pressure threshold, and limits allocator arenas. These bounds reduce memory pressure; a real Render workload is still needed to establish peak usage. A stream that ends without an answer and a completion marker is reported as interrupted.

## Checks

```sh
python -m unittest discover -s tests -v
```

The bootstrap checks use fake credentials and no model calls. The official Hermes image is pinned by digest so an upstream update doesn't silently change the deployment.

## Phone interface

The `web` directory deploys separately to [vaelochat.vercel.app](https://vaelochat.vercel.app). Google sign-in is restricted to the workspace owner. A server-side proxy streams Hermes replies and tool progress; the browser never receives the gateway key.

What reaches the web from Hermes: tool activity, status notes (slow provider, fallback switches), the model's reasoning when the provider shares it, token usage, images in either direction, and approval requests. Approvals can be answered from the web as allow once, allow for this conversation, or deny; permanent "always" rules stay with a Hermes app on your own device. Stopping a reply cancels the Hermes run too (`supportsCancellation` in `vercel.json`), which matters because the cloud runs one reply at a time. Mid-run steering isn't available here: Hermes only exposes it for `/v1/runs`, not streaming chat completions.

On a phone, add the site to your home screen and it runs as an app: its own icon, no browser chrome, a "New conversation" shortcut, and saved conversations readable offline. The service worker (`web/public/sw.js`) only stores the public app shell; nothing under `/api` is ever cached, and signing out forgets the offline copy of who you are.

From `web`, run `npm ci`, `npm test` and `npm run build`. For a full local preview including API routes, use `vercel dev` with the server environment variables from `.env.example`. `npm run dev` starts only the interface.

Google's Web application client must allow the website's origin under Authorized JavaScript origins, and `https://vaelochat.vercel.app/` (trailing slash included) under Authorized redirect URIs. The redirect URI is for the fallback sign-in: when Safari content blockers or tracking protection hide Google's in-page button, Vaelo signs in through Google's own page instead and receives the same kind of ID token. No Google API scopes or client secret are needed for sign-in. Conversations are saved in this browser, scoped to the signed-in account; this is not cross-device storage. Render memory remains temporary.
