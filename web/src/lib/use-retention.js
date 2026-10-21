import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validRetention } from "../../shared/retention.js";

const validPolicy = value => value && validRetention(value.days) && Number.isFinite(value.now) && value.now >= 0;

/* Deletion authority belongs to one signed-in lifetime. Until that account's
   policy arrives, keep everything. A saved choice supersedes an older read. */
export function useRetention(owner, request) {
  const send = useRef(request);
  send.current = request;
  const scope = useMemo(() => ({ owner, active: false, sequence: 0 }), [owner]);
  const [policy, setPolicy] = useState(null);
  const apply = useCallback((days, now) => {
    if (!scope.active || !scope.owner || !validRetention(days) || !Number.isFinite(now) || now < 0) return false;
    const sequence = ++scope.sequence;
    setPolicy({ scope, sequence, days, skew: now - Date.now() });
    return true;
  }, [scope]);

  useEffect(() => {
    scope.active = true;
    const sequence = ++scope.sequence;
    if (owner) {
      // StrictMode replays setup: a policy from the preceding lifetime cannot
      // authorize deletion while its replacement read is pending.
      setPolicy(null);
      send.current("/api/chats?resource=retention")
        .then(result => {
          if (scope.active && scope.sequence === sequence) apply(result?.days, result?.now);
        })
        .catch(() => {});
    }
    return () => { scope.active = false; ++scope.sequence; };
  }, [scope, owner, apply]);

  const authorized = () => Boolean(policy?.scope === scope && scope.active && owner && policy.sequence === scope.sequence);
  const current = authorized();
  return { days: current ? policy.days : 0, skew: current ? policy.skew : 0, update: apply, authorized };
}

/* The account-keyed History panel admits one save at a time. In particular,
   an old GET cannot visually undo a saved Forever choice. */
export function useRetentionSettings(request, onRetention) {
  const send = useRef(request);
  send.current = request;
  const lifetime = useRef(null);
  const [state, setState] = useState({ status: "loading", data: null, error: "", problem: "", busy: false });
  const load = useCallback(async () => {
    const scope = lifetime.current;
    if (!scope?.active || scope.saving) return false;
    const sequence = ++scope.sequence;
    try {
      const data = await send.current("/api/chats?resource=retention");
      if (!validPolicy(data)) throw new Error("History settings are unavailable right now.");
      if (!scope.active || sequence !== scope.sequence) return false;
      setState(last => ({ ...last, status: "ready", data, error: "" }));
      return true;
    } catch (error) {
      if (scope.active && sequence === scope.sequence) setState(last => ({ ...last, status: "failed", error: error.message }));
      return false;
    }
  }, []);
  useEffect(() => {
    const scope = { active: true, saving: false, sequence: 0 };
    lifetime.current = scope;
    load();
    return () => { scope.active = false; };
  }, [load]);

  const run = async body => {
    const scope = lifetime.current;
    if (!scope?.active || scope.saving) return false;
    scope.saving = true;
    ++scope.sequence;
    setState(last => ({ ...last, busy: true, problem: "" }));
    try {
      const data = await send.current("/api/chats?resource=retention", body);
      if (!validPolicy(data)) throw new Error("History settings are unavailable right now.");
      if (!scope.active) return false;
      setState({ status: "ready", data, error: "", problem: "", busy: false });
      onRetention?.(data.days, data.now);
      return true;
    } catch (error) {
      if (scope.active) setState(last => ({ ...last, problem: error.message }));
      return false;
    } finally {
      scope.saving = false;
      if (scope.active) setState(last => ({ ...last, busy: false }));
    }
  };
  return { ...state, load, run };
}
