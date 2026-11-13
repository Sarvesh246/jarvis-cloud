export function relayHeaders(cfg, user) {
  return {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
    "X-Hermes-Session-Key": `web:${user.sub}`,
  };
}

export function base(cfg) {
  return cfg.backend.replace(/\/$/, "");
}
