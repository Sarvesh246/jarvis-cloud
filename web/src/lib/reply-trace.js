import { requestTrace } from "../../shared/request-trace.js";

export function replyTrace(run) {
  return requestTrace(run, "browser", { report: record => {
    // Explicitly opt in; no saved prompts, telemetry endpoint or account data.
    if (new URLSearchParams(location.search).get("diagnostics") === "1")
      console.info(JSON.stringify(record));
  }});
}
