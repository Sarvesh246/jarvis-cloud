import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Run the real hook with a small hook lifecycle and browser history fixture.
function fixture(hash = "", enabled = true) {
  let open, previous, cleanup, pending;
  const listeners = new Map();
  const calls = [];
  const location = { hash, pathname: "/chat", search: "?source=saved" };
  const history = {
    state: { existing: "preserved" },
    pushState(state, _, url) { this.state = state; location.hash = url; calls.push("push"); },
    replaceState(state, _, url) { this.state = state; location.hash = ""; calls.push(url); },
    back() { calls.push("back"); },
  };
  const source = readFileSync(new URL("../src/lib/use-settings-page.js", import.meta.url), "utf8")
    .replace(/^import .*?;\r?\n/, "")
    .replace("export function", "function");
  const useSettingsPage = runInNewContext(`${source}\nuseSettingsPage`, {
    location, history,
    useState(initial) {
      if (open === undefined) open = initial();
      return [open, (value) => { open = value; }];
    },
    useCallback: (fn) => fn,
    useEffect(effect, [next]) {
      if (previous !== next) { cleanup?.(); pending = effect; previous = next; }
    },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  });
  function render(next = enabled) {
    enabled = next;
    const [, navigate] = useSettingsPage(enabled);
    if (pending) { const effect = pending; pending = undefined; cleanup = effect(); }
    return navigate;
  }
  return {
    render, location, history, calls, listeners,
    get open() { return open; },
    event(type, hash) { location.hash = hash; listeners.get(type)?.(); },
    unmount() { cleanup?.(); },
  };
}

test("desktop adopts a Settings deep link when enabled after phone layout", () => {
  const page = fixture("#settings", false);
  page.render();
  assert.equal(page.open, false);
  page.render(true);
  assert.equal(page.open, true);
  assert.deepEqual(page.calls, [], "layout changes do not add history entries");
});

test("locally opened phone Settings remains open when widened", () => {
  const page = fixture("", false);
  page.render()(true);
  page.render(true);
  assert.equal(page.open, true);
  assert.deepEqual(page.calls, []);
});

test("desktop open deduplicates history and Back/Forward tracks the URL", () => {
  const page = fixture();
  const navigate = page.render();
  navigate(true);
  navigate(true);
  assert.equal(page.open, true);
  assert.deepEqual(page.calls, ["push"]);
  assert.equal(page.history.state.existing, "preserved");
  page.event("popstate", "");
  assert.equal(page.open, false);
  page.event("popstate", "#settings");
  assert.equal(page.open, true);
  navigate(false);
  assert.equal(page.open, false);
  assert.deepEqual(page.calls, ["push", "back"]);
});

test("closing a direct Settings link retains path, query and history state", () => {
  const page = fixture("#settings");
  page.render()(false);
  assert.equal(page.open, false);
  assert.deepEqual(page.calls, ["/chat?source=saved"]);
  assert.equal(page.history.state.existing, "preserved");
});

test("hash changes synchronize on desktop and listeners are cleaned up", () => {
  const page = fixture();
  page.render();
  page.event("hashchange", "#settings");
  assert.equal(page.open, true);
  page.render(false);
  assert.equal(page.listeners.size, 0);
  page.event("hashchange", "");
  assert.equal(page.open, true, "phone Settings uses local navigation");
  page.render(true);
  page.unmount();
  assert.equal(page.listeners.size, 0);
});

test("closing a desktop deep link on phone clears the URL before widening", () => {
  const page = fixture("#settings");
  page.render();
  page.render(false)(false);
  assert.equal(page.open, false);
  assert.equal(page.location.hash, "");
  assert.deepEqual(page.calls, ["/chat?source=saved"]);
  assert.equal(page.history.state.existing, "preserved");
  page.render(true);
  assert.equal(page.open, false, "closed Settings must not reopen on desktop");
});

test("phone close consumes the desktop Settings history entry", () => {
  const page = fixture();
  page.render()(true);
  page.render(false)(false);
  assert.equal(page.open, false);
  assert.deepEqual(page.calls, ["push", "back"]);
  // The browser completes back() asynchronously while desktop listeners are off.
  page.event("popstate", "");
  page.render(true);
  assert.equal(page.open, false);
  page.event("popstate", "#settings");
  assert.equal(page.open, true, "Forward still restores desktop Settings");
});

test("ordinary phone open and close leave unrelated history untouched", () => {
  const page = fixture("#conversation", false);
  page.render()(true);
  assert.equal(page.open, true);
  page.render()(false);
  assert.equal(page.open, false);
  assert.equal(page.location.hash, "#conversation");
  assert.deepEqual(page.calls, []);
});
