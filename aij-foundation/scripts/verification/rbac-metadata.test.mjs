import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
require("reflect-metadata");
const { Reflector } = require("@nestjs/core"), { ForbiddenException, UnauthorizedException, ServiceUnavailableException, SetMetadata } = require("@nestjs/common");
const { Permissions, PERMISSIONS_KEY } = require(join(repositoryRoot, "apps/api/dist/common/decorators/permissions.decorator.js"));
const { PermissionsGuard, permissionRequirements } = require(join(repositoryRoot, "apps/api/dist/common/guards/permissions.guard.js"));

test("class and handler declarations combine with AND; handler cannot replace class requirements", () => {
  class Controller { action() {} }
  Permissions("aij.base.read", "aij.base.read")(Controller);
  Permissions("aij.second.read")(Controller.prototype, "action", Object.getOwnPropertyDescriptor(Controller.prototype, "action"));
  assert.deepEqual(permissionRequirements(new Reflector(), Controller.prototype.action, Controller), ["aij.base.read", "aij.second.read"]);
  assert.ok(Object.isFrozen(Reflect.getMetadata(PERMISSIONS_KEY, Controller)));
});
test("empty or malformed declarations fail at decoration and never create open-access metadata", () => {
  for (const codes of [[], [""], ["*"], ["admin"], ["Aij.read"], ["aij.read?token=value"], ["aij." + "x".repeat(128)]]) assert.throws(() => Permissions(...codes));
});
test("missing and corrupted metadata fail closed even when a class declares a valid permission", () => {
  class Controller { action() {} }
  assert.throws(() => permissionRequirements(new Reflector(), Controller.prototype.action, Controller), ForbiddenException);
  Permissions("aij.base.read")(Controller);
  for (const value of [[], null, "aij.base.read", [""], ["*"]]) {
    SetMetadata(PERMISSIONS_KEY, value)(Controller.prototype, "action", Object.getOwnPropertyDescriptor(Controller.prototype, "action"));
    assert.throws(() => permissionRequirements(new Reflector(), Controller.prototype.action, Controller), ForbiddenException);
  }
});
test("guard requires JWT-established identity and delegates complete server metadata, never client roles", async () => {
  class Controller { action() {} }
  Permissions("aij.base.read")(Controller); Permissions("aij.second.read")(Controller.prototype, "action", Object.getOwnPropertyDescriptor(Controller.prototype, "action"));
  const calls = [], service = { requirePermissions: async (...args) => calls.push(args) }, guard = new PermissionsGuard(new Reflector(), service);
  const request = { correlationId: "af014-metadata-test", headers: { "x-permissions": "*" } };
  const context = { getClass: () => Controller, getHandler: () => Controller.prototype.action, switchToHttp: () => ({ getRequest: () => request }) };
  await assert.rejects(guard.canActivate(context), UnauthorizedException); assert.equal(calls.length, 0);
  request.user = { id: "synthetic-id", isSuperAdmin: true, roles: ["super_admin"], permissions: ["*"] };
  assert.equal(await guard.canActivate(context), true);
  assert.deepEqual(calls, [["synthetic-id", ["aij.base.read", "aij.second.read"], "af014-metadata-test"]]);
});
test("guard propagates 403 and 503 without converting either into successful activation", async () => {
  class Controller { action() {} } Permissions("aij.base.read")(Controller);
  const context = { getClass: () => Controller, getHandler: () => Controller.prototype.action, switchToHttp: () => ({ getRequest: () => ({ user: { id: "synthetic-id" } }) }) };
  for (const error of [new ForbiddenException("Permission denied"), new ServiceUnavailableException("Authorization service unavailable")]) {
    const guard = new PermissionsGuard(new Reflector(), { requirePermissions: async () => { throw error; } });
    await assert.rejects(guard.canActivate(context), value => value === error);
  }
});
