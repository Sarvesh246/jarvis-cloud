import test from "node:test";
import assert from "node:assert/strict";
import { validateUsage, UsageStore } from "../server/usage-store.js";
import { usageAuthorized } from "../server/usage-api.js";

const event = { id: "test-event-123", route: "hermes", reported: true,
  input: 100, output: 30, cached: 50, at: "2026-10-01T12:00:00Z" };

test("usage accepts only bounded counters and no invented usage", () => {
  assert.equal(validateUsage(event).input, 100);
  for (const patch of [{ input: -1 }, { input: 1.5 }, { reported: false },
    { id: "../secret" }, { route: "https://provider" }, { at: "invalid" }, { input: Infinity }])
    assert.throws(() => validateUsage({ ...event, ...patch }));
  assert.equal(validateUsage({ ...event, reported: false, input: 0, output: 0, cached: 0 }).reported, false);
});

test("usage credentials fail closed and reader cannot use a writer credential", () => {
  assert.equal(usageAuthorized(undefined, "a".repeat(40)), false);
  assert.equal(usageAuthorized("Bearer x", ""), false);
  assert.equal(usageAuthorized("Bearer " + "a".repeat(40), "a".repeat(40)), true);
  assert.equal(usageAuthorized("Bearer " + "a".repeat(40), "b".repeat(40)), false);
});

test("summary excludes cached tokens from total and preserves unknown attempts", async () => {
  const sql = { query: async query => {
    if (query.startsWith("SELECT route")) return [{ route: "hermes", attempts: 2, unreported: 1,
      input: "100", output: "30", cached: "50", latest: event.at }];
    if (query.startsWith("SELECT min")) return [{ since: event.at }];
    return [];
  } };
  const store = new UsageStore(sql);
  const result = await store.summary("2026-10");
  assert.equal(result.total, 130);
  assert.equal(result.unreported, 1);
  await assert.rejects(store.summary("2026-13"));
});
