# Jarvis Cloud

Use Jarvis from my phone without leaving my PC running.

This repository is for a separate cloud deployment of [Hermes Agent](https://github.com/NousResearch/hermes-agent), connected to the Jarvis web interface. Keeping it separate means the local setup remains available if cloud hosting stops working. Computer access, local Ollama models and heavier rendering stay on the PC.

The service runs Hermes's native API gateway in Docker. The initial cloud profile uses OpenRouter's free pool, with optional Groq and NVIDIA fallbacks. Research uses Exa, Tavily and Firecrawl when their keys are configured. The larger local FreeLLMAPI pool has not been mirrored here.

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

The `web` directory deploys separately to [jarvisassistant.vercel.app](https://jarvisassistant.vercel.app). Google sign-in is restricted to the workspace owner. A server-side proxy streams Hermes replies and tool progress; the browser never receives the gateway key.

From `web`, run `npm ci`, `npm test` and `npm run build`. For a full local preview including API routes, use `vercel dev` with the server environment variables from `.env.example`. `npm run dev` starts only the interface.

Google's Web application client must allow the website's origin. No Google API scopes or client secret are needed for sign-in. Conversations are saved in this browser, scoped to the signed-in account; this is not cross-device storage. Render memory remains temporary.
