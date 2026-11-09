// AF-012 / F00 M19: minimal bootstrap, adapted from source seed's bcrypt/unique-key pattern.
// No original seed execution, menu reconciliation, business defaults or credential reset.
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { acceptanceRecord, assertLocalPath, DatabaseOperationError, profile, readDatabaseEnvironment, repositoryRoot, resolveDatabaseTarget, withDatabase } from "./connection.mjs";
import { migrate } from "./migration.mjs";
import adminPolicy from "../admin-policy.cjs";
import rbacPolicy from "../rbac-policy.cjs";
import menuPolicy from "../menu-policy.cjs";
import dictionaryPolicy from "../dictionary-policy.cjs";
import configurationPolicy from "../configuration-policy.cjs";
import secretPolicy from "../secret-policy.cjs";
import auditPolicy from "../audit-policy.cjs";
import filePolicy from "../file-policy.cjs";
import runtimePolicy from "../runtime-policy.cjs";
import pluginPolicy from "../plugin-policy.cjs";
import clientDirectoryPolicy from "../client-directory-policy.cjs";
import integrationPolicy from "../integration-policy.cjs";
import paymentAdminPolicy from "../payment-admin-policy.cjs";
import basePolicy from "../base-policy.cjs";
import { paths as basePaths, profile as baseProfile, readLocalState, assertPath } from "../base-development/config.mjs";
import { localDocker, inspectResources } from "../base-development/docker.mjs";
import { migrateBase, withBaseDatabase } from "../base-development/database.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const bcrypt = require("bcryptjs");
export const seedIdentity = Object.freeze({ username: "aij-admin", roleCode: "aij_bootstrap_admin", permissionCode: "aij.bootstrap.admin" });
export class SeedError extends DatabaseOperationError {
  constructor(code, message) { super(message, 2); this.code = code; }
}
const reject = (code, message) => { throw new SeedError(code, message); };

export function seedArguments(args) {
  if (args.filter(a => a === "--").length > 1) reject("ARGUMENTS", "Only one optional -- separator is allowed");
  const [mode, ...flags] = args.filter(a => a !== "--"); profile(mode);
  let acceptanceId, generateCredentials = false, adminUsers = false, rbacManagement = false, menuManagement = false, dictionaries = false, configuration = false, secrets = false, auditLogs = false, fileManagement = false, runtimeManagement = false, pluginManagement = false, integrationManagement = false, clientManagement = false, clientSessionManagement = false, paymentManagement = false, aiCenter = false;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--acceptance" && acceptanceId === undefined && /^[a-f0-9]{16}$/.test(flags[i + 1] || "")) acceptanceId = flags[++i];
    else if (flags[i] === "--generate-credentials" && !generateCredentials) generateCredentials = true;
    else if (flags[i] === "--admin-users" && !adminUsers) adminUsers = true;
    else if (flags[i] === "--rbac-management" && !rbacManagement) rbacManagement = true;
    else if (flags[i] === "--menus" && !menuManagement) menuManagement = true;
    else if (flags[i] === "--dictionaries" && !dictionaries) dictionaries = true;
    else if (flags[i] === "--audit-logs" && !auditLogs) auditLogs = true;
    else if (flags[i] === "--files" && !fileManagement) fileManagement = true;
    else if (flags[i] === "--ai-center" && !aiCenter) aiCenter = true;
    else if (flags[i] === "--runtime" && !runtimeManagement) runtimeManagement = true;
    else if (flags[i] === "--plugin-management" && !pluginManagement) pluginManagement = true;
    else if (flags[i] === "--integration-management" && !integrationManagement) integrationManagement = true;
    else if (flags[i] === "--client-management" && !clientManagement) clientManagement = true;
    else if (flags[i] === "--client-session-management" && !clientSessionManagement) clientSessionManagement = true;
    else if (flags[i] === "--payment-management" && !paymentManagement) paymentManagement = true;
    else if (flags[i] === "--secrets" && !secrets) secrets = true;
    else if (flags[i] === "--configuration" && !configuration) configuration = true;
    else reject("ARGUMENTS", "Usage: db:seed -- dev|test [--acceptance ID] [--generate-credentials] [--admin-users] [--rbac-management] [--menus] [--dictionaries] [--configuration] [--secrets] [--audit-logs] [--files] [--runtime] [--plugin-management] [--integration-management] [--client-management] [--client-session-management] [--payment-management] [--ai-center]");
  }
  return { mode, acceptanceId, generateCredentials, ...(aiCenter ? { aiCenter: true } : {}), ...(adminUsers ? { adminUsers: true } : {}), ...(rbacManagement ? { rbacManagement: true } : {}), ...(menuManagement ? { menuManagement: true } : {}), ...(dictionaries ? { dictionaries: true } : {}), ...(configuration ? { configuration: true } : {}), ...(secrets ? { secrets: true } : {}), ...(auditLogs ? { auditLogs: true } : {}), ...(fileManagement ? { fileManagement: true } : {}), ...(runtimeManagement ? { runtimeManagement: true } : {}), ...(pluginManagement ? { pluginManagement: true } : {}), ...(integrationManagement ? { integrationManagement: true } : {}), ...(clientManagement ? { clientManagement: true } : {}), ...(clientSessionManagement ? { clientSessionManagement: true } : {}), ...(paymentManagement ? { paymentManagement: true } : {}) };
}

export function validateInitialPassword(value) {
  if (!adminPolicy.isAdminPassword(value)) {
    reject("CREDENTIAL_INVALID", "AIJ_INITIAL_ADMIN_PASSWORD must be a non-template 20+ character, at most 72 UTF-8 byte secret with three character classes and no whitespace");
  }
  return value;
}
function credentialPath(mode, target) {
  const path = join(repositoryRoot, ".local-data/seed", mode, target.database, "initial-admin.json");
  assertLocalPath(path);
  try { execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", path], { cwd: repositoryRoot, stdio: "ignore" }); }
  catch { reject("CREDENTIAL_PATH", "Initial credential file must be Git-ignored"); }
  return path;
}
function credentials(mode, target, input, generate, projectScope) {
  const path = projectScope?.path || credentialPath(mode, target);
  assertLocalPath(path);
  if (projectScope) {
    assertPath(path, { restricted: true });
    try { execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", path], { cwd: repositoryRoot, stdio: "ignore" }); }
    catch { reject("CREDENTIAL_PATH", "Initial credential file must be Git-ignored"); }
  }
  if (!projectScope) assertLocalPath(profile(mode).stateFile);
  const owner = projectScope?.owner || JSON.parse(readFileSync(profile(mode).stateFile, "utf8"));
  if (Object.hasOwn(input, "AIJ_INITIAL_ADMIN_PASSWORD")) {
    if (generate) reject("CREDENTIAL_INPUT_CONFLICT", "Choose an explicit initial secret or local generation");
    return { password: validateInitialPassword(input.AIJ_INITIAL_ADMIN_PASSWORD), source: "dedicated-variable", path: null };
  }
  if (existsSync(path)) {
    let saved;
    try { saved = JSON.parse(readFileSync(path, "utf8")); }
    catch { reject("CREDENTIAL_FILE", "Initial credential file is unreadable; no overwrite"); }
    if (saved.version !== 1 || saved.repository !== repositoryRoot || saved.mode !== mode || saved.database !== target.database ||
        saved.instanceId !== owner.instanceId || saved.username !== seedIdentity.username) reject("CREDENTIAL_OWNER", "Initial credential file does not match this target; no overwrite");
    return { password: validateInitialPassword(saved.password), source: "local-initial-file", path };
  }
  if (!generate) reject("CREDENTIAL_MISSING", "Provide AIJ_INITIAL_ADMIN_PASSWORD or explicitly generate local credentials; no default password");
  return { password: null, source: "generated-local", path, owner };
}
function saveGenerated(request, mode, target) {
  const password = "A7-" + randomBytes(32).toString("hex");
  validateInitialPassword(password);
  const record = { version: 1, repository: repositoryRoot, mode, database: target.database, instanceId: request.owner.instanceId,
    username: seedIdentity.username, password, createdAt: new Date().toISOString(), scope: "initial-only; not a current-password guarantee after manual changes" };
  assertLocalPath(request.path);
  mkdirSync(join(request.path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(request.path, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  request.password = password;
}
async function createProject(client, mode, baseDevelopment = false, aiLocalDevelopment = false) {
  const suffix = baseDevelopment || aiLocalDevelopment || mode === "dev" ? "development" : "test";
  const orgCode = aiLocalDevelopment ? "aij-ai-local-development-org" : baseDevelopment ? "aij-base-dev-" + suffix + "-org" : "aij-foundation-" + suffix + "-org";
  const projectCode = aiLocalDevelopment ? "aij-ai-local-development" : baseDevelopment ? baseProfile.project + "-" + suffix : "aij-foundation-" + suffix;
  const inserted = await client.query("INSERT INTO public.organization_profile (id,code,name,updated_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING RETURNING id", [randomUUID(), orgCode, baseDevelopment ? "AIJ Base 开发组织" : "AIJ 合成组织"]);
  const organizationId = inserted.rows[0]?.id || (await client.query("SELECT id FROM public.organization_profile WHERE code=$1", [orgCode])).rows[0].id;
  const project = await client.query("INSERT INTO public.project_profile (id,organization_id,code,name,environment,updated_at) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING RETURNING id", [randomUUID(), organizationId, projectCode, baseDevelopment ? "AIJ Base 开发项目" : "AIJ 合成项目", suffix]);
  if (baseDevelopment || aiLocalDevelopment) {
    const current = (await client.query("SELECT organization_id,environment FROM public.project_profile WHERE code=$1", [projectCode])).rows[0];
    if (current.organization_id !== organizationId || current.environment !== suffix) reject("PROJECT_NAMESPACE_OCCUPIED", "Base project namespace occupied; no overwrite");
  }
  return { organizationCode: orgCode, projectCode, organizationCreated: inserted.rowCount === 1, projectCreated: project.rowCount === 1 };
}
async function createAdmin(client, request, mode, target) {
  const existing = await client.query("SELECT id FROM public.sys_user WHERE username=$1", [seedIdentity.username]);
  if (existing.rowCount) {
    if (!request.password) reject("CREDENTIAL_GENERATION_EXISTING_ADMIN", "Administrator already exists; generation cannot set or recover its password");
    return { action: "preserved", rolesTouched: false };
  }
  const collision = await client.query("SELECT EXISTS(SELECT 1 FROM public.sys_role WHERE role_code=$1) OR EXISTS(SELECT 1 FROM public.sys_permission WHERE permission_code=$2) AS occupied", [seedIdentity.roleCode, seedIdentity.permissionCode]);
  if (collision.rows[0].occupied) reject("RBAC_NAMESPACE_OCCUPIED", "Reserved bootstrap RBAC namespace is already occupied; no adoption or reconciliation");
  // Persist a generated secret before committing its account. A failed transaction may leave
  // this ignored initial-only file for retry; it never implies the account exists or was reset.
  if (!request.password) saveGenerated(request, mode, target);
  const passwordHash = await bcrypt.hash(request.password, adminPolicy.ADMIN_PASSWORD_COST);
  const userId = randomUUID(), roleId = randomUUID(), permissionId = randomUUID();
  await client.query("INSERT INTO public.sys_permission (id,permission_code,permission_name,resource_type,module,action,updated_at) VALUES ($1,$2,$3,'data','core','bootstrap',CURRENT_TIMESTAMP)", [permissionId, seedIdentity.permissionCode, "AIJ 初始化管理员标识"]);
  await client.query("INSERT INTO public.sys_role (id,role_code,role_name,data_scope,updated_at) VALUES ($1,$2,$3,'all',CURRENT_TIMESTAMP)", [roleId, seedIdentity.roleCode, "AIJ 初始管理员"]);
  await client.query("INSERT INTO public.sys_user (id,username,password_hash,real_name,is_super_admin,updated_at) VALUES ($1,$2,$3,$4,true,CURRENT_TIMESTAMP)", [userId, seedIdentity.username, passwordHash, "AIJ 初始管理员"]);
  await client.query("INSERT INTO public.sys_role_permission (id,role_id,permission_id) VALUES ($1,$2,$3)", [randomUUID(), roleId, permissionId]);
  await client.query("INSERT INTO public.sys_user_role (id,user_id,role_id) VALUES ($1,$2,$3)", [randomUUID(), userId, roleId]);
  return { action: "created", rolesTouched: true };
}

async function registerDefinition(client, definition) {
  const inserted = await client.query("INSERT INTO public.sys_permission (id,permission_code,permission_name,resource_type,module,action,api_path,updated_at) VALUES ($1,$2,$3,'api','core',$4,$5,CURRENT_TIMESTAMP) ON CONFLICT (permission_code) DO NOTHING RETURNING id", [randomUUID(), definition.code, definition.name, definition.action, definition.path]);
  const current = (await client.query("SELECT resource_type,module,action,api_path FROM public.sys_permission WHERE permission_code=$1", [definition.code])).rows[0];
  if (current.resource_type !== "api" || current.module !== "core" || current.action !== definition.action || current.api_path !== definition.path) reject("PERMISSION_NAMESPACE_OCCUPIED", "Management permission namespace is occupied; no overwrite");
  return { code: definition.code, created: inserted.rowCount === 1, grantsReconciled: false };
}
export async function seedDatabase({ mode, acceptanceId, generateCredentials = false, adminUsers = false, rbacManagement = false, menuManagement = false, dictionaries = false, configuration = false, secrets = false, auditLogs = false, fileManagement = false, runtimeManagement = false, pluginManagement = false, integrationManagement = false, clientManagement = false, clientSessionManagement = false, paymentManagement = false, aiCenter = false }, input = process.env) {
  if (aiCenter) { configuration = true; secrets = true; runtimeManagement = true; }
  profile(mode);
  const values = readDatabaseEnvironment(mode, input, acceptanceId);
  const target = resolveDatabaseTarget(mode, values, acceptanceId);
  if ((values.RUNTIME_PROFILE || "host") !== "host" || (values.PROJECT_ID || "aij-foundation") !== "aij-foundation") reject("PROJECT_IDENTITY", "This seed only owns the aij-foundation host");
  if (acceptanceId && !["AF-012", "AF-013", "AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-025-A", "AF-026", "AF-027", "AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-039", "AF-040", "AF-041", "AF-042", "AF-043", "AF-044", "AF-045", "AF-046", "AF-047", "AF-048", "AF-049", "AF-050", "AF-051", "AF-052", "AF-053", "AF-054", "AF-055", "AF-056", "AF-057", "AF-058", "AF-063", "AF-068", "AF-069", "AF-070", "AF-071", "AF-072", "AF-081", "AF-082", "AF-083", "AF-084", "AF-085", "AF-086", "AF-087", "AF-088", "AF-089", "AF-090", "AF-092", "AF-093", "AF-094", "AF-095", "AF-096", "AF-097", "AF-098", "AF-099", "AF-100", "AF-101", "AF-102", "AF-104", "AF-105", "AF-106", "AF-107", "AF-108", "AF-109", "AF-110", "AF-111", "AF-112", "AF-113", "AF-114", "AF-115", "AF-116", "AF-118", "AF-119", "AF-120", "AF-121", "AF-122", "AF-123", "AF-124", "AF-138", "AF-141", "AF-142", "AF-145", "AF-146", "AF-151", "AF-149", "AF-150", "AF-154", "AF-158", "AF-159", "AF-161", "AF-162", "AF-163", "AF-166", "AF-165", "AF-167", "AF-170", "AF-169", "AF-173", "AF-177", "AF-178", "AF-179", "AF-181", "AF-182", "AF-189", "AF-190", "AF-198", "AF-201", "AF-202", "AF-203", "AF-205", "AF-206", "AF-207", "AF-209", "AF-210", "AF-211", "AF-214", "AF-215", "AF-191", "AF-221", "AF-223", "AF-224", "AF-225", "AF-227", "AF-228", "AF-229", "AF-232", "AF-213", "AF-218", "AF-217", "AF-157", "AF-155"].includes(acceptanceRecord(mode, acceptanceId).task)) reject("ACCEPTANCE_TASK", "Seed requires a registered Seed/auth acceptance database");
  const request = credentials(mode, target, values, generateCredentials); // Missing/template inputs fail before any connection.
  await migrate({ mode, action: "status", acceptanceId }, input); // Includes managed preflight, actual identity/checksum/pending checks. No deploy.
  return withDatabase(mode, values, async (client, checkedTarget, identity) => {
    return seedTransaction(client, checkedTarget, identity, { mode, target, request, adminUsers, rbacManagement, menuManagement, dictionaries, configuration, secrets, auditLogs, fileManagement, runtimeManagement, pluginManagement, integrationManagement, clientManagement, clientSessionManagement, paymentManagement, aiCenter });
  }, { acceptanceId });
}

// Shared initializer owner: project tools only supply an authenticated, validated target.
async function seedTransaction(client, checkedTarget, identity, { mode, target, request, adminUsers, rbacManagement, menuManagement, dictionaries, configuration, secrets, auditLogs, fileManagement, runtimeManagement, pluginManagement, integrationManagement, clientManagement, clientSessionManagement, paymentManagement, aiCenter, baseDevelopment = false, aiLocalDevelopment = false }) {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('aij-foundation-seed'),hashtext(current_database()))");
      const project = await createProject(client, mode, baseDevelopment, aiLocalDevelopment);
      const capability = adminUsers ? await registerDefinition(client, { code: adminPolicy.ADMIN_USERS_PERMISSION, name: "AIJ 管理员基础管理", action: "manage-admin-users", path: "/api/admin/users" }) : undefined;
      const rbac = []; if (rbacManagement) for (const definition of rbacPolicy.RBAC_DEFINITIONS) rbac.push(await registerDefinition(client, definition));
      const menu = menuManagement ? await registerDefinition(client, menuPolicy.MENU_DEFINITION) : undefined;
      if (baseDevelopment || dictionaries) await registerDefinition(client, dictionaryPolicy.DICTIONARY_READ_DEFINITION);
      const dictionary = dictionaries ? await registerDefinition(client, dictionaryPolicy.DICTIONARY_DEFINITION) : undefined;
      // Configuration secret-ref writes explicitly depend on the secret-management catalog definition.
      const secret = secrets || configuration ? await registerDefinition(client, secretPolicy.SECRET_DEFINITION) : undefined;
      const audit = auditLogs ? await registerDefinition(client, auditPolicy.AUDIT_DEFINITION) : undefined;
      const files = fileManagement ? await registerDefinition(client, filePolicy.FILE_READ_DEFINITION) : undefined;
      const runtime = runtimeManagement ? await Promise.all(runtimePolicy.RUNTIME_DEFINITIONS.map(definition => registerDefinition(client, definition))) : undefined;
      const plugins = pluginManagement ? await registerDefinition(client, pluginPolicy.PLUGIN_MANAGEMENT_DEFINITION) : undefined;
      const integrations = integrationManagement ? await registerDefinition(client, integrationPolicy.INTEGRATION_MANAGEMENT_DEFINITION) : undefined;
      const clientDirectory = clientManagement ? await registerDefinition(client, clientDirectoryPolicy.CLIENT_DIRECTORY_READ_DEFINITION) : undefined;
      const clientSessions = clientSessionManagement ? await registerDefinition(client, clientDirectoryPolicy.CLIENT_SESSION_REVOKE_DEFINITION) : undefined;
      const paymentAdmin = paymentManagement ? await Promise.all(paymentAdminPolicy.PAYMENT_ADMIN_DEFINITIONS.map(definition => registerDefinition(client, definition))) : undefined;
      const config = configuration ? await registerDefinition(client, configurationPolicy.CONFIGURATION_DEFINITION) : undefined;
      const baseMenus = baseDevelopment || aiLocalDevelopment ? await registerBaseMenus(client) : [];
      const aiMenus = [];
      if (aiCenter) for (const [path, title, permission, order] of [
        ["/auth/ai/center", "AI 中心", configurationPolicy.CONFIGURATION_PERMISSION, 60],
        ["/auth/ai/usage", "AI 用量与预算", runtimePolicy.RUNTIME_READ_PERMISSION, 61]
      ]) {
        const existing = (await client.query("SELECT plugin_code,permission_code FROM public.sys_menu WHERE path=$1", [path])).rows[0];
        if (existing && (existing.plugin_code !== "aij-ai" || existing.permission_code !== permission)) reject("MENU_NAMESPACE_OCCUPIED", "AI center menu namespace occupied; no overwrite");
        const inserted = await client.query("INSERT INTO public.sys_menu (id,title,path,type,permission_code,plugin_code,sort_order,updated_at) VALUES ($1,$2,$3,'menu',$4,'aij-ai',$5,CURRENT_TIMESTAMP) ON CONFLICT (path) DO NOTHING RETURNING id", [randomUUID(),title,path,permission,order]);
        aiMenus.push({path,created:inserted.rowCount===1});
      }
      const admin = await createAdmin(client, request, mode, target);
      await client.query("COMMIT");
      return { status: "SEEDED", target: checkedTarget, identity, ...project, username: seedIdentity.username, admin,
        credentials: { source: request.source, file: request.path, scope: "initial-only; existing passwords and role assignments are preserved" },
        menusCreated: [...aiMenus, ...baseMenus].filter(m => m.created).length, ...(baseDevelopment ? { baseDevelopment: { menus: baseMenus, grantsReconciled: false } } : {}), ...(aiCenter ? { aiCenter: { menus: aiMenus, grantsReconciled: false, pluginEnabled: false } } : {}), permission: "bootstrap marker; route authorization requires explicit server declarations", ...(capability ? { adminUsers: capability } : {}), ...(rbacManagement ? { rbacManagement: rbac } : {}), ...(menu ? { menuManagement: menu } : {}), ...(dictionaries ? { dictionaries: dictionary } : {}), ...(config ? { configuration: config } : {}), ...(secret ? { secrets: secret } : {}), ...(audit ? { auditLogs: audit } : {}), ...(files ? { files } : {}), ...(runtime ? { runtime } : {}), ...(plugins ? { pluginManagement: plugins } : {}), ...(integrations ? { integrationManagement: integrations } : {}), ...(clientDirectory ? { clientDirectory } : {}), ...(clientSessions ? { clientSessions } : {}), ...(paymentAdmin ? { paymentManagement: paymentAdmin } : {}) };
    } catch (error) { await client.query("ROLLBACK"); throw error; }

}

export async function registerBaseMenus(client) {
  const menus = [];
  for (const definition of basePolicy.BASE_DEVELOPMENT_MENUS) {
    const { path, title, permission, order } = definition;
    const inserted = await client.query("INSERT INTO public.sys_menu (id,title,path,type,permission_code,sort_order,updated_at) VALUES ($1,$2,$3,'menu',$4,$5,CURRENT_TIMESTAMP) ON CONFLICT (path) DO NOTHING RETURNING id", [randomUUID(), title, path, permission, order]);
    const existing = (await client.query("SELECT type,plugin_code,permission_code FROM public.sys_menu WHERE path=$1", [path])).rows[0];
    if (!existing || existing.type !== "menu" || existing.plugin_code !== null || existing.permission_code !== permission) reject("MENU_NAMESPACE_OCCUPIED", "Base menu namespace occupied; existing record preserved");
    menus.push({ path, created: inserted.rowCount === 1 });
  }
  return menus;
}

export async function seedBaseDevelopment() {
  const { owner, values, runtime } = readLocalState();
  if (!inspectResources(localDocker(owner), owner)?.State.Running) reject("PROJECT_DATABASE", "Owned Base database must be running before initialization");
  const target = runtime.databaseTarget;
  const request = credentials("base-development", target, values, true, { path: basePaths.credentials, owner });
  await migrateBase(values, "status");
  return withBaseDatabase(values, (client, checkedTarget, identity) => seedTransaction(client, checkedTarget, identity, {
    mode: "base-development", target, request, baseDevelopment: true, adminUsers: true, rbacManagement: true, dictionaries: true, auditLogs: true
  }));
}

// AF220: reuse the seed owner only after the exact persistent AI target and
// Docker ownership have been checked. Host/test/Base entry points stay separate.
export async function seedAiLocalDevelopment() {
  const config = await import("../ai-local-development/config.mjs");
  const docker = await import("../ai-local-development/docker.mjs");
  const database = await import("../ai-local-development/database.mjs");
  const { owner, values, runtime } = config.readLocalState();
  if (!docker.inspectResources(docker.localDocker(owner), owner)?.State.Running) reject("PROJECT_DATABASE", "Owned AI local database must be running");
  const target = runtime.databaseTarget;
  const request = credentials("ai-local-development", target, values, true, { path: config.paths.credentials, owner });
  await database.migrateAiLocal(values, "status");
  const seeded = await database.withAiLocalDatabase(values, (client, checkedTarget, identity) => seedTransaction(client, checkedTarget, identity, {
    mode: "ai-local-development", target, request, aiLocalDevelopment: true,
    adminUsers: true, rbacManagement: true, menuManagement: true, dictionaries: true, auditLogs: true,
    configuration: true, secrets: true, fileManagement: true, runtimeManagement: true, pluginManagement: true,
    integrationManagement: true, clientManagement: true, clientSessionManagement: true, aiCenter: true
  }));
  const credentialFile = join(config.profile.directory, "initial-clients.json");
  config.assertPath(credentialFile, { restricted: true });
  const members = await database.withAiLocalDatabase(values, async client => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('aij-foundation-seed'),hashtext(current_database()))");
      let saved;
      if (existsSync(credentialFile)) {
        try { saved = JSON.parse(readFileSync(credentialFile, "utf8")); }
        catch { reject("CLIENT_CREDENTIAL_FILE", "Initial client credentials unreadable; no overwrite"); }
      } else {
        const names = Array.from({ length: 5 }, (_, i) => "aij-local-" + (i + 1));
        const emails = names.map(name => name + "@example.test");
        const occupied = await client.query("SELECT count(*)::int AS n FROM public.member_user WHERE username=ANY($1) OR email=ANY($2)", [names, emails]);
        if (occupied.rows[0].n !== 0) reject("CLIENT_NAMESPACE_OCCUPIED", "Local client namespace already exists without its owner; no adoption");
        saved = { version: 1, repository: repositoryRoot, instanceId: owner.instanceId, database: target.database,
          scope: "initial-only; manually changed credentials and grants are preserved",
          accounts: names.map((username, i) => ({ id: randomUUID(), username, email: emails[i], nickname: "AIJ Local " + (i + 1), password: "C9-" + randomBytes(32).toString("hex") })) };
        config.writePrivate(credentialFile, saved, { exclusive: true });
      }
      if (saved?.version !== 1 || saved.repository !== repositoryRoot || saved.instanceId !== owner.instanceId || saved.database !== target.database ||
          !Array.isArray(saved.accounts) || saved.accounts.length !== 5) reject("CLIENT_CREDENTIAL_OWNER", "Local client credential owner differs; no overwrite");
      const result = [];
      for (const [i, account] of saved.accounts.entries()) {
        if (!/^[a-f0-9-]{36}$/.test(account.id || "") || account.username !== "aij-local-" + (i + 1) || account.email !== account.username + "@example.test" ||
            typeof account.nickname !== "string") reject("CLIENT_CREDENTIAL_OWNER", "Local client identity differs; no adoption");
        validateInitialPassword(account.password);
        const rows = (await client.query("SELECT id,username,email FROM public.member_user WHERE id=$1 OR username=$2 OR email=$3", [account.id, account.username, account.email])).rows;
        if (rows.length && (rows.length !== 1 || rows[0].id !== account.id || rows[0].username !== account.username || rows[0].email !== account.email)) reject("CLIENT_NAMESPACE_OCCUPIED", "Local client namespace differs; no overwrite");
        if (!rows.length) await client.query("INSERT INTO public.member_user (id,username,email,nickname,password_hash,updated_at) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)", [account.id, account.username, account.email, account.nickname, await bcrypt.hash(account.password, adminPolicy.ADMIN_PASSWORD_COST)]);
        result.push({ id: account.id, username: account.username, email: account.email, created: !rows.length });
      }
      await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  return { ...seeded, members, clientCredentialFile: credentialFile };
}
