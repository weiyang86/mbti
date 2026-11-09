import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { prepareExternalServicesHost, verifyExternalServicesBrowser } from "./external-services-browser.mjs";

test("AF194 production configuration page, actual cookie/CSRF API, desktop and mobile390", { timeout: 540000 }, async () => {
  assert.equal(process.env.AIJ_AF194_ROOT_ACCEPTANCE, "true", "Explicit root GUI acceptance opt-in required");
  assert.equal(resolve(process.cwd()), "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
  assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
  const gitPath = flag => resolve(execFileSync("git", ["rev-parse", flag], { encoding: "utf8" }).trim());
  assert.equal(gitPath("--git-dir"), gitPath("--git-common-dir"));
  const original = { ...process.env };
  const replaceEnvironment = v => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, v); };
  const lease = await createAcceptance("test", "AF-194");
  for (const action of ["deploy", "status"]) assert.equal((await migrate({ mode: "test", action, acceptanceId: lease.id })).exitCode, 0);
  const host = await prepareExternalServicesHost();
  const requireApi = createRequire(join(repositoryRoot, "apps/api/package.json"));
  const load = p => requireApi(join(repositoryRoot, "apps/api/dist", p + ".js"));
  const password = "T9-" + randomBytes(24).toString("hex");
  let app, prisma, project, organization, admin, configPermission, secretPermission, Logger, loggerState, applicationPools, apiSockets;
  try {
    replaceEnvironment({ PATH: original.PATH, HOME: original.HOME, TMPDIR: original.TMPDIR,
      PROJECT_ID: "aij-foundation", APP_ENV: "test", RUNTIME_PROFILE: "host", NODE_ENV: "test", DATABASE_ACCEPTANCE_ID: lease.id,
      AUTH_ENABLED: "true", CLIENT_AUTH_ENABLED: "false", DATABASE_ENABLED: "true", STORAGE_ENABLED: "false", ASYNC_RUNTIME_ENABLED: "false", ENABLED_PLUGINS: "",
      JWT_SECRET: randomBytes(32).toString("hex"), JWT_ISSUER: "urn:aij:aij-foundation:test:api", COOKIE_PREFIX: "aij_foundation_test",
      WEB_PORT: "3655", API_PORT: "3656", WEB_URL: "http://localhost:3655", NEXT_PUBLIC_API_URL: "http://localhost:3656/api", LOCAL_STORAGE_ROOT: ".local-data/aij-foundation/test/storage", NEXT_TELEMETRY_DISABLED: "1" });
    ({ Logger } = requireApi("@nestjs/common"));
    loggerState = { instance: Logger.staticInstanceRef, levels: Logger.logLevels, buffer: Logger.logBuffer, attached: Logger.isBufferAttached };
    Logger.detachBuffer(); Logger.overrideLogger(false);
    app = await load("bootstrap").createApplication({ testBrowserOrigin: host.origin });
    prisma = app.get(load("prisma/prisma.service").PrismaService);
    assert.equal((await prisma.readiness()).ready, true);
    assert.equal(await prisma.sysUser.count(), 0, "Fresh AF194 lease required");
    organization = await prisma.organizationProfile.create({ data: { code: "af194-synthetic", name: "AF194 synthetic" } });
    project = await prisma.projectProfile.create({ data: { code: "aij-foundation-test", name: "AF194 synthetic", environment: "test", organizationId: organization.id } });
    configPermission = await prisma.sysPermission.create({ data: { permissionCode: "admin.config.manage", permissionName: "AF194 configuration", resourceType: "api", module: "configuration", action: "manage" } });
    secretPermission = await prisma.sysPermission.create({ data: { permissionCode: "admin.secret.manage", permissionName: "AF194 references", resourceType: "api", module: "secret-center", action: "manage" } });
    admin = await prisma.sysUser.create({ data: { username: "af194_admin", realName: "AF194 synthetic", isSuperAdmin: true, passwordHash: await requireApi("bcryptjs").hash(password, 12) } });
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    let cookie, csrf;
    const send = async (path, method = "GET", body) => {
      const response = await fetch(base + "/api" + path, { method, headers: { origin: host.origin, "x-aij-client": "web", connection: "close", ...(cookie ? { cookie } : {}), ...(csrf ? { "x-aij-csrf": csrf } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      const value = await response.json(); return { status: response.status, data: value.data, headers: response.headers };
    };
    const login = await send("/auth/browser-login", "POST", { username: admin.username, password });
    assert.equal(login.status, 200); cookie = login.headers.get("set-cookie").split(";", 1)[0];
    const session = await send("/auth/session"); assert.equal(session.status, 200); csrf = session.data.csrfToken;
    const request = async (method, path, body) => {
      if (method === "REVOKE_CONFIGURATION" || method === "RESTORE_CONFIGURATION") {
        await prisma.sysPermission.update({ where: { id: configPermission.id }, data: { status: method === "REVOKE_CONFIGURATION" ? "disabled" : "active" } }); return;
      }
      assert.ok(["GET", "PUT"].includes(method)); assert.match(path, /^\/admin\/external-services\/[a-z-]+$/);
      return send(path, method, body);
    };
    const result = await verifyExternalServicesBrowser({ base, leaseId: lease.id, loginCredentials: { username: admin.username, password }, origin: host.origin, request });
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.cases, ["desktop-blank-draft", "unknown-save-explicit-get", "cas-preserves-user-draft", "unmount-stale-read", "mobile390", "current-permission-refusal"]);
    const row = await prisma.scopedConfig.findFirstOrThrow({ where: { scopeId: project.id, configKey: "external.services.deepseek" } });
    assert.equal(row.version, 4); assert.equal(row.status, "disabled");
    assert.deepEqual(JSON.parse(row.configValue), { fields: { model: "af194-user-conflict-draft" }, credentialRefs: {} });
  } finally {
    try {
      await host.close();
      if (prisma) {
        if (project) { await prisma.configurationChange.deleteMany({ where: { scopeId: project.id } }); await prisma.scopedConfig.deleteMany({ where: { scopeId: project.id } }); }
        if (admin) { await prisma.adminAuthSession.deleteMany({ where: { userId: admin.id } }); await prisma.auditLog.deleteMany({ where: { userId: admin.id } }); await prisma.sysUser.delete({ where: { id: admin.id } }); }
        await prisma.sysPermission.deleteMany({ where: { id: { in: [configPermission?.id, secretPermission?.id].filter(Boolean) } } });
        if (project) await prisma.projectProfile.delete({ where: { id: project.id } });
        if (organization) await prisma.organizationProfile.delete({ where: { id: organization.id } });
      }
    } finally {
      try {
        app?.getHttpServer()?.closeAllConnections(); await app?.close();
        if (app) apiSockets = await new Promise((yes, no) => app.getHttpServer().getConnections((error, count) => error ? no(error) : yes(count)));
        assert.equal(apiSockets, 0);
        if (prisma) await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async client => { const { rows: [row] } = await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'"); applicationPools = row.n; assert.equal(applicationPools, 0); }, { acceptanceId: lease.id });
      } finally {
        if (loggerState) { Logger.staticInstanceRef = loggerState.instance; Logger.logLevels = loggerState.levels; Logger.logBuffer = loggerState.buffer; Logger.isBufferAttached = loggerState.attached; }
        replaceEnvironment(original);
      }
    }
  }
  const directory = join(repositoryRoot, ".artifacts/auto-ai-program-20261105/AF-194");
  assert.equal(host.state.status, "CLOSED");
  const ownedSockets = host.state.ownedSockets + apiSockets; assert.equal(ownedSockets, 0);
  writeFileSync(join(directory, "closed-" + lease.id + ".json"), JSON.stringify({ task: "AF-194", acceptanceId: lease.id, status: "CLOSED", applicationPools, ownedSockets, fixtureClosed: true, vendorAcceptance: "DEFERRED_NOT_PASSED" }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ task: "AF-194", status: "PASS", acceptanceId: lease.id, evidenceDirectory: directory, vendorAcceptance: "DEFERRED_NOT_PASSED" }));
});
