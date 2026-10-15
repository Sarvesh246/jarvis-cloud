import policy from './context-policy.json' with { type: 'json' };

// Used by the browser and API. The cloud image copies this same JSON for Hermes.
export const CONTEXT_POLICY = Object.freeze(policy);
