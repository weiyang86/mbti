import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { correlateRequest as esmCorrelate, resolveCorrelationId as esmResolve } from "../../packages/core/dist/index.mjs";

const require = createRequire(import.meta.url);
const cjs = require("../../packages/core/dist/index.cjs");

test("core correlation policy validates scalar and array request headers", () => {
  assert.equal(esmResolve("valid-id_123"), "valid-id_123");
  assert.equal(esmResolve(["first-valid", "ignored"]), "first-valid");
  for (const invalid of [undefined, null, 42, {}, "short", "contains space", "a".repeat(129)]) {
    assert.match(esmResolve(invalid), /^[0-9a-f-]{36}$/);
  }
});

test("core request correlation mutates the host request and returns the exact response header value", () => {
  const request = { headers: { "x-correlation-id": "host-request-123" } };
  const headers = new Map();
  const result = esmCorrelate(request, { setHeader: (name, value) => headers.set(name, value) });
  assert.equal(result, "host-request-123");
  assert.equal(request.correlationId, result);
  assert.equal(headers.get("x-correlation-id"), result);
});

test("the CommonJS package export provides the same owner behavior as ESM", () => {
  const id = randomUUID();
  assert.equal(cjs.resolveCorrelationId(id), id);
  const request = { headers: {}, correlationId: id };
  const headers = new Map();
  assert.equal(cjs.correlateRequest(request, { setHeader: (name, value) => headers.set(name, value) }), id);
  assert.equal(headers.get("x-correlation-id"), id);
  assert.equal(typeof cjs.resolveCorrelationId, typeof esmResolve);
});
