/* Not every failure is the same failure. Each kind gets its own plain
   sentence and its own way forward, said in the reply where it happened. */

export function classifyError({ name = "", message = "", status = 0, partial = false, code = "" } = {}) {
  const text = String(message || "");
  if (code === "repetitive_output")
    return { kind: "unknown", text: text || "The model kept repeating itself. Retry for a fresh answer." };
  if (code === "invalid_output")
    return { kind: "unknown", text: text || "The model could not produce an answer. Retry for a fresh answer." };
  if (name === "TypeError" && /fetch|network|load failed/i.test(text))
    return {
      kind: "offline",
      text: "Vaelo couldn’t be reached. Check your connection, then try again.",
    };
  if (status === 401 || /sign in to use|refresh the page/i.test(text))
    return { kind: "auth", text: "Your sign-in has expired. Sign in again to carry on." };
  if (status === 413 || /context limit|too large/i.test(text))
    return {
      kind: "limit",
      text: "This conversation has grown past what Vaelo can hold at once.",
    };
  if (status === 429 || /busy|limit was reached|temporarily unavailable/i.test(text))
    return { kind: "busy", text: text || "Vaelo is busy right now. Try again in a moment." };
  if (partial)
    return {
      kind: "interrupted",
      text: "The connection dropped partway through. What arrived is kept.",
    };
  return { kind: "unknown", text: text || "Vaelo couldn’t finish this reply." };
}
