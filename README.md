# Jarvis Cloud

Use Jarvis from my phone without leaving my PC running.

This repository is for a separate cloud deployment of [Hermes Agent](https://github.com/NousResearch/hermes-agent), connected to the Jarvis web interface. Keeping it separate means the local setup remains available if cloud hosting stops working. Computer access, local Ollama models and heavier rendering stay on the PC.

The service runs Hermes's native API gateway in Docker. The initial cloud profile uses OpenRouter's free pool, which runs out after 50 requests a day. Two optional fallbacks pick up after it, in this order: NVIDIA, then Google Gemini (`GEMINI_API_KEY`, model `gemini-2.5-flash` unless `GEMINI_MODEL` says otherwise). Gemini runs through Hermes's built-in Gemini provider, which adapts tool definitions for Google; its free tier is small (a few hundred requests a day), so it stretches a conversation rather than replacing the other two. Groq is left out on purpose: its free tier caps tokens per minute below the size of one agent request, and the 413 it returns makes Hermes wipe the conversation instead of falling back. Research uses Exa, Tavily and Firecrawl when their keys are configured.

The [cloud model router](deploy/freellmapi/README.md) runs in its own Vercel Hobby project, so it works while the PC is off and consumes no Render instance hours or Hermes process memory. Set `FREELLMAPI_URL` to its HTTPS address and `FREELLMAPI_API_KEY` to its separate cloud key. The router leads with model `auto`, selecting configured free tool models with at least 128,000 tokens of context; OpenRouter, NVIDIA and Gemini remain direct fallbacks. Local and cloud use the same provider accounts, so provider quotas are shared. Cloud router counters are temporary per function instance.

## Run locally

The web app includes the Workroom, opened from the conversation rail. Think of it as
a shelf of ready-made workspaces: applying for a job, reviewing a lease, chasing a
refund, debugging, splitting trip costs and thirty-odd more. Each one already
has the long prompt written. You drop in your documents once, and every conversation
you start from it carries that brief and those documents, so you can get straight to
work. You can also set up your own, or save any conversation as a workspace from its
title bar.

A few workspaces include a check that code works out from details you enter, such as
whether a refund has fully arrived or who owes whom. The model never computes those.
Workspaces and their document text live privately in the same Vercel Blob store as
conversations. Very long documents are shortened from the middle so a chat stays within
its context; the Workroom says when that will happen.

Gotcha: saved records from before workspaces are upgraded on read. The handful whose
tool was retired stay readable, and can be exported or deleted.

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

Replies don't depend on the phone staying connected. A small relay (`cloud/relay.py`, standard library only) owns the public port and runs Hermes on a private one beside it. The web app asks the relay to start a reply; the relay holds Hermes's stream itself, numbers and keeps every event, and carries on whether anyone is reading or not. Any reader can follow a reply from the last event it saw, so a locked phone, a network switch, the five-minute Vercel limit or a closed app only means picking the reply back up: the page does this by itself when it comes back to the foreground, when a connection drops or goes quiet, and when the app is opened again. Stop is its own request that ends the run; leaving the page never does. A finished reply stays readable for an hour, a reply runs for at most fifteen minutes, and the relay keeps at most 32 MB of replies in memory. Everything outside `/vaelo/*` passes straight through to Hermes. Nothing the reply has done is thrown away. A run that ends without an answer is asked for the write-up; one cut off partway (a provider failing mid-answer, a dropped stream) is continued from exactly where it stopped, with the partial answer sent back as the assistant's own words; the relay makes up to three attempts. If Render itself restarts and takes a running reply with it, the page starts a new run that continues the answer, or picks the research back up with what was already looked into. A continuation's opening is held back until any words it repeats can be trimmed, so the two halves read as one reply. Reconnecting is silent: the person sees the research and the answer, and an error only if a reply makes no progress at all for a quarter of an hour.

Only one agent run is admitted at a time to limit memory use. A run gets up to 60 agent steps. Replies are tuned to land well inside the five-minute Vercel window: a model stream that stays silent for 60 seconds (90 for NVIDIA's large model and Gemini) is abandoned, and a failed call moves to the next provider after one attempt instead of three. At three minutes Hermes tells the model to stop gathering and write the answer from what it has. 

To keep everyday replies quick: the skills toolset is left out of the web API (Hermes's skills prompt makes the model load a skill before most replies, one more model round trip each time); conversation titles are derived without a model call; quick and balanced replies ask reasoning models for low effort, while thorough and research replies keep the default; and the Vercel proxy skips its health check when the backend answered within the last 45 seconds. Browser automation, voice, media generation and local Ollama aren't part of this initial cloud profile. The 512 MB hosting limit still needs to be checked under a real conversation workload.

Research calls Exa, Tavily and Firecrawl directly over HTTP rather than importing their SDKs at runtime. A search asks Exa and Tavily at the same time and fuses their rankings: a page both rank highly comes first, duplicates (www, tracking parameters, trailing slashes) collapse into one, and no site takes more than two places while others are waiting. Each hit carries the passages that matched the query and, when known, its publish date, so most questions are answered from search results alone; news-style queries ask Tavily for the past week's reporting. Firecrawl is the fallback when both indexes fail.

Reading pages runs up to four at a time with a 15-second network timeout. Exa answers first (with a live crawl when it has no cached copy), then Tavily, Firecrawl, and finally a direct read of the page that only ever reaches public addresses, including across redirects. A page longer than 10,000 characters keeps its opening plus the paragraphs that share the most words with the search that found it, in page order, instead of whatever happened to come first. Downloads are capped at 512 KiB (1 MiB for a direct read) before parsing.

The research method itself (size the effort to the question, search wide in one step, answer from passages before opening pages, prefer primary and recent sources, cross-check what matters, lead with the answer and cite beside each claim) is part of the web app's system prompt, so it is sent once per request rather than on every research message in the history.

Context limits come from `web/shared/context-policy.json`, which the Docker image also copies into Hermes's bootstrap. The shared baseline is 128,000 tokens; OpenRouter retains its 200,000-token route window and native Gemini resolves its own model window. Compression starts at the lower of 85% of the active model's usable input window and 108,800 tokens, with Hermes reserving any configured output allowance. Fallback switches recalculate that threshold for the active model. This replaces the earlier 64,000-token cap.

Vaelo keeps up to 300,000 characters and 240 messages of recent conversation, preserves earlier replies up to 160,000 characters, and shares a 360,000-character request budget with selected workspace documents. A fresh workspace can send its full 300,000 characters of saved files plus its brief and notes. Long chats leave less room for those files; omitted sections are marked. Character budgets are approximate, not exact token counts: model instructions, tool schemas, images and tool results also use context, and Hermes can compress sooner when the active provider needs it. Four images are resized to fit the API's 4 MB body limit with text. These limits affect what is sent to the model, not the full saved conversation or workspace.

The cloud profile keeps at most one cached agent, uses a 320 MB cache-pressure threshold, and limits allocator arenas. These bounds reduce memory pressure; a real Render workload is still needed to establish peak usage. A stream that ends without an answer and a completion marker is reported as interrupted. The relay's `/health` response headers report the deployed baseline and compression cap.

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
