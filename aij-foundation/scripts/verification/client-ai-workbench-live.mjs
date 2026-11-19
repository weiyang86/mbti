// ROOT ONLY: real protected acceptance DB/API, synthetic loopback upstream.
// Never run from a Worker or against an existing acceptance lease.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { assertLocalPath, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";
import { prepareAiCenter } from "./ai-center-fixture.mjs";

export const liveTask = "AF-142";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfP8AAAAASUVORK5CYII=", "base64");
const fail = code => { throw new Error(code); };
let occupied = false;

function rootOnly(task) {
  if (!["AF-142", "AF-149"].includes(task)) fail("WORKBENCH_TASK_NOT_REGISTERED");
  const code = task.replace("-", "");
  if (process.env["AIJ_" + code + "_ROOT_ACCEPTANCE"] !== "true") fail(code + "_ROOT_ACCEPTANCE_NOT_ENABLED");
  if (process.cwd() !== repositoryRoot) fail(code + "_MAIN_WORKTREE_REQUIRED");
  if (execFileSync("git", ["branch", "--show-current"], { cwd: repositoryRoot, encoding: "utf8" }).trim() !== "dev") fail(code + "_MAIN_WORKTREE_REQUIRED");
  const gitPath = flag => resolve(repositoryRoot, execFileSync("git", ["rev-parse", flag], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  if (gitPath("--git-dir") !== gitPath("--git-common-dir")) fail("AF142_MAIN_WORKTREE_REQUIRED");
  if (occupied) fail("AF142_FIXTURE_ALREADY_ACTIVE");
}

function ignored(path) {
  assertLocalPath(path);
  execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", path], { cwd: repositoryRoot, stdio: "ignore" });
}

async function privateDirectory(path, privateAncestors = true) {
  ignored(path);
  let cursor = repositoryRoot;
  for (const part of relative(repositoryRoot, path).split(sep)) {
    if (!part || part === "." || part === "..") fail("AF142_PRIVATE_PATH_INVALID");
    cursor = join(cursor, part);
    await mkdir(cursor, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (privateAncestors && (stat.mode & 0o077))) fail("AF142_PRIVATE_DIRECTORY_REQUIRED");
  }
}

const replaceEnvironment = values => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, values);
};
const closeServer = async server => {
  if (!server) return;
  server.closeAllConnections();
  if (server.listening) await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
};

/** Root owns registration, API dist/Prisma generation and serial DB scheduling.
 * browserOrigin must be the exact loopback origin of root's real Web process.
 * Returns credential FILE REFERENCES; passwords/cookies/admin token stay private.
 */
export async function prepareClientAiWorkbenchLive({ task = "AF-142", browserOrigin = "http://127.0.0.1:41783" } = {}) {
  rootOnly(task); occupied = true;
  const liveTask = task;
  const outputDirectory = join(repositoryRoot, ".artifacts/auto-ai-program-20261105", task);
  const previousEnvironment = { ...process.env };
  let stage = "ACCEPTANCE", lease, fixture, app, prisma, server, transport, originalTransport, transportDescriptor;
  let Logger, loggerState, storageRoot, closed = false, closing = false, activePump;
  let mode = "success", upstreamCalls = 0, rejectedTransports = 0, baseUrl, jobs;
  const evidence = [];
  const cookies = new Map();
  const requireApi = file => require(join(repositoryRoot, "apps/api/dist", file));
  async function writeEvidence(name, value) {
    // Evidence has only allowlisted metadata; existing shared artifact parents
    // may be public directories. Never chmod another task's parent directory.
    await privateDirectory(outputDirectory, false);
    const path = join(outputDirectory, `${name}-${lease.id}.json`);
    ignored(path);
    await writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return path;
  }
  async function close() {
    if (closed) return;
    if (closing) fail("AF142_CLOSE_ALREADY_RUNNING");
    closing = true;
    const failures = [];
    const attempt = async (label, fn) => { try { await fn(); } catch { failures.push(label); } };
    process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = "false";
    await attempt("PUMP", async () => { if (activePump) await activePump; });
    await attempt("STORAGE", async () => {
      if (!prisma || !fixture) return;
      const { LocalStorageAdapter } = requireApi("files/local-storage.adapter.js");
      const assets = await prisma.fileAsset.findMany({ where: { ownerType: "ai-run", uploaderId: { in: fixture.accounts.map(a => a.id) } }, select: { objectKey: true } });
      for (const asset of assets) await app.get(LocalStorageAdapter).remove(asset.objectKey);
    });
    await attempt("APP", async () => { if (app) await app.close(); });
    await attempt("UPSTREAM", () => closeServer(server));
    if (transport && originalTransport) {
      if (transportDescriptor) Object.defineProperty(transport, "request", transportDescriptor);
      else delete transport.request;
    }
    cookies.clear();
    await attempt("DIRECTORY", async () => { if (storageRoot) { ignored(storageRoot); await rm(storageRoot, { recursive: true, force: true }); } });
    let applicationPools = null;
    await attempt("POOLS", async () => {
      if (!lease?.ready) return;
      applicationPools = await withDatabase("test", readDatabaseEnvironment("test", previousEnvironment, lease.id), async client => {
        const { rows: [row] } = await client.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [lease.database]);
        return row.count;
      }, { acceptanceId: lease.id });
      if (applicationPools !== 0) fail("AF142_APPLICATION_POOLS_REMAIN");
    });
    if (Logger && loggerState) {
      Logger.staticInstanceRef = loggerState.instance;
      Logger.logLevels = loggerState.levels;
      Logger.logBuffer = loggerState.buffer;
      Logger.isBufferAttached = loggerState.attached;
    }
    replaceEnvironment(previousEnvironment); occupied = false; closed = true;
    if (lease) await attempt("EVIDENCE", () => writeEvidence("closed", { task: liveTask, acceptanceId: lease.id, database: lease.database,
      status: failures.length ? "CLEANUP_FAILED" : "CLOSED", applicationPools, failedSteps: failures.slice(), upstreamCalls, rejectedTransports }));
    if (failures.length) fail("AF142_CLEANUP_FAILED_" + failures.join("_"));
  }
  try {
    // No bypass: root must register AF-142 in the existing shared allowlists.
    lease = await createAcceptance("test", liveTask);
    stage = "MIGRATION";
    for (const action of ["deploy", "status"]) {
      if ((await migrate({ mode: "test", action, acceptanceId: lease.id })).exitCode !== 0) fail("AF142_MIGRATION_REJECTED");
    }
    stage = "CLIENT_FIXTURE";
    fixture = await prepareClientFixture(lease.id, liveTask, { configuration: true, secrets: true, runtimeManagement: true });
    ignored(lease.ownershipFile); ignored(fixture.accounts[0].initialPasswordFile); ignored(fixture.seed.credentials.file);
    storageRoot = join(repositoryRoot, ".local-data/" + task.toLowerCase().replace("-", ""), lease.id, "aij-foundation/test/storage");
    await privateDirectory(storageRoot);
    const values = clientEnvironment(lease.id, liveTask);
    // This fixture process only. Worker timers stay off: root explicitly pumps jobs.
    replaceEnvironment({ ...values, ASYNC_RUNTIME_ENABLED: "false", STORAGE_ENABLED: "true", LOCAL_STORAGE_ROOT: storageRoot,
      ENABLED_PLUGINS: "aij-ai", AI_CENTER_CLIENT_EXECUTION_ENABLED: "false", AI_CENTER_LIVE_ENABLED: "false" });
    stage = "APPLICATION";
    ({ Logger } = require("@nestjs/common"));
    loggerState = { instance: Logger.staticInstanceRef, levels: Logger.logLevels, buffer: Logger.logBuffer, attached: Logger.isBufferAttached };
    Logger.detachBuffer(); Logger.overrideLogger(false);
    const { createApplication } = requireApi("bootstrap.js");
    const { NestFactory } = require("@nestjs/core");
    const originalCreate = NestFactory.create;
    const createDescriptor = Object.getOwnPropertyDescriptor(NestFactory, "create");
    // Ensure a boot failure throws into cleanup instead of terminating root's
    // fixture host. This creation-only hook is restored even if bootstrap fails.
    NestFactory.create = async function (module, options) {
      app = await originalCreate.call(this, module, { ...options, abortOnError: false, logger: false });
      return app;
    };
    try { app = await createApplication({ testBrowserOrigin: browserOrigin }); }
    finally {
      if (createDescriptor) Object.defineProperty(NestFactory, "create", createDescriptor);
      else delete NestFactory.create;
    }
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    const { PrismaService } = requireApi("prisma/prisma.service.js");
    prisma = app.get(PrismaService);
    // Safe status-only assertion: never print raw response/credential/driver errors.
    const send = async (method, path, { token, cookie, workspaceId, body, status = 200, origin = browserOrigin } = {}) => {
      try {
        if (!/^(?:client\/|auth\/login$|admin\/ai\/center\/configuration$)/.test(path) || path.includes("..") || path.includes("#")) fail("AF142_REQUEST_PATH_REJECTED");
        const response = await fetch(baseUrl + "/" + path, { method, redirect: "error", signal: AbortSignal.timeout(15000), headers: {
          connection: "close", ...(token ? { authorization: "Bearer " + token } : {}), ...(cookie ? { cookie } : {}),
          ...(workspaceId ? { "x-aij-workspace-id": workspaceId } : {}), ...(origin ? { origin } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" })
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const data = await response.json().catch(() => null);
        evidence.push({ method, status: response.status });
        if (response.status !== status) fail(`AF142_HTTP_EXPECTED_${status}_GOT_${response.status}`);
        if (status < 400 && data?.success !== true) fail("AF142_HTTP_ENVELOPE_INVALID");
        return { response, data: data?.data ?? null };
      } catch (error) {
        if (typeof error?.message === "string" && /^AF142_[A-Z0-9_]+$/.test(error.message)) throw error;
        fail("AF142_HTTP_REQUEST_FAILED");
      }
    };
    stage = "AUTH_WORKSPACES";
    const secrets = JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile, "utf8"));
    const spaces = {};
    for (const [index, actor] of ["owner", "other"].entries()) {
      const account = fixture.accounts[index];
      const password = secrets.accounts.find(item => item.id === account.id)?.password;
      if (!password) fail("AF142_SYNTHETIC_ACCOUNT_MISSING");
      const login = await send("POST", "client/auth/login", { body: { email: account.email, password } });
      const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
      if (!cookie) fail("AF142_COOKIE_MISSING");
      cookies.set(actor, cookie);
      spaces[actor] = (await send("POST", "client/workspaces", { cookie, body: { name: `AF142 synthetic ${actor}`, idempotencyKey: `af142-space-${actor}` }, status: 201 })).data;
    }
    spaces.second = (await send("POST", "client/workspaces", { cookie: cookies.get("owner"), body: { name: "AF142 synthetic second space", idempotencyKey: "af142-space-second" }, status: 201 })).data;
    // Only this new lease's second synthetic member receives a read-only role.
    const grants = await prisma.clientWorkspacePermission.findMany({ where: { code: { in: ["workspace.context.read", "workspace.ai.read"] } }, select: { id: true } });
    if (grants.length !== 2) fail("AF142_READ_ROLE_DEFINITIONS_MISSING");
    const readRole = await prisma.clientWorkspaceRole.create({ data: { workspaceId: spaces.owner.id, code: "AF142_READER", name: "Synthetic AI reader",
      rolePermissions: { create: grants.map(grant => ({ permissionId: grant.id })) } } });
    await prisma.clientWorkspaceMembership.create({ data: { workspaceId: spaces.owner.id, memberId: fixture.accounts[1].id, roleId: readRole.id } });
    const project = await prisma.projectProfile.findFirstOrThrow();
    await prisma.pluginInstallation.upsert({ where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } },
      create: { projectId: project.id, pluginCode: "aij-ai", version: "0.1.0", owner: "@aij/api", status: "enabled", installedAt: new Date(), enabledAt: new Date() }, update: { status: "enabled" } });
    stage = "AI_SYNTHETIC_TRANSPORT";
    const ai = await prepareAiCenter({ prisma, seed: fixture.seed, request: send });
    server = createServer(async (req, res) => {
      try {
        if (req.method !== "POST" || !["/v1/chat/completions", "/v1/images/generations"].includes(req.url) || req.headers.authorization !== "Bearer " + ai.credential) fail("AF142_UPSTREAM_REQUEST_REJECTED");
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 65536) fail("AF142_UPSTREAM_BODY_TOO_LARGE"); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!Array.isArray(body.messages) && req.url !== "/v1/images/generations") fail("AF142_UPSTREAM_BODY_INVALID");
        upstreamCalls += 1;
        res.setHeader("content-type", "application/json");
        if (mode === "upstream-error") { res.writeHead(503); res.end("{}"); return; }
        if (req.url === "/v1/images/generations") {
          if (body.n !== 1 || body.output_format !== "png") fail("AF142_UPSTREAM_IMAGE_INVALID");
          res.end(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] })); return;
        }
        const json = body.messages.some(message => typeof message.content === "string" && message.content.includes("Return only a JSON object"));
        res.end(JSON.stringify({ model: body.model, choices: [{ finish_reason: "stop", message: { content: json ? '{"result":"Synthetic goal completed."}' : "Synthetic goal completed." } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 2 } } }));
      } catch { res.writeHead(503, { "content-type": "application/json" }); res.end("{}"); }
    });
    await new Promise((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
    const localOrigin = `http://127.0.0.1:${server.address().port}`;
    const { AiCenterHttpTransport } = requireApi("plugins/aij-ai/ai-center-provider.js");
    transport = app.get(AiCenterHttpTransport); originalTransport = transport.request;
    transportDescriptor = Object.getOwnPropertyDescriptor(transport, "request");
    transport.request = async (url, init) => {
      if (!["https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1/images/generations"].includes(url) || init?.redirect !== "error") {
        rejectedTransports += 1; fail("AF142_NON_SYNTHETIC_TRANSPORT_DENIED");
      }
      return fetch(localOrigin + new URL(url).pathname, { ...init, redirect: "error" });
    };
    stage = "AI_CONFIGURATION";
    const catalog = structuredClone(ai.catalog);
    catalog.skills = [];
    catalog.agents = [
      { code: "general-text", name: "Synthetic text task", modelCode: catalog.models[0].code, skillCodes: [], instructions: "Complete the supplied synthetic goal concisely.", inputFields: ["goal"], outputFormat: "text", outputFields: [], enabled: true, published: true, revision: 1 },
      { code: "general-json", name: "Synthetic JSON task", modelCode: catalog.models[0].code, skillCodes: [], instructions: "Complete the supplied synthetic goal.", inputFields: ["goal"], outputFormat: "json", outputFields: ["result"], enabled: true, published: true, revision: 1 },
      { code: "general-image", name: "Synthetic image task", modelCode: catalog.models[1].code, skillCodes: [], instructions: "Create an abstract illustration for the supplied synthetic goal.", inputFields: ["goal"], outputFormat: "text", outputFields: [], enabled: true, published: true, revision: 1 }
    ];
    for (const provider of catalog.providers) provider.liveEnabled = true;
    await ai.save(catalog);
    process.env.AI_CENTER_LIVE_ENABLED = "true"; process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = "true";
    const { JobService } = requireApi("async-runtime/job.service.js"); jobs = app.get(JobService);
    const pumpJobs = async (limit = 10) => {
      if (closed || closing || activePump) fail("AF142_PUMP_UNAVAILABLE");
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("AF142_PUMP_LIMIT_INVALID");
      activePump = (async () => {
        const executed = [];
        for (let count = 0; count < limit; count += 1) {
          const claims = await jobs.claim(`af142:${lease.id}`, 1, 60000);
          if (!claims.length) break;
          const claim = claims[0];
          if (claim.job_type !== "aij-ai.agent-execute" || claim.scope_id !== project.id) fail("AF142_UNEXPECTED_FIXTURE_JOB");
          await jobs.execute(claim); executed.push(claim.id);
        }
        return executed;
      })();
      try { return await activePump; } catch { fail("AF142_PUMP_FAILED"); } finally { activePump = undefined; }
    };
    const references = { acceptanceId: lease.id, database: lease.database, leaseFile: lease.ownershipFile,
      clientCredentialsFile: fixture.accounts[0].initialPasswordFile, adminCredentialsFile: fixture.seed.credentials.file };
    const workspaceIds = { primary: spaces.owner.id, second: spaces.second.id, other: spaces.other.id };
    const memberIds = { owner: fixture.accounts[0].id, other: fixture.accounts[1].id };
    const evidenceFile = await writeEvidence("fixture", { task: liveTask, ...references, status: "PREPARED", workspaceIds, memberIds, storageRoot });
    return {
      app, baseUrl, browserOrigin, lease: { id: lease.id, database: lease.database, ownershipFile: lease.ownershipFile }, references, evidenceFile, workspaceIds, memberIds,
      request(method, path, { actor = "owner", ...options } = {}) {
        if (closed || closing || (actor !== null && !cookies.has(actor))) fail("AF142_ACTOR_UNAVAILABLE");
        return send(method, path, { ...options, cookie: actor === null ? undefined : cookies.get(actor) });
      },
      async image({ runId, workspaceId = workspaceIds.primary, actor = "owner" }) {
        if (closed || closing || !/^[A-Za-z0-9_-]{1,128}$/.test(runId) || !cookies.has(actor)) fail("AF142_IMAGE_REQUEST_INVALID");
        try {
          const response = await fetch(`${baseUrl}/client/ai/runs/${runId}/image`, { redirect: "error", signal: AbortSignal.timeout(15000),
            headers: { connection: "close", cookie: cookies.get(actor), "x-aij-workspace-id": workspaceId } });
          const bytes = Buffer.from(await response.arrayBuffer());
          evidence.push({ method: "GET_IMAGE", status: response.status });
          return { status: response.status, contentType: response.headers.get("content-type"), bytes };
        } catch { fail("AF142_IMAGE_REQUEST_FAILED"); }
      },
      setMode(next) { if (closed || closing || !["success", "upstream-error"].includes(next)) fail("AF142_MODE_INVALID"); mode = next; },
      setExecutionEnabled(enabled) { if (closed || closing || typeof enabled !== "boolean") fail("AF142_EXECUTION_TOGGLE_INVALID"); process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = String(enabled); },
      async verifyTransportFence() {
        if (closed || closing) fail("AF142_TRANSPORT_PROBE_UNAVAILABLE");
        const before = upstreamCalls;
        try { await transport.request("https://api.openai.com/v1/not-permitted", { redirect: "error" }); }
        catch (error) { return error?.message === "AF142_NON_SYNTHETIC_TRANSPORT_DENIED" && upstreamCalls === before; }
        return false;
      },
      metrics: () => ({ upstreamCalls, rejectedTransports }), pumpJobs,
      async saveHttpEvidence(checks, runIds = []) {
        if (closed || closing || !Array.isArray(checks) || checks.some(check => !/^[A-Z0-9_]+$/.test(check)) ||
          !Array.isArray(runIds) || runIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) fail("AF142_EVIDENCE_INVALID");
        return writeEvidence("http", { task: liveTask, ...references, status: "HTTP_CHECKS_PASSED", checks, runIds, workspaceIds, memberIds, upstreamCalls, rejectedTransports, http: evidence });
      },
      close
    };
  } catch {
    let cleanupFailed = false;
    try { await close(); } catch { cleanupFailed = true; }
    fail(`AF142_PREPARE_${stage}_FAILED${cleanupFailed ? "_CLEANUP_FAILED" : ""}`);
  }
}
