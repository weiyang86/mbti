import assert from "node:assert/strict";
import test from "node:test";
import { prepareUi1, stopUi1 } from "./ui1-manual.mjs";
import { browserSession, call, queryFor, origin } from "./ui2-support.mjs";

test("AF-036 configuration page uses trusted layered API, exposes versions and keeps public context safe", { timeout: 180000 }, async t => {
  let state;
  try {
    state = await prepareUi1("AF-036");
    const root = await browserSession(state);
    const manager = await browserSession(state, "ui2-configuration-manager");
    const reader = await browserSession(state, "ui2-reader");
    const empty = await browserSession(state, "ui2-empty");
    const query = queryFor(state);

    async function raw(session, path, method = "GET", body) {
      const response = await fetch("http://127.0.0.1:3656/api" + path, { method, headers: { origin, "x-correlation-id": "af036-configuration", ...(session ? { cookie: session.cookie, "x-aij-csrf": session.csrf } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
      const text = await response.text();
      assert.ok(!/passwordHash|password_hash|accessToken|\$2[aby]\$/.test(text), "Configuration response must not include credentials");
      return { status: response.status, text, data: text ? JSON.parse(text).data : undefined };
    }
    function configBody(scope, value, expectedVersion, extra = {}) {
      return { scope, configValue: value, valueType: "string", isPublic: true, status: "active", expectedVersion, ...extra };
    }

    await t.test("actual Next route and server menu are permission-filtered; API rejects anonymous and ungranted callers", async () => {
      const page = await fetch(origin + "/auth/configuration", { headers: { cookie: manager.cookie }, signal: AbortSignal.timeout(8000) });
      assert.equal(page.status, 200); assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      const flatten = nodes => nodes.flatMap(node => [...(node.path ? [node.path] : []), ...flatten(node.children)]);
      assert.ok(flatten(await call(manager, "/admin/menus/my")).includes("/auth/configuration"));
      assert.ok(!flatten(await call(reader, "/admin/menus/my")).includes("/auth/configuration"));
      assert.deepEqual(await call(empty, "/admin/menus/my"), []);
      await call(null, "/admin/scoped-configs", 401);
      await call(reader, "/admin/scoped-configs", 403);
      await call(reader, "/admin/scoped-configs/brand.displayName/resolved", 403);
      await call(manager, "/admin/scoped-configs/brand.displayName", 403, "PUT", configBody("global", "G6-02 unauthorized", 0));
    });

    await t.test("project, organization and global scope values resolve from server-owned context and expose versions", async () => {
      const profile = await call(manager, "/admin/project-profile");
      assert.equal(profile.code, "aij-foundation-test"); assert.equal(profile.status, "active");
      await call(root, "/admin/scoped-configs/brand.displayName", 200, "PUT", configBody("global", "G6-02 synthetic global", 0));
      assert.equal((await call(manager, "/admin/scoped-configs/brand.displayName/resolved")).source, "global");
      await call(manager, "/admin/scoped-configs/brand.displayName", 200, "PUT", configBody("organization", "G6-02 synthetic organization", 0));
      assert.equal((await call(manager, "/admin/scoped-configs/brand.displayName/resolved")).source, "organization");
      await call(manager, "/admin/scoped-configs/brand.displayName", 200, "PUT", configBody("project", "G6-02 synthetic project", 0));
      const effective = await call(manager, "/admin/scoped-configs/brand.displayName/resolved");
      assert.equal(effective.source, "project"); assert.equal(effective.version, 1); assert.equal(effective.configValue, "G6-02 synthetic project");
      const rows = await call(manager, "/admin/scoped-configs");
      assert.deepEqual(rows.filter(row => row.configKey === "brand.displayName").map(row => row.scope).sort(), ["global", "organization", "project"]);
      assert.ok(rows.filter(row => row.configKey === "brand.displayName").every(row => row.version === 1));
      assert.equal(profile.organization.status, "active");
    });

    await t.test("stale and simultaneous writes receive a real 409 without lost updates", async () => {
      const initial = (await call(manager, "/admin/scoped-configs")).find(row => row.scope === "project" && row.configKey === "brand.displayName");
      assert.equal(initial.version, 1);
      await call(manager, "/admin/scoped-configs/brand.displayName", 200, "PUT", configBody("project", "G6-02 next", 1));
      const stale = await raw(manager, "/admin/scoped-configs/brand.displayName", "PUT", configBody("project", "G6-02 stale", 1));
      assert.equal(stale.status, 409);
      const pair = await Promise.all(["writer-one", "writer-two"].map(name => raw(manager, "/admin/scoped-configs/brand.displayName", "PUT", configBody("project", "G6-02 " + name, 2))));
      assert.deepEqual(pair.map(result => result.status).sort(), [200, 409]);
      const actual = (await call(manager, "/admin/scoped-configs")).find(row => row.scope === "project" && row.configKey === "brand.displayName");
      assert.equal(actual.version, 3);
    });

    await t.test("anonymous public context uses a strict projection and never exposes profile metadata", async () => {
      const markers = ["G6-02-PRIVATE-PROJECT", "G6-02-PRIVATE-ORG", "G6-02-LEGAL-ENTITY"];
      await query(async client => {
        await client.query("UPDATE public.project_profile SET brand=$1::jsonb,legal_entity=$2 WHERE code='aij-foundation-test'", [JSON.stringify({ token: markers[0], privateBrand: true }), markers[2]]);
        await client.query("UPDATE public.organization_profile SET meta=$1::jsonb WHERE code='aij-foundation-test'", [JSON.stringify({ credential: markers[1] })]);
      });
      const context = await call(null, "/project/context");
      assert.deepEqual(Object.keys(context).sort(), ["brand", "capabilities", "enabledPlugins", "projectCode"]);
      const encoded = JSON.stringify(context); for (const marker of markers) assert.ok(!encoded.includes(marker));
      assert.ok(!encoded.includes("token") && !encoded.includes("credential") && !encoded.includes("legalEntity"));
      assert.ok(context.brand.displayName.startsWith("G6-02"));
      await call(manager, "/admin/scoped-configs/capabilities.publicContextEnabled", 200, "PUT", { scope: "project", configValue: "false", valueType: "boolean", isPublic: true, status: "active", expectedVersion: 0 });
      await call(null, "/project/context", 403);
      await call(manager, "/admin/scoped-configs/capabilities.publicContextEnabled", 200, "PUT", { scope: "project", configValue: "true", valueType: "boolean", isPublic: true, status: "active", expectedVersion: 1 });
      assert.equal((await call(null, "/project/context")).capabilities.publicContext, true);
    });

    await t.test("configuration history exposes versions and audit links, never config payloads", async () => {
      const history = await call(manager, "/admin/configuration-changes");
      const relevant = history.filter(change => change.configKey === "brand.displayName");
      assert.ok(relevant.length >= 4);
      assert.ok(relevant.every(change => change.configVersion >= 1 && typeof change.auditLogId === "string" && change.auditLogId.length > 0));
      assert.ok(!JSON.stringify(history).includes("G6-02 synthetic"));
    });
  } finally {
    if (state) await stopUi1("AF-036");
  }
});
