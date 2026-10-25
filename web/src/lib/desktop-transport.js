export const CLOUD_ORIGIN = "https://vaelochat.vercel.app";

const aborted = () => new DOMException("The request was aborted.", "AbortError");

// Credential IPC and body preparation precede native HTTP's cancellation support.
// Stop must settle here too, even if an underlying operation cannot be cancelled.
// Both outcomes stay observed after abort, and every listener is removed.
function prepare(signal, operation) {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const finish = (settle, value) => {
      signal.removeEventListener("abort", cancel);
      settle(value);
    };
    const cancel = () => finish(reject, aborted());
    signal.addEventListener("abort", cancel, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw aborted();
      return operation();
    }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

export function createDesktopFetch({ nativeFetch, browserFetch, loadToken, clearToken }) {
  return async (input, init = {}) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!path.startsWith("/api/")) return browserFetch(input, init);
    const url = new URL(path, CLOUD_ORIGIN);
    if (url.origin !== CLOUD_ORIGIN || !url.pathname.startsWith("/api/"))
      throw new TypeError("Invalid Vaelo API path.");
    const request = new Request(url, init);
    const token = await prepare(request.signal, loadToken);
    const headers = new Headers(request.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let response;
    try {
      const body = ["GET", "HEAD"].includes(request.method) ? undefined
        : await prepare(request.signal, () => request.arrayBuffer());
      if (request.signal.aborted) throw aborted();
      response = await nativeFetch(request.url, {
        method: request.method, headers, signal: request.signal,
        body,
        connectTimeout: 30_000, maxRedirections: 0,
      });
    } catch {
      if (request.signal.aborted) throw aborted();
      throw new TypeError("Could not reach Vaelo. Check your internet connection.");
    }
    if (response.status === 401) await clearToken(token);
    return response;
  };
}
