// Real HTTP acceptance using this project's development-only Foundation identities.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

async function main() {
  const [orderId, amountInput = "990"] = process.argv.slice(2);
  assert.ok(/^MBTI-[a-f0-9-]{36}$/.test(orderId || "") && /^[1-9][0-9]*$/.test(amountInput));
  assert.ok(process.argv.length <= 4);
  const sourceRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const ownerRoot = realpathSync(process.env.MBTI_LOCAL_OWNER_ROOT || sourceRoot);
  const check = spawnSync(process.execPath, [resolve(sourceRoot, "scripts/mbti-local.mjs"), "check", "dev"], { env: process.env, encoding: "utf8" });
  assert.equal(check.status, 0, "Owned development target required");
  const directory = resolve(ownerRoot, ".local-data/mbti-foundation/development");
  const path = resolve(directory, "operations-account.json");
  const info = lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077));
  const credentials = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(credentials.project, "mbti-foundation");
  assert.equal(credentials.environment, "development");
  assert.equal(credentials.ownerRoot, ownerRoot);
  const env = parseEnv(readFileSync(resolve(directory, ".env"), "utf8"));
  assert.equal(env.AUTH_ENABLED, "true");
  assert.ok(!env.MBTI_F3_TEST_PAYMENT_SECRET && !env.MBTI_F3_TEST_FIXTURE);
  const origin = new URL(process.env.MBTI_PUBLIC_ORIGIN || "http://127.0.0.1:" + env.API_PORT);
  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]", ...Object.values(networkInterfaces()).flat().filter(Boolean).map(item => item.address)]);
  assert.ok(origin.protocol === "http:" && localHosts.has(origin.hostname) && origin.port === env.API_PORT &&
    !origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash, "Only the owned local development API may receive credentials");
  const receipts = [];
  async function call(method, route, expected, headers = {}, body) {
    const response = await fetch(origin.origin + route, { method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(response.status, expected, method + " " + route);
    const data = await response.json();
    receipts.push({ method, path: route, status: response.status });
    return data;
  }
  const sessions = [];
  try {
    for (const kind of ["ops", "denied_probe"]) {
      const user = credentials.users.find(item => item.kind === kind);
      const response = await call("POST", "/api/auth/login", 200, {}, { username: user.username, password: user.password });
      assert.equal(response.data.user.isSuperAdmin, false);
      assert.equal(typeof response.data.accessToken, "string");
      sessions.push(response.data.accessToken);
    }
    const route = "/api/admin/mbti/orders/" + orderId;
    await call("GET", route, 401);
    const guest = await call("POST", "/api/v1/auth/guest", 201);
    await call("GET", route, 401, { "X-Guest-Token": guest.guest_token });
    await call("GET", route, 403, { Authorization: "Bearer " + sessions[1] });
    const order = await call("GET", route, 200, { Authorization: "Bearer " + sessions[0] });
    assert.equal(order.id, orderId);
    assert.equal(order.amount, Number(amountInput));
    assert.equal(order.currency, "CNY");
    assert.equal(order.status, "pending");
    assert.equal(order.unlocked, false);
    assert.equal(order.payment_availability, "unconfigured");
    assert.ok(!("pay_params" in order) && !("paid_at" in order));
    await call("GET", "/api/v1/orders/" + orderId, 404, { "X-Guest-Token": guest.guest_token });
    await call("POST", "/api/admin/mbti/test-payments/" + orderId, 404, { Authorization: "Bearer " + sessions[0] });
    await call("POST", "/api/v1/payments/controlled-test/callback", 404, {}, {});
    console.log(JSON.stringify({ environment: "development", origin: origin.origin, order, receipts }, null, 2));
    console.log("PASS real development operations same-order HTTP; least privilege, guest isolation and disabled controlled payment routes");
  } finally {
    for (const token of sessions) await call("POST", "/api/auth/logout", 200, { Authorization: "Bearer " + token });
  }
}

main().catch(() => { console.error("MBTI development operations HTTP verification failed (credentials suppressed)"); process.exitCode = 1; });
