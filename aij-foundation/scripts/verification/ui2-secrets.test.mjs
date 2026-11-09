import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prepareUi1, stopUi1 } from "./ui1-manual.mjs";
import { browserSession, call, queryFor, origin } from "./ui2-support.mjs";

const safeFields = ["configured", "id", "provider", "ref", "status", "updatedAt"];

test("AF-037 SecretRef page manages references without exposing values", { timeout: 180000 }, async t => {
  let state;
  try {
    state = await prepareUi1("AF-037");
    const manager = await browserSession(state, "ui2-secret-manager");
    const reader = await browserSession(state, "ui2-reader"), empty = await browserSession(state, "ui2-empty");
    const suffix = randomBytes(5).toString("hex").toUpperCase();
    const firstRef = `local://aij-foundation/test/AF037_${suffix}`;
    const nextRef = `local://aij-foundation/test/AF037_NEXT_${suffix}`;

    async function raw(session, path, method = "GET", body) {
      const response = await fetch("http://127.0.0.1:3656/api" + path, { method, headers: { origin, "x-correlation-id": "af037-secrets", ...(session ? { cookie: session.cookie, "x-aij-csrf": session.csrf } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
      return { status: response.status, text: await response.text() };
    }
    function assertSafe(item) {
      assert.deepEqual(Object.keys(item).sort(), safeFields);
      assert.equal(typeof item.configured, "boolean");
      assert.ok(!JSON.stringify(item).match(/secretValue|passwordHash|accessToken|privateKey|secretHash/i));
    }

    await t.test("real route and server menu are permission-filtered; API remains authoritative", async () => {
      const page = await fetch(origin + "/auth/secrets", { headers: { cookie: manager.cookie }, signal: AbortSignal.timeout(8000) });
      assert.equal(page.status, 200); assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      const html = await page.text();
      // This route is a client component: the server returns the authenticated app shell,
      // while the page heading and table appear after browser hydration.
      assert.match(html, /class="admin-frame"/);
      assert.match(html, /src="\/_next\/static\/chunks\/app\/auth\/secrets\/page-[^"]+\.js"/);
      const flatten = nodes => nodes.flatMap(node => [...(node.path ? [node.path] : []), ...flatten(node.children)]);
      assert.ok(flatten(await call(manager, "/admin/menus/my")).includes("/auth/secrets"));
      assert.ok(!flatten(await call(reader, "/admin/menus/my")).includes("/auth/secrets"));
      assert.deepEqual(await call(empty, "/admin/menus/my"), []);
      await call(null, "/admin/secret-references", 401);
      await call(reader, "/admin/secret-references", 403);
      await call(reader, "/admin/secret-references", 403, "POST", { ref: firstRef });
      await call(empty, "/admin/secret-references", 403);
    });

    await t.test("create, detail and list expose only safe metadata; values are never accepted or echoed", async () => {
      const created = await call(manager, "/admin/secret-references", 201, "POST", { ref: firstRef });
      assertSafe(created); assert.equal(created.ref, firstRef); assert.equal(created.status, "active"); assert.equal(created.configured, false);
      const detail = await call(manager, "/admin/secret-references/" + created.id); assertSafe(detail); assert.deepEqual(detail, created);
      const list = await call(manager, "/admin/secret-references?q=" + encodeURIComponent("AF037_" + suffix));
      assert.equal(list.total, 1); assertSafe(list.items[0]); assert.deepEqual(list.items[0], created);
      await call(manager, "/admin/secret-references", 409, "POST", { ref: firstRef });
      const canary = "AF037_SYNTHETIC_FORBIDDEN_VALUE_" + suffix;
      const rejected = await raw(manager, "/admin/secret-references", "POST", { ref: nextRef, secretValue: canary });
      assert.equal(rejected.status, 400); assert.ok(!rejected.text.includes(canary));
      const apiState = JSON.parse(readFileSync(state.apiState, "utf8"));
      assert.ok(!readFileSync(apiState.logFile, "utf8").includes(canary), "API log must not contain the rejected synthetic value canary");
      return { created, canary };
    });

    await t.test("check, stale versions, rotate and clear use server timestamps and preserve fail-closed status", async () => {
      const created = await call(manager, "/admin/secret-references");
      const row = created.items.find(item => item.ref === firstRef); assert.ok(row); assertSafe(row);
      const checked = await call(manager, "/admin/secret-references/" + row.id + "/check", 200, "POST", { expectedUpdatedAt: row.updatedAt });
      assertSafe(checked); assert.equal(checked.configured, false); assert.notEqual(checked.updatedAt, row.updatedAt);
      await call(manager, "/admin/secret-references/" + row.id + "/check", 409, "POST", { expectedUpdatedAt: row.updatedAt });
      const rotated = await call(manager, "/admin/secret-references/" + row.id + "/rotate", 200, "POST", { ref: nextRef, expectedUpdatedAt: checked.updatedAt });
      assertSafe(rotated); assert.equal(rotated.ref, nextRef); assert.equal(rotated.status, "active"); assert.equal(rotated.configured, false);
      await call(manager, "/admin/secret-references/" + row.id + "/clear", 409, "POST", { expectedUpdatedAt: checked.updatedAt });
      const cleared = await call(manager, "/admin/secret-references/" + row.id + "/clear", 200, "POST", { expectedUpdatedAt: rotated.updatedAt });
      assertSafe(cleared); assert.equal(cleared.status, "disabled"); assert.equal(cleared.configured, false);
      const disabled = await call(manager, "/admin/secret-references?status=disabled&q=" + encodeURIComponent("AF037_NEXT_" + suffix));
      assert.equal(disabled.total, 1); assertSafe(disabled.items[0]); assert.equal(disabled.items[0].ref, nextRef);
      await call(reader, "/admin/secret-references/" + row.id, 403);
    });

    await t.test("create/check/rotate/clear are linked to safe persistent audit metadata", async () => {
      const rows = await call(manager, "/admin/secret-references");
      const current = rows.items.find(item => item.ref === nextRef); assert.ok(current); assertSafe(current);
      const audit = await queryFor(state)(client => client.query("SELECT action, request_summary::text AS request_summary, before_data::text AS before_data, after_data::text AS after_data FROM public.audit_log WHERE module='secret-center' AND resource_id=$1 ORDER BY created_at", [current.id]));
      assert.deepEqual(audit.rows.map(row => row.action).sort(), ["secret_reference_checked", "secret_reference_cleared", "secret_reference_created", "secret_reference_rotated"]);
      assert.ok(audit.rows.every(row => !JSON.stringify(row).includes("AF037_SYNTHETIC_FORBIDDEN_VALUE")));
    });
  } finally {
    if (state) await stopUi1("AF-037");
  }
});
