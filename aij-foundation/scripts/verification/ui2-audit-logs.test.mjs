import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { browserSession, call, queryFor, origin } from "./ui2-support.mjs";
import { prepareUi1, stopUi1 } from "./ui1-manual.mjs";

const redacted = "[REDACTED]";
const safeFields = ["action", "afterData", "beforeData", "createdAt", "errorMessage", "id", "ip", "method", "module", "path", "redacted", "requestSummary", "resourceId", "resourceType", "status", "userAgent", "userId", "userName"];

function assertSafe(row, canary) {
  assert.deepEqual(Object.keys(row).sort(), safeFields);
  assert.equal(row.redacted, true);
  assert.ok(!JSON.stringify(row).includes(canary), "The synthetic password marker must not appear in list/detail output");
  assert.equal(row.requestSummary?.correlationId, redacted);
  assert.ok(row.beforeData === null || row.beforeData === redacted);
  assert.ok(row.afterData === null || row.afterData === redacted);
  assert.ok(row.userName === null || row.userName === redacted);
  assert.ok(row.ip === null || row.ip === redacted);
  assert.ok(row.userAgent === null || row.userAgent === redacted);
}

test("AF-038 audit page filters real audit rows and only renders the server redacted projection", { timeout: 180000 }, async t => {
  let state;
  try {
    state = await prepareUi1("AF-038");
    const auditor = await browserSession(state, "ui2-audit-manager");
    const reader = await browserSession(state, "ui2-reader");
    const empty = await browserSession(state, "ui2-empty");
    const suffix = randomBytes(6).toString("hex");
    const correlationId = "af038-" + suffix;
    const canary = "AF038_SYNTHETIC_PASSWORD_MARKER_" + suffix;

    await t.test("actual route/menu are scoped and the API independently denies unauthorized readers", async () => {
      const response = await fetch(origin + "/auth/audit-logs", { headers: { cookie: auditor.cookie }, signal: AbortSignal.timeout(8000) });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      const flatten = nodes => nodes.flatMap(node => [...(node.path ? [node.path] : []), ...flatten(node.children)]);
      assert.ok(flatten(await call(auditor, "/admin/menus/my")).includes("/auth/audit-logs"));
      assert.ok(!flatten(await call(reader, "/admin/menus/my")).includes("/auth/audit-logs"));
      assert.deepEqual(await call(empty, "/admin/menus/my"), []);
      await call(null, "/admin/logs", 401);
      await call(reader, "/admin/logs", 403);
    });

    await t.test("the real login endpoint writes synthetic audit rows and pagination/filtering read them safely", async () => {
      for (let i = 0; i < 2; i++) {
        const response = await fetch("http://127.0.0.1:3656/api/auth/login", {
          method: "POST",
          headers: { origin, "content-type": "application/json", "x-correlation-id": correlationId },
          body: JSON.stringify({ username: `af038-missing-${suffix}-${i}`, password: canary + i }),
          signal: AbortSignal.timeout(8000)
        });
        assert.equal(response.status, 401);
        assert.ok(!(await response.text()).includes(canary));
      }

      const persisted = await queryFor(state)(client => client.query("SELECT count(*)::int AS count FROM public.audit_log WHERE module='auth' AND action='login_failed' AND request_summary->>'correlationId'=$1", [correlationId]));
      assert.equal(persisted.rows[0].count, 2, "The source HTTP actions must persist two audit rows in AF-038's isolated database");

      const params = new URLSearchParams({ module: "auth", action: "login_failed", status: "failed", correlationId, pageSize: "1" });
      const first = await call(auditor, "/admin/logs?" + params + "&page=1");
      const second = await call(auditor, "/admin/logs?" + params + "&page=2");
      assert.equal(first.total, 2); assert.equal(second.total, 2);
      assert.equal(first.items.length, 1); assert.equal(second.items.length, 1);
      assert.notEqual(first.items[0].id, second.items[0].id);
      for (const row of [...first.items, ...second.items]) {
        assertSafe(row, canary); assert.equal(row.module, "auth"); assert.equal(row.action, "login_failed");
        assert.equal(row.status, "failed"); assert.equal(row.path, "/api/auth/login");
        assert.equal(row.errorMessage, "invalid_credentials");
      }
      await call(reader, "/admin/logs/" + first.items[0].id, 403);
      const outsideRange = await call(auditor, "/admin/logs?" + new URLSearchParams({ module: "auth", action: "login_failed", status: "failed", correlationId: "af038-no-such-correlation", pageSize: "20" }));
      assert.equal(outsideRange.total, 0); assert.deepEqual(outsideRange.items, []);
      await call(auditor, "/admin/logs?" + params + "&page=1&workspaceId=client-controlled", 400);
    });

    await t.test("detail returns the same safe projection and never exposes request snapshots or identity", async () => {
      const params = new URLSearchParams({ module: "auth", action: "login_failed", status: "failed", correlationId, pageSize: "1", page: "1" });
      const list = await call(auditor, "/admin/logs?" + params);
      const detail = await call(auditor, "/admin/logs/" + list.items[0].id);
      assertSafe(detail, canary);
      assert.equal(detail.module, "auth"); assert.equal(detail.action, "login_failed");
      assert.equal(detail.userName, null); assert.equal(detail.redacted, true);
      assert.ok(!JSON.stringify(detail).includes(canary));
    });
  } finally {
    if (state) await stopUi1("AF-038");
  }
});
