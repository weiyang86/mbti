import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { prepareWorkspaceBrowserMembers, workspaceBrowserEnvironment, workspaceBrowserTask } from "./workspace-browser-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const requireApi = file => require(join(repositoryRoot, "apps/api/dist", file));

test("AF-058 browser-origin mode keeps Workspace UI and real client API isolated over PostgreSQL", { timeout: 300000 }, async t => {
  const lease = await createAcceptance("test", workspaceBrowserTask);
  const deployed = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(deployed.exitCode, 0);
  const fixture = await prepareWorkspaceBrowserMembers(lease.id);
  const values = await workspaceBrowserEnvironment(lease.id);
  const accounts = JSON.parse(await (await import("node:fs/promises")).readFile(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
  const [alphaMember, betaOwner] = accounts;
  const previousEnvironment = { ...process.env };
  const setEnvironment = environment => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, environment);
  };
  const browserOrigin = "http://127.0.0.1:41783";
  let app;
  let baseUrl;
  let alpha;
  let beta;
  const send = async (method, path, { cookie, workspaceId, body, origin = browserOrigin } = {}) => {
    const response = await fetch(baseUrl + "/api/" + path, {
      method,
      headers: {
        connection: "close",
        ...(cookie ? { cookie } : {}),
        ...(workspaceId === undefined ? {} : { "x-aij-workspace-id": workspaceId }),
        ...(origin ? { origin } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(12000)
    });
    return { response, body: await response.json() };
  };
  const expect = async (method, path, status, options) => {
    const result = await send(method, path, options);
    assert.equal(result.response.status, status, method + " " + path + " returned " + JSON.stringify(result.body));
    return result;
  };
  const login = async account => {
    const result = await expect("POST", "client/auth/login", 200, { body: { email: account.email, password: account.password } });
    const header = result.response.headers.get("set-cookie");
    assert.ok(header?.includes("HttpOnly") && header.includes("SameSite=Strict") && header.includes("Path=/api/client"));
    return header.split(";")[0];
  };

  try {
    setEnvironment(values);
    const { createApplication } = requireApi("bootstrap.js");
    await assert.rejects(createApplication({ testBrowserOrigin: "https://outside.example" }), /unreserved loopback HTTP origin/);
    await assert.rejects(createApplication({ testBrowserOrigin: "http://127.0.0.1:3656" }), /unreserved loopback HTTP origin/);
    setEnvironment({ ...values, NODE_ENV: "production" });
    await assert.rejects(createApplication({ testBrowserOrigin: browserOrigin }), /test environment/);
    setEnvironment(values);
    app = await createApplication({ testBrowserOrigin: browserOrigin });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0);
    baseUrl = "http://127.0.0.1:" + address.port;

    await t.test("only the exact dynamic loopback browser origin receives credentialed CORS", async () => {
      const valid = await fetch(baseUrl + "/api/client/auth/login", {
        method: "OPTIONS", headers: { origin: browserOrigin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" }
      });
      assert.equal(valid.status, 204);
      assert.equal(valid.headers.get("access-control-allow-origin"), browserOrigin);
      assert.equal(valid.headers.get("access-control-allow-credentials"), "true");
      const foreign = await fetch(baseUrl + "/api/client/auth/login", {
        method: "OPTIONS", headers: { origin: "http://localhost:3655", "access-control-request-method": "POST" }
      });
      // Express advertises only the configured fixed origin; the foreign browser Origin still mismatches it,
      // and the route-level origin guard independently rejects a direct request.
      assert.equal(foreign.headers.get("access-control-allow-origin"), browserOrigin);
      await expect("POST", "client/auth/login", 403, { origin: "http://localhost:3655", body: { email: alphaMember.email, password: alphaMember.password } });
    });

    const alphaCookie = await login(alphaMember);
    const betaCookie = await login(betaOwner);
    await t.test("two real accounts receive different Workspace membership sets and server rejects forged selection", async () => {
      alpha = (await expect("POST", "client/workspaces", 201, { cookie: alphaCookie, body: { name: "AF-058 Alpha", idempotencyKey: "af058-alpha-" + randomUUID() } })).body.data;
      beta = (await expect("POST", "client/workspaces", 201, { cookie: betaCookie, body: { name: "AF-058 Beta", idempotencyKey: "af058-beta-" + randomUUID() } })).body.data;
      const roles = await expect("GET", "client/workspaces/roles", 200, { cookie: betaCookie, workspaceId: beta.id, origin: undefined });
      const memberRole = roles.body.data.find(role => role.code === "MEMBER");
      assert.ok(memberRole);
      await expect("POST", "client/workspaces/members", 201, { cookie: betaCookie, workspaceId: beta.id, body: { memberId: alphaMember.id, roleId: memberRole.id } });
      const alphaChoices = await expect("GET", "client/workspaces?page=1&pageSize=100", 200, { cookie: alphaCookie, origin: undefined });
      const betaChoices = await expect("GET", "client/workspaces?page=1&pageSize=100", 200, { cookie: betaCookie, origin: undefined });
      assert.deepEqual(alphaChoices.body.data.items.map(row => row.workspace.id).sort(), [alpha.id, beta.id].sort());
      assert.deepEqual(betaChoices.body.data.items.map(row => row.workspace.id), [beta.id]);
      await expect("GET", "client/workspaces/context", 403, { cookie: betaCookie, workspaceId: alpha.id, origin: undefined });
      const memberContext = await expect("GET", "client/workspaces/context", 200, { cookie: alphaCookie, workspaceId: beta.id, origin: undefined });
      assert.deepEqual(memberContext.body.data.permissions, ["workspace.context.read"]);
      await expect("GET", "client/workspaces/members", 403, { cookie: alphaCookie, workspaceId: beta.id, origin: undefined });
      await expect("GET", "client/workspaces/roles", 403, { cookie: alphaCookie, workspaceId: beta.id, origin: undefined });
    });

    await t.test("logout clears only the current session and the prior cookie is rejected", async () => {
      await expect("POST", "client/auth/logout", 200, { cookie: alphaCookie });
      await expect("GET", "client/auth/me", 401, { cookie: alphaCookie, origin: undefined });
      const betaMe = await expect("GET", "client/auth/me", 200, { cookie: betaCookie, origin: undefined });
      assert.equal(betaMe.body.data.id, betaOwner.id);
    });

    await app.close();
    app = undefined;
    const idle = await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async client => {
      const { rows: [row] } = await client.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [lease.database]);
      return row.count;
    }, { acceptanceId: lease.id });
    assert.equal(idle, 0, "API Prisma pool must close after test host shutdown");
    const directory = join(repositoryRoot, ".artifacts/af-058");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, "workspace-browser-http-" + lease.id + ".json"), JSON.stringify({
      task: workspaceBrowserTask, acceptanceId: lease.id, database: lease.database,
      browserOrigin, apiBind: "127.0.0.1:0", accounts: 2, workspaces: [alpha.id, beta.id],
      assertions: ["exact dynamic CORS origin", "foreign Origin rejected", "separate account membership sets", "forged selector 403", "MEMBER role operations 403", "logout prior cookie 401", "unrelated account session remains active", "Prisma pool closes"],
      poolsRemainingAfterShutdown: idle, data: "synthetic MemberUser, Workspaces, roles, permissions, memberships and sessions"
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } finally {
    if (app) await app.close();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previousEnvironment);
  }
});
