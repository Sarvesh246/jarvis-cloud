import { useCallback, useEffect, useRef, useState } from "react";

const PATH = "/api/chats?resource=memory";
const initial = () => ({ status: "loading", data: null, error: "", problem: "", busy: false });

/* One Memory panel owns its reads and saves. A save invalidates older reads,
   and an unmounted panel cannot complete an action in a later panel. */
export function useMemory(request) {
  const send = useRef(request);
  send.current = request;
  const lifetime = useRef(null);
  const [state, setState] = useState(initial);

  const load = useCallback(async () => {
    const owner = lifetime.current;
    if (!owner?.active || owner.saving) return false;
    const sequence = ++owner.sequence;
    const current = () => owner.active && owner.sequence === sequence;
    try {
      const data = await send.current(PATH);
      if (!current()) return false;
      setState({ ...initial(), status: "ready", data });
      return true;
    } catch (error) {
      if (current()) setState(last => ({ ...last, status: "failed", error: error.message }));
      return false;
    }
  }, []);

  useEffect(() => {
    const owner = { active: true, saving: false, sequence: 0 };
    lifetime.current = owner;
    load();
    return () => { owner.active = false; };
  }, [load]);

  const run = useCallback(async body => {
    const owner = lifetime.current;
    if (!owner?.active || owner.saving) return false;
    owner.saving = true;
    ++owner.sequence;
    setState(last => ({ ...last, busy: true, problem: "" }));
    try {
      const data = await send.current(PATH, body);
      if (!owner.active) return false;
      setState({ ...initial(), status: "ready", data });
      return true;
    } catch (error) {
      if (owner.active) setState(last => ({ ...last, problem: error.message }));
      return false;
    } finally {
      owner.saving = false;
      if (owner.active) setState(last => ({ ...last, busy: false }));
    }
  }, []);

  return { ...state, load, run };
}
