import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApplication } from "../src/bootstrap";
import { resolvePluginModules } from "../src/plugin-runtime/plugin-runtime.module";
import { loadRuntimeEnvironment } from "../../../scripts/runtime-environment.cjs";

test("plugins are opt-in, migrated modules resolve and unknown modules reject", () => {
  assert.deepEqual(resolvePluginModules([]), []);
  for (const code of ["aij-ai", "aij-notification", "aij-payment", "mbti-config"]) assert.equal(resolvePluginModules([code]).length, 1);
  for (const code of ["qingqi-app", "company-ops", "unknown-plugin"]) {
    assert.throws(() => resolvePluginModules([code]), /not in the registered backend allowlist/);
  }
});

test("real Nest app responds with process health, correlation and isolated CORS", async () => {
  const runtime = loadRuntimeEnvironment();
  const app = await createApplication();
  try {
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/api/health`, { headers: { "x-correlation-id": "f01-real-http-test", origin: runtime.webUrl } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-correlation-id"), "f01-real-http-test");
    assert.equal(response.headers.get("access-control-allow-origin"), runtime.webUrl);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.data.service, runtime.serviceId);
    assert.equal(result.data.projectId, runtime.projectId);
    assert.equal(result.data.namespace, runtime.namespace);
    assert.equal(result.data.scope, "process");
    assert.equal(result.data.database, "not-configured");
    assert.deepEqual(result.data.enabledPlugins, []);
    assert.ok(Number.isFinite(Date.parse(result.data.time)));
    const invalidCorrelation = await fetch(`${baseUrl}/api/health`, { headers: { "x-correlation-id": "bad" } });
    assert.match(invalidCorrelation.headers.get("x-correlation-id") ?? "", /^[0-9a-f-]{36}$/);
    assert.equal((await fetch(`${baseUrl}/api/admin/users`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/admin/permissions`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/admin/permissions/my`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/plugins/qingqi-app`)).status, 404);
    const deniedOrigin = "https://unapproved.example";
    const crossOrigin = await fetch(`${baseUrl}/api/health`, { headers: { origin: deniedOrigin } });
    assert.equal(crossOrigin.status, 200); // Process health is public; CORS is not authentication.
    assert.notEqual(crossOrigin.headers.get("access-control-allow-origin"), deniedOrigin);
    const preflight = await fetch(`${baseUrl}/api/health`, { method: "OPTIONS", headers: { origin: runtime.webUrl, "access-control-request-method": "GET" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), runtime.webUrl);
  } finally {
    await app.close();
  }
});
