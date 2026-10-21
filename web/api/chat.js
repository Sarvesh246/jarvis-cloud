import {
  settings,
  authorizeAny,
  sameOrigin,
  readJson,
  fail,
  HttpError,
} from "../server/security.js";
import { LIMITS, chatInput, guestInput, resumeInput, streamChat } from "../server/chat.js";
import { withSelectedWork } from "../server/work-context.js";
import { withMemory } from "../server/memory.js";
import { requestTrace } from "../shared/request-trace.js";

/* POST starts a reply and follows it; GET picks a reply back up after the
   last event the page saw. Either way the reply itself runs on the relay. */
export default async function handler(req, res) {
  const trace = requestTrace(undefined, "api", { report: record => {
    if (process.env.VERCEL) console.info(JSON.stringify(record));
  }});
  let outcome = "error";
  try {
    if (req.method !== "POST" && req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const cfg = settings();
    const user = await trace.span("authorize", () => authorizeAny(req, cfg));
    let input;
    if (req.method === "GET") {
      const query = Object.fromEntries(new URL(req.url, "http://local").searchParams);
      input = resumeInput(query);
      trace.identify(input.runId);
    } else {
      sameOrigin(req, cfg);
      input = chatInput(await readJson(req, LIMITS.body), { guest: Boolean(user.guest) });
      trace.identify(input.runId);
      if (user.guest) input = guestInput(input);
      else {
        input = await trace.span("work", () => withSelectedWork(input, user));
        input = await trace.span("memory", () => withMemory(input, user));
      }
    }
    await streamChat(req, res, cfg, user, input);
    outcome = "follow_finished";
  } catch (error) {
    if (!res.headersSent) fail(res, error);
    else res.end();
  } finally {
    trace.finish(outcome);
  }
}
