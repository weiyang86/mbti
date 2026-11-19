// Private init child: real original owners, no fixture or alternate business ledger.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { seedAiLocalDevelopment } from "../database/seed.mjs";
import { withAiLocalDatabase } from "./database.mjs";
import { readLocalState, profile, root, writePrivate } from "./config.mjs";

const state = readLocalState();
const progress = stage => writePrivate(join(profile.directory, "initialization-progress.json"), { stage, at: new Date().toISOString() });
process.on("uncaughtExceptionMonitor", error => writePrivate(join(profile.directory, "initialization-failure.json"), {
  code: typeof error?.code === "string" && /^[A-Z0-9_]{2,60}$/.test(error.code) ? error.code : "INITIALIZER_FAILED",
  frames: String(error?.stack ?? "").split("\n").filter(line => /^\s+at /.test(line)).slice(0, 8)
}));
assert.equal(process.cwd(), root);
assert.equal(process.env.AIJ_RUNTIME_ENV_SOURCE, "explicit");
assert.deepEqual(Object.fromEntries(Object.keys(state.values).map(key => [key, process.env[key]])), state.values);
progress("SEED"); const seeded = await seedAiLocalDevelopment();
const require = createRequire(join(root, "apps/api/package.json"));
const original = path => require(join(profile.apiOutput, path));
const { Logger } = require("@nestjs/common"); Logger.overrideLogger(false);
const { createApplication } = original("bootstrap.js");
const { PrismaService } = original("prisma/prisma.service.js");
const { ClientWorkspaceManagementService } = original("client-workspaces/client-workspace-management.service.js");
const { PluginCatalog } = original("plugin-runtime/plugin-catalog.js");
const { PluginLifecycleService } = original("plugin-runtime/plugin-lifecycle.service.js");
let app, prisma, receipt;
try {
  progress("APPLICATION"); app = await createApplication(); await app.init(); prisma = app.get(PrismaService);
  assert.equal((await prisma.readiness()).ready, true);
  const project = await prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-ai-local-development" } });
  progress("WORKSPACES"); const workspaces = [], service = app.get(ClientWorkspaceManagementService);
  for (const [i, member] of seeded.members.entries()) {
    const key = "aij-local-initial-space-" + (i + 1);
    const existing = await prisma.clientWorkspace.findUnique({ where: { createdByMemberId_creationIdempotencyKey: { createdByMemberId: member.id, creationIdempotencyKey: key } } });
    // Preserve manual names/status/roles/grants; initialization is not reconciliation.
    const workspace = existing ?? await service.createWorkspace(member.id, { name: "AIJ Local " + (i + 1), idempotencyKey: key }, "aij-ai-local-init");
    workspaces.push({ memberId: member.id, workspaceId: workspace.id, created: !existing });
  }
  progress("PLUGIN"); const installation = await prisma.pluginInstallation.findUnique({ where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } } });
  if (!installation) {
    const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: "aij-admin" } });
    const lifecycle = app.get(PluginLifecycleService), catalog = app.get(PluginCatalog);
    await lifecycle.install("aij-ai", catalog.manifest("aij-ai").version, admin.id, "aij-ai-local-init-install");
    await lifecycle.enable("aij-ai", admin.id, "aij-ai-local-init-enable");
  }
  receipt = { version: 1, repository: root, instanceId: state.owner.instanceId, projectId: project.id, workspaces,
    vendorLive: false, documentExport: false, initializedAt: new Date().toISOString() };
} finally { await app?.close(); await prisma?.$disconnect(); }
const pools = await withAiLocalDatabase(state.values, async client => (await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()")).rows[0].n);
assert.equal(pools, 0);
writePrivate(join(profile.directory, "initialization.json"), { ...receipt, applicationPools: pools });
progress("INITIALIZED");
process.stdout.write(JSON.stringify({ status: "INITIALIZED", members: seeded.members.length, applicationPools: pools }) + "\n");
