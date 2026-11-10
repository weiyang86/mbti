import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { Module, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import type { AuditLog, ConfigurationChange, PluginInstallation, PluginOperation, ScopedConfig } from "@prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { ManagementAccessService } from "../src/rbac/management-access.service";
import { PermissionsService } from "../src/rbac/permissions.service";
import { PluginRuntimeAccessService } from "../src/plugin-runtime/plugin-runtime-access.service";
import { PluginLifecycleService } from "../src/plugin-runtime/plugin-lifecycle.service";
import { PluginCatalog } from "../src/plugin-runtime/plugin-catalog";
import { PluginRuntimeModule, resolvePluginModules } from "../src/plugin-runtime/plugin-runtime.module";
import { TRUSTED_PLUGINS } from "../src/plugin-runtime/trusted-plugins";
import { PluginEnabledGuard } from "../src/plugin-runtime/plugin-enabled.guard";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../src/common/guards/permissions.guard";
import { projectAudit } from "../src/audit-log/audit-redaction";
import { MbtiConfigController } from "../src/plugins/mbti-config/mbti-config.controller";
import { MbtiConfigService } from "../src/plugins/mbti-config/mbti-config.service";
import { MBTI_CATEGORIES, canonical, emptySnapshot, projectSnapshot, validateCategory, validateSnapshot } from "../src/plugins/mbti-config/mbti-config.schema";
import { mbtiConfigManifest } from "../src/plugins/mbti-config/mbti-config.plugin";
import { assertRuntimeCapabilities } from "../../../scripts/runtime-environment.cjs";
import { LAUNCH_PLUGIN_CODES, assertLaunchPlugins, assertLaunchRegistryAlignment } from "../../../scripts/plugin-launch-codes.cjs";

const CONFIG = "admin.config.manage", SECRET = "admin.secret.manage", PLUGIN = "admin.plugin.manage";
const runtime = { getOrThrow(key: string) { const values: Record<string, string> = { projectId: "mbti-foundation", environment: "test", namespace: "mbti-test" }; return values[key]; } } as ConfigService;
const content = (headline: string) => ({ headline, accent: "当前阶段", sub: "了解自己", cta: "开始", moments: "生活", avatar: "形象", meet: "相遇", caption: "记录" });
type Query = { where?: Record<string, unknown>; data?: Record<string, unknown>; take?: number };
function matches(row: object, query: Record<string, unknown> = {}): boolean {
  const values = row as Record<string, unknown>;
  return Object.entries(query).every(([k, value]) => value && typeof value === "object" ?
    ("in" in value ? (value as { in: unknown[] }).in.includes(values[k]) : matches(values[k] as object, value as Record<string, unknown>)) : values[k] === value);
}
function fixture() {
  let state = { configs: [] as ScopedConfig[], changes: [] as ConfigurationChange[], audits: [] as AuditLog[], installations: [] as PluginInstallation[], operations: [] as PluginOperation[] };
  let tail = Promise.resolve(), seq = 0, fail = "", profileEnvironment = "test";
  const locks: unknown[] = [], profileQueries: unknown[] = [];
  const permissionsFor = (id: string) => id === "root" ? [CONFIG, SECRET, PLUGIN] : id === "editor" ? [CONFIG] : [];
  const db = {
    async readiness() { return { ready: true, reason: "READY" }; },
    auditLog: { async create(q: Query) { const row = { id: `synthetic-${++seq}`, createdAt: new Date(), ...q.data } as AuditLog; state.audits.push(row); return row; } },
    async $transaction<T>(work: (tx: object) => Promise<T>): Promise<T> {
      const previous = tail; let unlock!: () => void; tail = new Promise<void>(resolve => { unlock = resolve; }); await previous;
      const pending = structuredClone(state);
      const create = <T>(rows: T[], data: Record<string, unknown>): T => {
        const result = { id: `synthetic-${++seq}`, version: 1, status: "active", deletedAt: null, createdAt: new Date(), updatedAt: new Date(), installedAt: null, enabledAt: null, disabledAt: null, ...data } as T;
        rows.push(result); return result;
      };
      const tx = {
        async $executeRaw(...args: unknown[]) { locks.push(args); return 1; },
        projectProfile: { async findFirst(q: Query) { profileQueries.push(q); return matches({ code: "mbti-foundation-test", environment: profileEnvironment, status: "active", deletedAt: null, organization: { status: "active", deletedAt: null } }, q.where) ? { id: "project-test" } : null; } },
        sysUser: { async findFirst(q: Query) { const id = q.where?.id as string; return { id, isSuperAdmin: id === "root", userRoles: [{ role: { roleCode: id, permissions: permissionsFor(id).map(permissionCode => ({ permission: { permissionCode } })) } }] }; } },
        sysPermission: { async findMany() { return [CONFIG, SECRET, PLUGIN].map(permissionCode => ({ permissionCode })); } },
        scopedConfig: {
          async findUnique(q: Query) { return pending.configs.find(row => matches(row, (q.where?.scope_scopeId_pluginCode_configKey ?? q.where) as Record<string, unknown>)) ?? null; },
          async create(q: Query) { const data = q.data!; if (pending.configs.some(r => ["scope", "scopeId", "pluginCode", "configKey"].every(k => r[k as keyof ScopedConfig] === data[k]))) throw new Error("Unique scoped config"); return create(pending.configs, data); },
          async update(q: Query) { const row = pending.configs.find(row => matches(row, q.where)); if (!row) throw new Error("CAS mismatch"); const next = { ...q.data, ...(q.data?.version ? { version: row.version + 1 } : {}) }; Object.assign(row, next); return row; },
          async updateMany(q: Query) { if (fail === "cas") return { count: 0 }; const row = pending.configs.find(row => matches(row, q.where)); if (!row) return { count: 0 }; Object.assign(row, { ...q.data, version: row.version + 1 }); return { count: 1 }; }
        },
        configurationChange: {
          async create(q: Query) { if (fail === "change") throw new Error("Injected change failure"); const data = q.data!; if (pending.changes.some(r => r.configId === data.configId && r.configVersion === data.configVersion)) throw new Error("Unique version history"); return create(pending.changes, { status: "recorded", ...data }); },
          async findFirst(q: Query) { return pending.changes.find(row => matches(row, q.where)) ?? null; },
          async findMany(q: Query) { return pending.changes.filter(row => matches(row, q.where)).sort((a, b) => (b.configVersion ?? 0) - (a.configVersion ?? 0)).slice(0, q.take); }
        },
        auditLog: { async create(q: Query) { if (fail === "audit") throw new Error("Injected audit failure"); return create(pending.audits, q.data!); } },
        secretReference: { async findFirst(q: Query) { return q.where?.ref === "local://mbti-foundation/test/CANDIDATE_AI" ? { id: "metadata-only" } : null; } },
        pluginInstallation: {
          async findUnique(q: Query) { return pending.installations.find(row => matches(row, (q.where?.projectId_pluginCode ?? q.where) as Record<string, unknown>)) ?? null; },
          async findMany(q: Query) { return pending.installations.filter(row => matches(row, q.where)); },
          async create(q: Query) { return create(pending.installations, q.data!); },
          async update(q: Query) { const row = pending.installations.find(row => matches(row, q.where)); if (!row) throw new Error("No installation"); Object.assign(row, q.data); return row; }
        },
        pluginOperation: { async create(q: Query) { return create(pending.operations, q.data!); } }
      };
      try { const result = await work(tx); state = pending; return result; } finally { unlock(); }
    }
  } as unknown as PrismaService;
  const permissions = new PermissionsService(db), access = new ManagementAccessService(db, permissions), plugins = new PluginRuntimeAccessService(db, runtime);
  const catalog = new PluginCatalog(TRUSTED_PLUGINS), lifecycle = new PluginLifecycleService(db, access, runtime, catalog);
  const service = new MbtiConfigService(db, access, permissions, runtime, plugins);
  return { db, permissions, access, plugins, lifecycle, service, locks, profileQueries, state: () => state, setProfileEnvironment(value: string) { profileEnvironment = value; }, fail(value: string) { fail = value; },
    async enable() { await lifecycle.install("mbti-config", "0.1.0", "root"); await lifecycle.enable("mbti-config", "root"); },
    save(headline: string, expectedDraftVersion: number) { return service.saveDraft("root", "content", { value: content(headline), expectedDraftVersion }); } };
}
const status = (n: number) => (e: unknown) => (e as { getStatus(): number }).getStatus() === n;

test("trusted v2 plugin, launch list and static modules agree and reject unknown/mismatched catalogs", () => {
  assert.equal(mbtiConfigManifest.manifestVersion, 2);
  assertLaunchRegistryAlignment([...TRUSTED_PLUGINS.keys()]); assertLaunchPlugins(LAUNCH_PLUGIN_CODES);
  assert.equal(resolvePluginModules(LAUNCH_PLUGIN_CODES).length, LAUNCH_PLUGIN_CODES.length);
  assert.throws(() => assertLaunchRegistryAlignment(["mbti-config"]), /mismatch/);
  assert.throws(() => assertLaunchRegistryAlignment([...LAUNCH_PLUGIN_CODES, "unknown"]), /mismatch/);
  assert.throws(() => assertLaunchPlugins(["unknown"])); assert.throws(() => resolvePluginModules(["unknown"]));
  const invalid = new Map(TRUSTED_PLUGINS); invalid.set("wrong-code", TRUSTED_PLUGINS.get("mbti-config")!);
  assert.throws(() => new PluginCatalog(invalid), /not trusted/);
  assert.deepEqual(PluginRuntimeModule.forRoot(["mbti-config"]).imports, PluginRuntimeModule.forRoot(["mbti-config"]).imports);
  assert.deepEqual(mbtiConfigManifest.permissions, []); assert.deepEqual(mbtiConfigManifest.menus, []);
  const capability = (projectId: string, auth: boolean, database: boolean) => ({ projectId, enabledPlugins: ["mbti-config"], capabilities: { auth, database } }) as unknown as Parameters<typeof assertRuntimeCapabilities>[0];
  assert.throws(() => assertRuntimeCapabilities(capability("other-project", true, true)), /trusted project/);
  assert.throws(() => assertRuntimeCapabilities(capability("mbti-foundation", false, true)), /administrator auth/);
  assert.throws(() => assertRuntimeCapabilities(capability("mbti-foundation", true, false)), /database/);
  assertRuntimeCapabilities(capability("mbti-foundation", true, true));
});

test("existing lifecycle is project/environment scoped and repeated install/enable/disable creates no duplicate operations, menus or grants", async () => {
  const f = fixture(); await f.lifecycle.install("mbti-config", "0.1.0", "root"); await f.lifecycle.install("mbti-config", "0.1.0", "root");
  await f.lifecycle.enable("mbti-config", "root"); await f.lifecycle.enable("mbti-config", "root");
  await f.lifecycle.disable("mbti-config", "root"); await f.lifecycle.disable("mbti-config", "root");
  assert.equal(f.state().installations.length, 1); assert.equal(f.state().operations.length, 3);
  assert.equal(f.state().audits.length, 3); assert.equal(f.state().installations[0].projectId, "project-test");
  assert.ok(JSON.stringify(f.profileQueries).includes("mbti-foundation-test"));
  const wrongRuntime = { getOrThrow(key: string) { return key === "projectId" ? "other-project" : "test"; } } as ConfigService;
  const other = new PluginLifecycleService(f.db, f.access, wrongRuntime, new PluginCatalog(TRUSTED_PLUGINS));
  await assert.rejects(other.install("mbti-config", "0.1.0", "root"), status(403));
  await assert.rejects(f.lifecycle.install("unknown", "0.1.0", "root"), status(404));
  f.setProfileEnvironment("production");
  await assert.rejects(f.lifecycle.enable("mbti-config", "root"), status(503));
  await assert.rejects(f.service.readView("root", "published"), status(503));
});

test("exactly 11 unique categories, prototype candidates validate and unknown/secret fields are rejected without reflecting inputs", () => {
  assert.equal(MBTI_CATEGORIES.length, 11); assert.equal(new Set(MBTI_CATEGORIES).size, 11); assert.ok(!MBTI_CATEGORIES.includes("release" as never));
  const b3 = JSON.parse(readFileSync(resolve(__dirname, "../../../../admin/src/config-fixture.json"), "utf8"));
  const values = { ...emptySnapshot(), content: b3.content, channels: b3.channels, catalog: { shop: b3.shop, styles: b3.styles },
    assessment: { ...b3.quiz, questions: b3.quiz.questions.map((q: object) => ({ ...q, reverse: false })) }, personas: b3.personas,
    imageRecipes: { recipe: "balanced" }, retention: { tags: ["日常生活"], days: [30, 90] }, discovery: { order: "recommend", daily: 8, radar: true, radius: 500, minimum: 10 },
    aiRuntime: { mode: "UNCONFIGURED", size: "960*1280", timeout: 90 }, payments: Object.fromEntries(["wechat", "mp", "douyin", "xhs"].map(c => [c, { enabled: false, mode: "UNCONFIGURED", merchantLabel: "MBTI搭子体验店" }])), trade: { ttl: 30, redeem: true, selfRefund: "self", refundDays: 7 } };
  assert.deepEqual(validateSnapshot(values), values);
  assert.throws(() => validateSnapshot({ ...values, release: {} }));
  assert.throws(() => validateCategory("content", { ...content("内容"), credential: "invalid-reference" }));
  assert.throws(() => validateCategory("aiRuntime", { mode: "live", size: "960*1280", timeout: 90 }));
  assert.throws(() => validateCategory("aiRuntime", { mode: "UNCONFIGURED", size: "960*1280", timeout: 90, credentialRef: "invalid-reference" }), e => !(e as Error).message.includes("invalid-reference"));
  assert.throws(() => validateCategory("retention", { tags: ["重复", "重复"], days: [30] }));
  assert.throws(() => validateCategory("discovery", { order: "same", daily: 31, radar: true, radius: 500, minimum: 10 }));
});

test("draft isolated from live; empty or stale draft rejected and read has no initialization side effects", async () => {
  const f = fixture(); await f.enable(); const count = f.state().configs.length;
  const initial = await f.service.readView("root", "published"); assert.equal(initial.expectedVersion, 0); assert.equal(initial.categories.content, null); assert.equal(f.state().configs.length, count);
  await f.save("首版", 0); const live = await f.service.readView("root", "published"); assert.equal(live.categories.content, null); assert.equal(live.expectedVersion, 0); assert.deepEqual(live, initial);
  await assert.rejects(f.save("旧草稿", 0), status(409)); await assert.rejects(f.save("首版", 1), status(409));
  await f.service.publish("root", { expectedVersion: 0, expectedDraftVersion: 1 });
  assert.deepEqual((await f.service.readView("root", "published")).categories.content, content("首版"));
  await assert.rejects(f.service.publish("root", { expectedVersion: 1, expectedDraftVersion: 1 }), status(409));
});

test("concurrent same-version publication has one winner and coherent pointer/snapshot/change/audit", async () => {
  const f = fixture(); await f.enable(); await f.save("并发", 0);
  const results = await Promise.allSettled([f.service.publish("root", { expectedVersion: 0, expectedDraftVersion: 1 }), f.service.publish("root", { expectedVersion: 0, expectedDraftVersion: 1 })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.getStatus(), 409);
  const pointer = f.state().configs.find(r => r.configKey === "release.active")!, snapshot = f.state().configs.find(r => r.configKey === pointer.configValue)!;
  const changes = f.state().changes.filter(c => c.configKey === "release.active");
  assert.equal(pointer.version, 1); assert.equal(snapshot.version, 1); assert.equal(changes.length, 1);
  assert.ok(f.state().audits.find(a => a.id === changes[0].auditLogId)); assert.ok(f.locks.length > 0);
});

test("audit failure, history failure and CAS loss roll back every publication artifact", async () => {
  const f = fixture(); await f.enable(); await f.save("事务", 0);
  for (const failure of ["audit", "change"]) {
    const before = canonical(f.state()); f.fail(failure);
    await assert.rejects(f.service.publish("root", { expectedVersion: 0, expectedDraftVersion: 1 }), status(503)); assert.equal(canonical(f.state()), before);
  }
  f.fail(""); await f.service.publish("root", { expectedVersion: 0, expectedDraftVersion: 1 }); await f.save("第二版", 1);
  const before = canonical(f.state()); f.fail("cas");
  await assert.rejects(f.service.publish("root", { expectedVersion: 1, expectedDraftVersion: 2 }), status(409)); assert.equal(canonical(f.state()), before);
});

test("rollback creates a new version, keeps newer draft, and never changes old snapshots", async () => {
  const f = fixture(); await f.enable(); await f.save("第一版", 0); await f.service.publish("root", { expectedVersion: 0, expectedDraftVersion: 1 });
  await f.save("第二版", 1); await f.service.publish("root", { expectedVersion: 1, expectedDraftVersion: 2 });
  const historical = structuredClone(f.state().configs.filter(r => r.configKey.startsWith("release.version.")));
  await f.save("未发布第三版", 2); const draft = structuredClone(f.state().configs.find(r => r.configKey === "release.draft"));
  const result = await f.service.rollback("root", "1", { expectedVersion: 2 }); assert.equal(result.version, 3);
  assert.deepEqual(f.state().configs.find(r => r.configKey === "release.draft"), draft);
  assert.deepEqual(f.state().configs.filter(r => historical.some(h => h.id === r.id)), historical);
  assert.deepEqual((await f.service.readView("root", "published")).categories.content, content("第一版"));
  assert.deepEqual((await f.service.readView("root", "draft")).categories.content, content("未发布第三版"));
  assert.deepEqual((await f.service.versions("root")).map(v => v.version), [3, 2, 1]);
  assert.deepEqual((await f.service.version("root", "2")).categories.content, content("第二版"));
  assert.equal((await f.service.audit("root")).length, 6);
  await assert.rejects(f.service.rollback("root", "3", { expectedVersion: 3 }), status(409));
  await assert.rejects(f.service.rollback("root", "2", { expectedVersion: 2 }), status(409));
});

test("projection uses current permissions; system refs require owned metadata and never leave responses or audit", async () => {
  const f = fixture(); await f.enable(); const ref = "local://mbti-foundation/test/CANDIDATE_AI";
  const ai = { mode: "UNCONFIGURED", size: "960*1280", timeout: 90, credentialRef: ref };
  const saved = await f.service.saveDraft("root", "aiRuntime", { value: ai, expectedDraftVersion: 0 });
  assert.equal(JSON.stringify(saved).includes(ref), false);
  const audit = projectAudit(f.state().audits.at(-1)!); assert.equal(audit.action, "mbti_draft_saved"); assert.equal(JSON.stringify(audit).includes(ref), false); assert.equal(JSON.stringify(f.state().audits).includes(ref), false); assert.equal(JSON.stringify(f.state().changes).includes(ref), false);
  const editor = await f.service.readView("editor", "draft"); for (const k of ["aiRuntime", "payments", "trade"]) assert.equal(Object.hasOwn(editor.categories, k), false);
  assert.deepEqual(editor.diff, []); assert.equal(Object.keys(editor.categories).length, 8);
  await f.service.saveDraft("root", "aiRuntime", { value: { mode: "UNCONFIGURED", size: "960*1280", timeout: 91 }, expectedDraftVersion: 1 });
  assert.equal(JSON.parse(f.state().configs.find(r => r.configKey === "release.draft")!.configValue).aiRuntime.credentialRef, ref);
  await f.service.publish("root", { expectedVersion: 0, expectedDraftVersion: 2 });
  for (const result of [await f.service.readView("root", "published"), await f.service.version("root", "1"), await f.service.audit("root")]) assert.equal(JSON.stringify(result).includes(ref), false);
  assert.equal(Object.hasOwn((await f.service.version("editor", "1")).categories, "aiRuntime"), false);
  assert.ok((await f.service.audit("editor")).every(row => !row.categories.includes("aiRuntime")));
  assert.deepEqual(Object.keys(projectSnapshot(emptySnapshot(), true)), [...MBTI_CATEGORIES]);
  await assert.rejects(f.service.saveDraft("editor", "aiRuntime", { value: ai, expectedDraftVersion: 1 }), status(403));
  await assert.rejects(f.service.publish("editor", { expectedVersion: 0, expectedDraftVersion: 1 }), status(403));
  await assert.rejects(f.service.readView("denied", "draft"), status(403));
  await assert.rejects(f.service.saveDraft("denied", "content", { value: content("无权限"), expectedDraftVersion: 1 }), status(403));
  await assert.rejects(f.service.saveDraft("root", "aiRuntime", { value: { ...ai, credentialRef: "local://other-project/test/CANDIDATE_AI" }, expectedDraftVersion: 2 }), status(403));
  await assert.rejects(f.service.saveDraft("root", "aiRuntime", { value: { ...ai, credentialRef: "local://mbti-foundation/test/UNKNOWN_REF" }, expectedDraftVersion: 2 }), status(400));
});

test("disabled and missing installations reject reads, writes and publication", async () => {
  const f = fixture(); await assert.rejects(f.service.readView("root", "draft"), status(404));
  await f.enable(); await f.save("停用", 0); await f.lifecycle.disable("mbti-config", "root");
  await assert.rejects(f.save("不可写", 1), status(404)); await assert.rejects(f.service.publish("root", { expectedVersion: 0, expectedDraftVersion: 1 }), status(404));
  await assert.rejects(f.service.versions("root"), status(404)); await assert.rejects(f.service.audit("root"), status(404)); await assert.rejects(f.service.version("root", "1"), status(404)); await f.lifecycle.enable("mbti-config", "root");
  assert.deepEqual((await f.service.readView("root", "draft")).categories.content, content("停用"));
});

test("actual Nest HTTP routes enforce auth, permissions, disabled state and strict bodies with isolated transaction doubles", async () => {
  const f = fixture(); await f.enable();
  // Only authentication transport is replaced; PermissionsGuard and all service authorization are real owners.
  const auth = { canActivate(ctx: ExecutionContext) { const r = ctx.switchToHttp().getRequest(); const id = r.headers.authorization; if (!["root", "editor", "denied"].includes(id)) throw new UnauthorizedException(); r.user = { id }; return true; } };
  assert.ok(Reflect.getMetadata(GUARDS_METADATA, MbtiConfigController).includes(JwtAuthGuard));
  class HttpController extends MbtiConfigController {}
  // Inherit the production routes and method metadata, replace only this fixture's auth transport.
  Reflect.defineMetadata(GUARDS_METADATA, [auth, new PermissionsGuard(new Reflector(), f.permissions), new PluginEnabledGuard(new Reflector(), f.plugins)], HttpController);
  @Module({ controllers: [HttpController], providers: [{ provide: MbtiConfigService, useValue: f.service }] }) class HttpFixture {}
  const app = await NestFactory.create(HttpFixture, { logger: false, abortOnError: false }); app.setGlobalPrefix("api"); await app.listen(0, "127.0.0.1");
  try {
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/plugins/mbti-config`;
    const send = (path: string, method: string, id?: string, body?: unknown) => fetch(base + path, { method, headers: { ...(id ? { authorization: id } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal((await send("/draft", "GET")).status, 401);
    assert.equal((await send("/publish", "POST", "denied", { expectedVersion: 0, expectedDraftVersion: 0 })).status, 403);
    assert.equal((await send("/publish", "POST", "editor", { expectedVersion: 0, expectedDraftVersion: 0 })).status, 403);
    assert.equal((await send("/draft/content", "PATCH", "root", { value: content("HTTP"), expectedDraftVersion: 0, extra: true })).status, 400);
    assert.equal((await send("/draft/content", "PATCH", "editor", { value: content("HTTP"), expectedDraftVersion: 0 })).status, 200);
    assert.equal((await send("/publish", "POST", "root", { expectedVersion: 0, expectedDraftVersion: 1 })).status, 200);
    const live = await (await send("/published", "GET", "editor")).json(); assert.equal(live.categories.content.headline, "HTTP"); assert.equal(Object.hasOwn(live.categories, "trade"), false);
    await f.lifecycle.disable("mbti-config", "root"); assert.equal((await send("/draft", "GET", "root")).status, 404);
    const beforeReinitialize = canonical(f.state());
    const second = await NestFactory.create(HttpFixture, { logger: false, abortOnError: false });
    try { await second.init(); } finally { await second.close(); }
    assert.equal(canonical(f.state()), beforeReinitialize);
  } finally { await app.close(); }
});
