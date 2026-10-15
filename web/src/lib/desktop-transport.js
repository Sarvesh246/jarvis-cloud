export const CLOUD_ORIGIN = "https://vaelochat.vercel.app";

export function createDesktopFetch({ nativeFetch, browserFetch, loadToken, clearToken }) {
  return async (input, init = {}) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!path.startsWith("/api/")) return browserFetch(input, init);
    const url = new URL(path, CLOUD_ORIGIN);
    if (url.origin !== CLOUD_ORIGIN || !url.pathname.startsWith("/api/"))
      throw new TypeError("Invalid Vaelo API path.");
    const request = new Request(url, init);
    const token = await loadToken();
    const headers = new Headers(request.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let response;
    try { response = await nativeFetch(request.url, {
      method: request.method, headers, signal: request.signal,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      connectTimeout: 30_000, maxRedirections: 0,
    }); } catch {
      if (request.signal.aborted) throw new DOMException("The request was aborted.", "AbortError");
      throw new TypeError("Could not reach Vaelo. Check your internet connection.");
    }
    if (response.status === 401) await clearToken(token);
    return response;
  };
}
