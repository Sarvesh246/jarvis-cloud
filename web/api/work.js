import { WorkStore, MAX_WORK_BYTES } from "../server/work-store.js";
import { settings, authorize, sameOrigin, readJson, json, fail, HttpError } from "../server/security.js";

// Dependency injection replaces storage/engine only; authentication and CSRF always execute.
export function createWorkHandler({ storeFactory = sub => new WorkStore(sub, undefined, {
  engine: async (id, input, options) => {
    const { runWorkCapability } = await import("../server/native-verification.js");
    return runWorkCapability(id, input, { ...options, sub });
  },
}), configuration = settings,
  configured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN) } = {}) {
  return async function handler(req, res) {
    try {
      const cfg = configuration();
      const user = await authorize(req, cfg);
      if (req.method !== "GET" && req.method !== "POST") throw new HttpError(405, "Method not allowed.");
      if (req.method === "POST") sameOrigin(req, cfg);
      if (!configured()) throw new HttpError(503, "Work storage is not configured.");
      const store = storeFactory(user.sub);
      if (req.method === "GET") {
        const url = new URL(req.url, cfg.origin);
        json(res, 200, url.searchParams.has("id") ? { record: await store.record(url.searchParams.get("id")) } : { records: await store.list() });
        return;
      }
      const body = await readJson(req, MAX_WORK_BYTES);
      if (body?.action === "save") json(res, 200, { record: await store.save(body.record, body.base ?? null) });
      else if (body?.action === "run") json(res, 200, { record: await store.run(body.id, body.base) });
      else if (body?.action === "delete") json(res, 200, { record: await store.delete(body.id, body.base) });
      else if (body?.action === "import") json(res, 200, { records: await store.import(body.records) });
      else throw new HttpError(400, "Invalid work request.");
    } catch (error) { fail(res, error); }
  };
}

export default createWorkHandler();
