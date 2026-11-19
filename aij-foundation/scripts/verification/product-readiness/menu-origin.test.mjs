// Offline verification of the actual collector output; does not log in or connect.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot, assertLocalPath } from "../../database/connection.mjs";
import { assertEvidence, assertSanitized, evidenceDirectory, projectResponse } from "./menu-origin.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const latest = JSON.parse(readFileSync(join(evidenceDirectory, "latest.json"), "utf8"));
assert.match(latest.file, /^\.artifacts\/orca-b02\/AF-129\/menu-origin-[\dTZ-]+\.json$/);
const evidencePath = join(repositoryRoot, latest.file); assertLocalPath(evidencePath);
const bytes = readFileSync(evidencePath); assert.equal(hash(bytes), latest.sha256);
const evidence = JSON.parse(bytes);
const change = edit => { const copy = structuredClone(evidence); edit(copy); return copy; };
const recompute = snapshot => { snapshot.fingerprints = Object.entries(snapshot.rows).map(([table, rows]) => ({ table, count: rows.length, sha256: hash(JSON.stringify(rows)) })); };

test("AF-129 real five-part evidence links protected DB identity, HTTP results, source SHA, menu cause and base limits", () => {
  assert.equal(assertEvidence(evidence), true);
  assert.equal(evidence.http.length, 16);
  assert.equal(evidence.before.rows.menus.length, 2);
  assert.deepEqual(evidence.conclusions.observedMenuPaths, ["/auth/ai/center", "/auth/ai/usage"]);
  assert.equal(evidence.conclusions.isSuperAdminGeneratesMenus, false);
  assert.equal(evidence.conclusions.baseReadiness, "路由已存在，开箱初始化尚欠");
  for (const source of evidence.source) {
    const content = readFileSync(join(repositoryRoot, source.file), "utf8");
    assert.equal(hash(content), source.sha256, source.file + " changed since collection");
    for (const anchor of source.anchors) for (const match of anchor.matches) {
      assert.equal(content.split("\n")[match.line - 1].trim(), match.text);
      assert.ok(match.text.includes(anchor.anchor));
    }
  }
  const seed = readFileSync(join(repositoryRoot, "scripts/database/seed.mjs"), "utf8");
  assert.equal(seed.match(/INSERT INTO public\.sys_menu/g)?.length, 1);
  assert.ok(seed.indexOf("if (aiCenter) for") < seed.indexOf("INSERT INTO public.sys_menu"));
  assert.match(seed, /grantsReconciled: false, pluginEnabled: false/);
});

test("reject missing HTTP evidence, failed responses, invalid methods and absent times", () => {
  for (const edit of [
    e => e.http.pop(), e => { e.http[0].status = 503; }, e => { e.http[1].at = "unknown"; },
    e => { e.http.find(row => row.name === "my").method = "POST"; },
    e => { e.http.find(row => row.name === "ready").response.status = "not-ready"; }
  ]) assert.throws(() => assertEvidence(change(edit)));
});

test("reject runtime/version/target drift and invented independent base readiness", () => {
  for (const edit of [
    e => { e.runtime.recorded.head = "0".repeat(40); },
    e => { e.runtime.legacy.buildSha = e.runtime.recorded.head; },
    e => { e.runtime.ports.find(row => row.port === 3656).pid++; },
    e => { e.before.target.port = 55432; }, e => { e.before.identity.database = "other_database"; },
    e => { e.before.target.acceptanceId = "0".repeat(16); },
    e => { e.boundaries.independentBaseVerified = true; },
    e => { e.conclusions.baseReadiness = "ready"; }, e => { e.source = []; }
  ]) assert.throws(() => assertEvidence(change(edit)));
});

test("detect changed authorization/menu/plugin rows even when their new fingerprints are internally consistent", () => {
  for (const edit of [
    e => { e.after.rows.accounts[0].is_super_admin = !e.after.rows.accounts[0].is_super_admin; },
    e => { e.after.rows.userRoles.push({ id: "invented", user_id: "invented", role_id: "invented" }); },
    e => { e.after.rows.rolePermissions.push({ id: "invented", role_id: "invented", permission_id: "invented" }); },
    e => { e.after.rows.definitions[0].status = "disabled"; },
    e => { e.after.rows.menus[0].visible = false; }, e => { e.after.rows.plugins[0].status = "disabled"; }
  ]) {
    const changed = change(edit); recompute(changed.after);
    assert.throws(() => assertEvidence(changed));
  }
});

test("reject unsupported menu and effective-permission conclusions, not merely a PASS string", () => {
  for (const edit of [
    e => { e.http.find(row => row.name === "my").response.push({ path: "/auth/roles", children: [] }); },
    e => { e.http.find(row => row.name === "menus").response = []; },
    e => { e.http.find(row => row.name === "permissions").response.effectivePermissions = []; },
    e => { e.http.find(row => row.name === "permissions").response.roles = ["invented-role"]; },
    e => { e.http.find(row => row.name === "pages").response.find(page => page.path === "/auth/ai/center").available = false; },
    e => { e.http.find(row => row.name === "plugins").response.installations[0].status = "disabled"; },
    e => { e.conclusions.permissionFilterRemovedExistingMenus = true; }
  ]) assert.throws(() => assertEvidence(change(edit)));
});

test("white-list response projection drops credential/session/PII canaries and rejects leaked evidence", () => {
  const canary = "AF129_PRIVATE_CANARY_NEVER_PERSIST";
  const privateFields = { accessToken: canary, password: canary, cookie: canary, csrfToken: canary, username: canary, realName: canary, email: canary };
  const identity = projectResponse("login", { ...privateFields, user: { id: "synthetic", isSuperAdmin: true, ...privateFields } });
  assert.deepEqual(identity, { id: "synthetic", isSuperAdmin: true });
  const menu = projectResponse("menus", [{ id: "synthetic", path: "/admin", ...privateFields, children: [] }]);
  assert.equal(JSON.stringify(menu).includes(canary), false);
  const plugins = projectResponse("plugins", { ...privateFields, available: [{ code: "aij-ai", ...privateFields }], installations: [{ pluginCode: "aij-ai", status: "enabled", ...privateFields }] });
  assert.equal(JSON.stringify(plugins).includes(canary), false);
  assert.doesNotThrow(() => assertSanitized(evidence));
  for (const privateField of Object.keys(privateFields)) assert.throws(() => assertEvidence(change(e => { e.http[0].response[privateField] = canary; })));
  assert.throws(() => assertEvidence(change(e => { e.http[0].response.leak = "Bearer " + canary; })));
  assert.throws(() => assertEvidence(change(e => { e.http[0].response.raw = canary; })));
  assert.equal(bytes.includes(Buffer.from(canary)), false);
});

test("normal login/logout writes are accounted for without permitting other audit or session changes", () => {
  for (const edit of [
    e => { e.after.observations.sessions.find(row => row.transport === "bearer").count++; },
    e => { e.after.observations.auditActions.find(row => row.action === "login").count++; },
    e => { e.after.observations.auditActions.push({ module: "menus", action: "menu_created", count: 1 }); },
    e => { e.after.observations.login = e.before.observations.login; }
  ]) assert.throws(() => assertEvidence(change(edit)));
});
