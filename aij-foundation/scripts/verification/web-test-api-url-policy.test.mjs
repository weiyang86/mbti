import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiConsumerUrl } from "../../apps/web/next.config.mjs";

test("same-origin API consumer override is test-only and cannot name an external origin", () => {
  const development = { environment: "development", apiUrl: "http://localhost:3656/api" };
  const test = { environment: "test", apiUrl: "http://localhost:3656/api" };
  assert.equal(resolveApiConsumerUrl(development), development.apiUrl);
  assert.equal(resolveApiConsumerUrl(test), test.apiUrl);
  assert.equal(resolveApiConsumerUrl(test, "/api"), "/api");
  for (const value of ["http://127.0.0.1:60606/api", "https://example.invalid/api", "//example.invalid/api", ""])
    assert.throws(() => resolveApiConsumerUrl(test, value));
  assert.throws(() => resolveApiConsumerUrl(development, "/api"));
  assert.throws(() => resolveApiConsumerUrl({ environment: "production", apiUrl: development.apiUrl }, "/api"));
});
