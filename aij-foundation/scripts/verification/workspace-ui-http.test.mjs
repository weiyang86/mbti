import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { prepareWorkspaceUiMembers, workspaceUiEnvironment, workspaceUiTask } from "./workspace-ui-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const requireApi = file => require(join(repositoryRoot, "apps/api/dist", file));

test("AF-057 serves only server-authorized Workspace choices and actions through the real client APIs", { timeout: 240000 }, async t => {
  const lease = await createAcceptance("test", workspaceUiTask);
  const deployment = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(deployment.exitCode, 0);
  const fixture = await prepareWorkspaceUiMembers(lease.id);
  const values = await workspaceUiEnvironment(lease.id);
  const accounts = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(fixture.accounts[0].initialPasswordFile, "utf8"))).accounts;
  const [alphaOwner, betaOwner] = accounts;
  const previousEnvironment = { ...process.env };
  let app;
  let baseUrl;
  const setEnvironment = environment => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, environment);
  };
  const closeApp = async () => { if (app) { await app.close(); app = undefined; } };
  const send = async (method, path, { cookie, workspaceId, body } = {}) => {
    const response = await fetch(baseUrl + "/api/" + path, {
      method,
      headers: {
        connection: "close",
        ...(cookie ? { cookie } : {}),
        ...(workspaceId === undefined ? {} : { "x-aij-workspace-id": workspaceId }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(method !== "GET" ? { origin: values.WEB_URL } : {})
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
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0);
    baseUrl = "http://127.0.0.1:" + address.port;
    const alphaCookie = await login(alphaOwner);
    const betaCookie = await login(betaOwner);
    let alpha;
    let beta;
    const checks = {};

    await t.test("workspace picker data contains only active memberships for the logged-in member", async () => {
      alpha = (await expect("POST", "client/workspaces", 201, { cookie: alphaCookie, body: { name: "AF-057 Alpha", idempotencyKey: "af057-alpha-create" } })).body.data;
      beta = (await expect("POST", "client/workspaces", 201, { cookie: betaCookie, body: { name: "AF-057 Beta", idempotencyKey: "af057-beta-create" } })).body.data;
      const betaRoles = await expect("GET", "client/workspaces/roles", 200, { cookie: betaCookie, workspaceId: beta.id });
      const memberRole = betaRoles.body.data.find(role => role.code === "MEMBER");
      assert.ok(memberRole);
      await expect("POST", "client/workspaces/members", 201, { cookie: betaCookie, workspaceId: beta.id, body: { memberId: alphaOwner.id, roleId: memberRole.id } });
      const alphaList = await expect("GET", "client/workspaces?page=1&pageSize=100", 200, { cookie: alphaCookie });
      const betaList = await expect("GET", "client/workspaces?page=1&pageSize=100", 200, { cookie: betaCookie });
      assert.deepEqual(alphaList.body.data.items.map(item => item.workspace.id).sort(), [alpha.id, beta.id].sort());
      assert.deepEqual(betaList.body.data.items.map(item => item.workspace.id), [beta.id]);
      assert.ok(alphaList.body.data.items.some(item => item.workspace.id === beta.id && item.role.code === "MEMBER"));
      checks.membershipScopedWorkspaceChoices = true;
    });

    await t.test("server context permissions determine visible operations; forged selectors reject", async () => {
      const ownerContext = await expect("GET", "client/workspaces/context", 200, { cookie: betaCookie, workspaceId: beta.id });
      assert.ok(ownerContext.body.data.permissions.includes("workspace.member.manage"));
      assert.ok(ownerContext.body.data.permissions.includes("workspace.member.read"));
      const ownerMembers = await expect("GET", "client/workspaces/members?page=1&pageSize=100", 200, { cookie: betaCookie, workspaceId: beta.id });
      assert.equal(ownerMembers.body.data.items.length, 2);
      const memberContext = await expect("GET", "client/workspaces/context", 200, { cookie: alphaCookie, workspaceId: beta.id });
      assert.deepEqual(memberContext.body.data.permissions, ["workspace.context.read"]);
      await expect("GET", "client/workspaces/members", 403, { cookie: alphaCookie, workspaceId: beta.id });
      await expect("GET", "client/workspaces/roles", 403, { cookie: alphaCookie, workspaceId: beta.id });
      await expect("POST", "client/workspaces/members", 403, { cookie: alphaCookie, workspaceId: beta.id, body: { memberId: betaOwner.id, roleId: memberContext.body.data.roleId } });
      await expect("GET", "client/workspaces/context?workspaceId=" + beta.id, 403, { cookie: betaCookie, workspaceId: alpha.id });
      checks.serverReturnedPermissionAndForeignSelectorDenied = true;
    });

    await t.test("membership status change invalidates context immediately and account logout revokes the old session", async () => {
      const members = await expect("GET", "client/workspaces/members?page=1&pageSize=100", 200, { cookie: betaCookie, workspaceId: beta.id });
      const alphaMembership = members.body.data.items.find(item => item.memberId === alphaOwner.id);
      assert.ok(alphaMembership);
      await expect("PATCH", "client/workspaces/members/" + alphaMembership.id + "/status", 200, { cookie: betaCookie, workspaceId: beta.id, body: { status: "suspended" } });
      await expect("GET", "client/workspaces/context", 403, { cookie: alphaCookie, workspaceId: beta.id });
      const suspendedChoices = await expect("GET", "client/workspaces?page=1&pageSize=100", 200, { cookie: alphaCookie });
      assert.deepEqual(suspendedChoices.body.data.items.map(item => item.workspace.id), [alpha.id]);
      await expect("PATCH", "client/workspaces/members/" + alphaMembership.id + "/status", 200, { cookie: betaCookie, workspaceId: beta.id, body: { status: "active" } });
      await expect("GET", "client/workspaces/context", 200, { cookie: alphaCookie, workspaceId: beta.id });
      await expect("POST", "client/auth/logout", 200, { cookie: alphaCookie });
      await expect("GET", "client/auth/me", 401, { cookie: alphaCookie });
      await expect("POST", "client/auth/login", 401, { body: { email: alphaOwner.email, password: "incorrect synthetic password" } });
      checks.sessionInvalidationAndAccountSwitchReady = true;
    });

    const evidence = await import("node:fs/promises");
    const directory = join(repositoryRoot, ".artifacts/af-057");
    await evidence.mkdir(directory, { recursive: true, mode: 0o700 });
    await evidence.writeFile(join(directory, "workspace-ui-http-" + lease.id + ".json"), JSON.stringify({
      task: workspaceUiTask,
      acceptanceId: lease.id,
      database: lease.database,
      bind: "127.0.0.1:0",
      routes: ["GET /api/client/workspaces", "GET /api/client/workspaces/context", "GET /api/client/workspaces/members", "GET /api/client/workspaces/roles", "POST/PATCH /api/client/workspaces/members", "POST /api/client/auth/logout"],
      checks,
      data: "Synthetic MemberUser, Workspaces, roles, permissions, memberships and sessions only"
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } finally {
    await closeApp();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previousEnvironment);
  }
});
