# Jarvis Cloud

Use Jarvis from my phone without leaving my PC running.

This repository is for a separate cloud deployment of [Hermes Agent](https://github.com/NousResearch/hermes-agent), connected to the Jarvis web interface. Keeping it separate means the local setup remains available if cloud hosting stops working. Computer access, local Ollama models and heavier rendering stay on the PC.

The service runs Hermes's native API gateway in Docker. The initial cloud profile uses OpenRouter's free pool, with an optional NVIDIA fallback. Groq is left out on purpose: its free tier caps tokens per minute below the size of one agent request, and the 413 it returns makes Hermes wipe the conversation instead of falling back. Research uses Exa, Tavily and Firecrawl when their keys are configured. The larger local FreeLLMAPI pool has not been mirrored here.

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

Render's free instance sleeps when idle and has no persistent disk. Conversations, memory and learned skills are temporary in this deployment; external storage still needs to be connected. Automatic background skill reviews are disabled here until their results can be retained. The local installation is unaffected.

Only one agent run is admitted at a time to limit memory use. Browser automation, voice, media generation and local Ollama aren't part of this initial cloud profile. The 512 MB hosting limit still needs to be checked under a real conversation workload.

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
