// Regression for private/missing/untyped senders creating an unreachable pending.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { root, testContext } from "./test-context.mjs";
const { db } = await testContext();
const base = "http://192.168.0.200:4156/api/v1";
const tokens = {}, cards = {};
const report = { base, revision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), started_at: new Date().toISOString(), checks: [], assertions: [] };
function ok(label, test) { assert.ok(test, label); report.assertions.push(label); }
async function call(actor, method, path, body, expected) {
  const r = await fetch(base + path, { method, headers: { ...(tokens[actor] ? { "X-Guest-Token": tokens[actor] } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const raw = await r.text(), data = raw ? JSON.parse(raw) : null;
  assert.equal(r.status, expected, actor + " " + method + " " + path);
  assert.equal(r.headers.get("cache-control"), "no-store");
  report.checks.push({ evidence_id: "S" + String(report.checks.length + 1).padStart(3, "0"), actor, method, path, ...(body === undefined ? {} : { request: body }), status: r.status, response: path === "/auth/guest" ? { guest_token: "[omitted]", expires_at: data.expires_at } : data });
  return data;
}
const list = () => call("receiver", "GET", "/card-exchanges", undefined, 200);
try {
  tokens.receiver = (await call("none", "POST", "/auth/guest", undefined, 201)).guest_token;
  cards.receiver = await call("receiver", "PUT", "/cards/me", { type_code: "INFP", discoverable: true }, 200);
  for (const actor of ["no_card", "empty_type", "typed_private"]) {
    tokens[actor] = (await call("none", "POST", "/auth/guest", undefined, 201)).guest_token;
    // no_card deliberately performs no cards/me read before requesting an exchange.
    if (actor === "empty_type") {
      const card = await call(actor, "GET", "/cards/me", undefined, 200);
      ok("empty type fixture stays private", card.type_code === "" && !card.discoverable);
    }
    if (actor === "typed_private") {
      const card = await call(actor, "PUT", "/cards/me", { type_code: "ESTJ" }, 200);
      ok("typed private fixture has no opt-in", card.type_code === "ESTJ" && !card.discoverable);
    }
    const before = await list();
    const denied = await call(actor, "POST", "/card-exchanges", { buddy_id: cards.receiver.id }, 404);
    ok("uniform visibility rejection " + actor, denied.code === "NOT_FOUND");
    const after = await list();
    ok("no unreachable pending inserted " + actor, JSON.stringify(before.items) === JSON.stringify(after.items));
    cards[actor] = await call(actor, "PUT", "/cards/me", { type_code: "ESTJ", discoverable: true }, 200);
    const created = await call(actor, "POST", "/card-exchanges", { buddy_id: cards.receiver.id }, 201);
    const retry = await call(actor, "POST", "/card-exchanges", { buddy_id: cards.receiver.id }, 200);
    ok("explicitly published retry reuses pending " + actor, created.id === retry.id);
    const incoming = (await list()).items.find(item => item.id === created.id);
    ok("receiver sees published sender " + actor, incoming?.direction === "incoming" && incoming.buddy_id === cards[actor].id);
    const accepted = await call("receiver", "POST", `/card-exchanges/${created.id}/respond`, { action: "accept" }, 200);
    ok("receiver can accept " + actor, accepted.status === "accepted");
    await call(actor, "DELETE", `/card-exchanges/${created.id}`, undefined, 204);
    // Retry visibility is checked before an existing active relation can be returned, too.
    const next = await call(actor, "POST", "/card-exchanges", { buddy_id: cards.receiver.id }, 201);
    await call(actor, "PUT", "/cards/me", { discoverable: false }, 200);
    await call(actor, "POST", "/card-exchanges", { buddy_id: cards.receiver.id }, 404);
    ok("opt-out hides incoming pending " + actor, !(await list()).items.some(item => item.id === next.id));
    await call(actor, "PUT", "/cards/me", { discoverable: true }, 200);
    const resumed = await call(actor, "POST", "/card-exchanges", { buddy_id: cards.receiver.id }, 200);
    ok("republish reuses same pending " + actor, resumed.id === next.id);
    await call(actor, "DELETE", `/card-exchanges/${next.id}`, undefined, 204);
  }
  report.outcome = "passed"; report.finished_at = new Date().toISOString();
  console.log(`PASS F4 sender visibility: ${report.checks.length} real HTTP responses, ${report.assertions.length} assertions; missing card / empty type / typed private all 404 with no new pending; explicit opt-in receiver list/respond and same-ID retries pass`);
} catch (error) { report.outcome = "failed"; report.error = error.message; throw error; }
finally {
  const dir = resolve(root, ".artifacts"); mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(dir, "mbti-f4-sender-visibility-evidence.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  await db.end();
}
