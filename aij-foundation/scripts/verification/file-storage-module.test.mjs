import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import runtime from "../runtime-environment.cjs";

const { repositoryRoot } = runtime;
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const { LocalStorageAdapter } = require(join(repositoryRoot, "apps/api/dist/files/local-storage.adapter.js"));
const keys = ["APP_ENV", "RUNTIME_PROFILE", "PROJECT_ID", "AUTH_ENABLED", "CLIENT_AUTH_ENABLED", "DATABASE_ENABLED", "STORAGE_ENABLED", "ENABLED_PLUGINS", "LOCAL_STORAGE_ROOT"];

test("STORAGE_ENABLED assembles the real adapter in Nest without binding a port or creating files", async () => {
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    APP_ENV: "development", RUNTIME_PROFILE: "host", PROJECT_ID: "aij-foundation",
    AUTH_ENABLED: "false", CLIENT_AUTH_ENABLED: "false", DATABASE_ENABLED: "false",
    STORAGE_ENABLED: "true", ENABLED_PLUGINS: "",
    LOCAL_STORAGE_ROOT: ".artifacts/af-045/aij-foundation/development/storage"
  });
  const root = join(repositoryRoot, process.env.LOCAL_STORAGE_ROOT);
  let app;
  try {
    assert.equal(existsSync(root), false, "configuration alone must not create storage directories");
    const { createApplication } = await import("../../apps/api/dist/bootstrap.js");
    app = await createApplication();
    assert.ok(app.get(LocalStorageAdapter), "FilesModule must export the application storage adapter");
    await app.init();
    assert.equal(existsSync(root), false, "adapter construction must remain side-effect free");
  } finally {
    await app?.close();
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
});
