import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { seedArguments } from "../database/seed.mjs";
import integrationPolicy from "../integration-policy.cjs";

const require = createRequire(join(process.cwd(), "apps/api/package.json"));
const { connectorCatalog, requireConnectorManifest, validateGrantedScopes } = require(join(process.cwd(), "apps/api/dist/integration-center/connector-manifest.js"));

test("AF-099 registers the integration permission only through the explicit seed capability", () => {
  assert.equal(integrationPolicy.INTEGRATION_MANAGEMENT_PERMISSION, "admin.integration.manage");
  assert.deepEqual(seedArguments(["test", "--acceptance", "0123456789abcdef", "--integration-management"]), {
    mode: "test", acceptanceId: "0123456789abcdef", generateCredentials: false, integrationManagement: true
  });
  assert.equal(seedArguments(["test"]).integrationManagement, undefined);
  assert.throws(() => seedArguments(["test", "--integration-management", "--integration-management"]), /Usage: db:seed/);
});

test("connector manifest scope sets must be a unique nonempty subset of the static allowlist", () => {
  const manifest = connectorCatalog()[0];
  assert.equal(manifest.code, "aij-generic-webhook");
  assert.deepEqual(validateGrantedScopes(manifest, ["webhook:read"]), ["webhook:read"]);
  assert.throws(() => validateGrantedScopes(manifest, ["webhook:write"]), error => error.getStatus?.() === 400);
  assert.throws(() => validateGrantedScopes(manifest, []), error => error.getStatus?.() === 400);
  assert.throws(() => requireConnectorManifest("aij-unregistered"), error => error.getStatus?.() === 404);
});
