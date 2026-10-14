# Production runtime settings

The Vercel project's production feedback toolbar is disabled
(`enableProductionFeedback: false`). This is a project setting, not a
`vercel.json` option. Keep it disabled when recreating the project so injected
feedback scripts do not conflict with the strict Content Security Policy.

Chat requests wait up to two minutes for the Render backend's health endpoint
before submitting the prompt. Readiness checks use GET requests only, wake the
public root once if necessary, and stop when the browser cancels. A chat POST
is never retried automatically.
