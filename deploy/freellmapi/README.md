# Vaelo model router

FreeLLMAPI v0.14.2 hosted as an API-only Vercel function in a separate project.
It uses no Render instance hours and shares no process memory with Hermes.
Only authenticated health, model-list and chat-completion endpoints are exposed.
The dashboard and administrative APIs are unavailable.

Builds download the pinned upstream source and compile its server. Provider keys,
model selections and the separate cloud API key come from the secret variables
in the local `freellmapi-cloud.env` file. Never commit that file. Base64 is only
the configuration's transport format, not encryption.

Cold functions rebuild their temporary SQLite database from that configuration.
Cooldowns and usage counters are local to a warm function; provider-enforced
quotas still apply globally. This is a routing endpoint, not a durable dashboard.
No background catalog polling or health-check scheduler runs in the function.

The cloud chain selects configured free tool models with a known window of at
least 128,000 tokens. PC-only custom endpoints and paid models are excluded.
Keep OpenRouter, NVIDIA and Gemini as direct Hermes fallbacks.

Validation: `npm test`. Deploy this directory as its own Vercel project.
