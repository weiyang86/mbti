import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { dictionaryEffectivePermissions, DICTIONARY_PERMISSION as manage, DICTIONARY_READ_PERMISSION as read } from "../dictionary-policy.cjs";

// Load current source without generating dist or starting an application/database.
const api = fileURLToPath(new URL("../../apps/api/", import.meta.url));
const require = createRequire(api + "package.json");
require("ts-node").register({ project: api + "tsconfig.json", transpileOnly: true });
require("reflect-metadata");
const { ForbiddenException, UnauthorizedException, ServiceUnavailableException, ConflictException, ValidationPipe, BadRequestException } = require("@nestjs/common");
const { Reflector } = require("@nestjs/core");
const { PermissionsService } = require(api + "src/rbac/permissions.service.ts");
const { MenusService } = require(api + "src/menus/menus.service.ts");
const { ManagementAccessService } = require(api + "src/rbac/management-access.service.ts");
const { DictionariesService } = require(api + "src/dictionaries/dictionaries.service.ts");
const { DictionariesController, DictionaryItemsController } = require(api + "src/dictionaries/dictionaries.controller.ts");
const { CreateDictionaryDto } = require(api + "src/dictionaries/dto.ts");
const { Permissions } = require(api + "src/common/decorators/permissions.decorator.ts");
const { permissionRequirements, PermissionsGuard } = require(api + "src/common/guards/permissions.guard.ts");

function fixture(grants = [manage]) {
  const state = { ready: true, user: { id: "subject", status: "active", deletedAt: null, isSuperAdmin: false },
    role: { roleCode: "dictionary-only", status: "active", deletedAt: null, bound: true, grants },
    definitions: new Set([read, manage, "admin.user.manage", "admin.user.read"]), denials: [] };
  const client = {
    sysUser: { async findFirst({ where, select }) {
      assert.deepEqual(where, { id: "subject", status: "active", deletedAt: null });
      assert.deepEqual(select.userRoles.where, { role: { status: "active", deletedAt: null } });
      assert.deepEqual(select.userRoles.select.role.select.permissions.where, { permission: { status: "active" } });
      if (state.user.status !== "active" || state.user.deletedAt) return null;
      const role = state.role;
      return { ...state.user, userRoles: role.bound && role.status === "active" && !role.deletedAt ? [{ role: {
        roleCode: role.roleCode, permissions: role.grants.filter(code => state.definitions.has(code)).map(permissionCode => ({ permission: { permissionCode } }))
      } }] : [] };
    } },
    sysPermission: { async findMany({ where }) {
      assert.equal(where.status, "active");
      return [...state.definitions].sort().filter(code => !where.permissionCode || where.permissionCode.in.includes(code)).map(permissionCode => ({ permissionCode }));
    } },
    projectProfile: { findFirst: async () => ({ id: "synthetic-project" }) },
    pluginInstallation: { findMany: async () => [] },
    sysMenu: { findMany: async () => [{ id: "dict-menu", title: "字典管理", path: "/auth/dictionaries", type: "menu", permissionCode: read, parentId: null, pluginCode: null, visible: true, status: "active", sortOrder: 0 }] },
    auditLog: { create: async ({ data }) => { state.denials.push(data); } },
    $executeRaw: async () => 0
  };
  const prisma = { ...client, readiness: async () => ({ ready: state.ready }), $transaction: async operation => operation(client) };
  const permissions = new PermissionsService(prisma);
  const access = new ManagementAccessService(prisma, permissions);
  const menus = new MenusService(prisma, permissions, access, { pluginEnabled: () => true, pageAvailable: () => true }, { getOrThrow: key => key === "projectId" ? "synthetic" : "development" });
  return { state, client, prisma, permissions, menus, access };
}

test("dictionary compatibility is one-way, active-definition gated and leaves all other capabilities unchanged", () => {
  assert.deepEqual(dictionaryEffectivePermissions([manage], [read, manage]), [manage, read]);
  assert.deepEqual(dictionaryEffectivePermissions([read], [read, manage]), [read]);
  assert.deepEqual(dictionaryEffectivePermissions([], [read, manage]), []);
  assert.deepEqual(dictionaryEffectivePermissions([manage], [manage]), [manage]);
  assert.deepEqual(dictionaryEffectivePermissions([manage], [read]), []);
  assert.deepEqual(dictionaryEffectivePermissions(["admin.user.manage"], ["admin.user.manage", "admin.user.read", read]), ["admin.user.manage"]);
});

test("all dictionary handlers declare the required read/write boundary; global AND and missing-metadata denial remain", () => {
  const reflector = new Reflector();
  for (const [controller, names, required] of [[DictionariesController, ["list", "items"], read], [DictionariesController, ["create", "update", "remove", "createItem"], manage], [DictionaryItemsController, ["update", "remove"], manage]]) {
    for (const name of names) assert.deepEqual(permissionRequirements(reflector, controller.prototype[name], controller), [required]);
  }
  class Probe { action() {} }
  assert.throws(() => permissionRequirements(reflector, Probe.prototype.action, Probe), ForbiddenException);
  Permissions(read)(Probe); Permissions("admin.user.manage")(Probe.prototype, "action", Object.getOwnPropertyDescriptor(Probe.prototype, "action"));
  assert.deepEqual(permissionRequirements(reflector, Probe.prototype.action, Probe), [read, "admin.user.manage"]);
});

test("ordinary manage-only and read-only identities agree across API authorization, menus and presentation without changing grants", async () => {
  for (const grants of [[manage], [read], []]) {
    const { permissions, menus } = fixture(grants);
    const current = await permissions.current("subject");
    assert.equal(current.isSuperAdmin, false); assert.deepEqual(current.permissions, grants);
    const allowed = grants.length > 0;
    assert.equal(current.effectivePermissions.includes(read), allowed);
    assert.equal(current.effectivePermissions.includes(manage), grants.includes(manage));
    assert.equal((await menus.mine("subject")).length, allowed ? 1 : 0);
    if (allowed) await permissions.requirePermissions("subject", [read]);
    else await assert.rejects(permissions.requirePermissions("subject", [read]), ForbiddenException);
    if (grants.includes(manage)) await permissions.requirePermissions("subject", [manage]);
    else await assert.rejects(permissions.requirePermissions("subject", [manage]), ForbiddenException);
    await assert.rejects(permissions.requirePermissions("subject", [read, "admin.user.manage"]), ForbiddenException);
  }
});

test("same identity immediately loses access on grant removal, unbinding, role disable/delete or definition disable", async () => {
  for (const mutate of [s => s.role.grants = [], s => s.role.bound = false, s => s.role.status = "disabled", s => s.role.deletedAt = new Date(), s => s.definitions.delete(manage), s => s.definitions.delete(read)]) {
    const { state, permissions, menus } = fixture();
    await permissions.requirePermissions("subject", [read]); assert.equal((await menus.mine("subject")).length, 1);
    mutate(state);
    await assert.rejects(permissions.requirePermissions("subject", [read]), ForbiddenException);
    assert.ok(!(await permissions.current("subject")).effectivePermissions.includes(read));
    assert.deepEqual(await menus.mine("subject"), []);
  }
});

test("disabled/deleted identities and unavailable authorization fail closed; live super cannot revive an absent definition", async () => {
  for (const mutate of [s => s.user.status = "disabled", s => s.user.deletedAt = new Date()]) {
    const { state, permissions } = fixture(); mutate(state);
    await assert.rejects(permissions.current("subject"), UnauthorizedException);
    await assert.rejects(permissions.requirePermissions("subject", [read]), UnauthorizedException);
  }
  const { state, permissions, menus } = fixture([]);
  state.user.isSuperAdmin = true;
  await permissions.requirePermissions("subject", [read]);
  state.definitions.delete(read);
  await assert.rejects(permissions.requirePermissions("subject", [read]), ForbiddenException);
  assert.deepEqual(await menus.mine("subject"), []);
  state.ready = false;
  await assert.rejects(permissions.current("subject"), ServiceUnavailableException);
  for (const required of [[], ["*"], ["admin.unknown.read"]]) await assert.rejects(permissions.requirePermissions("subject", required), required[0] === "admin.unknown.read" ? ServiceUnavailableException : ForbiddenException);
});

test("actual Guard denies all six read-only write handlers before dispatch and records the manage requirement", async () => {
  const { permissions, state } = fixture([read]);
  const guard = new PermissionsGuard(new Reflector(), permissions);
  const context = (controller, name, user = { id: "subject" }) => ({ getClass: () => controller, getHandler: () => controller.prototype[name], switchToHttp: () => ({ getRequest: () => ({ user, correlationId: "af135-pure" }) }) });
  assert.equal(await guard.canActivate(context(DictionariesController, "list")), true);
  for (const [controller, name] of [[DictionariesController, "create"], [DictionariesController, "update"], [DictionariesController, "remove"], [DictionariesController, "createItem"], [DictionaryItemsController, "update"], [DictionaryItemsController, "remove"]]) await assert.rejects(guard.canActivate(context(controller, name)), ForbiddenException);
  await assert.rejects(guard.canActivate(context(DictionariesController, "list", null)), UnauthorizedException);
  assert.equal(state.denials.length, 6);
  assert.ok(state.denials.every(row => row.action === "permission_denied" && row.status === "failed" && row.requestSummary.requiredPermissions.join() === manage));
});

test("existing transaction authority blocks each direct service write by a reader before any dictionary data operation", async () => {
  const { prisma, access } = fixture([read]);
  // No sysDict/sysDictItem methods are supplied: reaching data access would fail this test.
  const dictionaries = new DictionariesService(prisma, access, {});
  const writes = [() => dictionaries.create({ dictCode: "custom.af135.pure", dictName: "Pure" }, "subject"),
    () => dictionaries.update("dict", { dictName: "Denied" }, "subject"), () => dictionaries.remove("dict", "subject"),
    () => dictionaries.createItem("dict", { itemValue: "new", itemLabel: "Denied" }, "subject"),
    () => dictionaries.updateItem("item", { itemLabel: "Denied" }, "subject"), () => dictionaries.removeItem("item", "subject")];
  for (const write of writes) await assert.rejects(write(), ForbiddenException);
});

test("manage remains constrained by plugin ownership and custom-only category DTOs", async () => {
  const { prisma, client, access } = fixture([manage]);
  client.sysDict = { findFirst: async () => ({ id: "plugin-dict", pluginCode: "aij-synthetic", status: "active" }) };
  client.sysDictItem = { findFirst: async () => ({ id: "plugin-item", dictId: "plugin-dict" }) };
  const dictionaries = new DictionariesService(prisma, access, {});
  for (const write of [() => dictionaries.update("plugin-dict", { dictName: "Denied" }, "subject"), () => dictionaries.remove("plugin-dict", "subject"),
    () => dictionaries.createItem("plugin-dict", { itemValue: "new", itemLabel: "Denied" }, "subject"),
    () => dictionaries.updateItem("plugin-item", { itemLabel: "Denied" }, "subject"), () => dictionaries.removeItem("plugin-item", "subject")]) await assert.rejects(write(), ConflictException);
  const pipe = new ValidationPipe({ expectedType: CreateDictionaryDto, whitelist: true, forbidNonWhitelisted: true, transform: true });
  for (const body of [{ dictCode: "core.af135.pure", dictName: "Denied" }, { dictCode: "aij-synthetic.af135", dictName: "Denied" }, { dictCode: "custom.af135.pure", dictName: "Denied", pluginCode: "aij-synthetic" }]) await assert.rejects(pipe.transform(body, { type: "body", metatype: Object }), BadRequestException);
});
