import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const api = createRequire(join(root, "apps/api/package.json"));
function packageAt(require, name) {
  let directory = dirname(require.resolve(name));
  while (directory !== dirname(directory)) {
    const path = join(directory, "package.json");
    if (existsSync(path)) { const pkg = JSON.parse(readFileSync(path)); if (pkg.name === name) return pkg; }
    directory = dirname(directory);
  }
  throw new Error("Actual installed package metadata missing");
}

test("actual Prisma patch pair and exact scoped dependencies resolve installed official modules", () => {
  assert.equal(api("prisma/package.json").version, "6.19.3");
  assert.equal(api("@prisma/client/package.json").version, "6.19.3");
  assert.equal(api("@prisma/client").Prisma.prismaVersion.client, "6.19.3");
  const prisma = createRequire(api.resolve("prisma/package.json"));
  const engines = createRequire(prisma.resolve("@prisma/engines"));
  assert.equal(api("@prisma/client").Prisma.prismaVersion.engine, engines("@prisma/engines-version").enginesVersion);
  assert.equal(packageAt(prisma, "@prisma/config").version, "6.19.3");
  const config = createRequire(prisma.resolve("@prisma/config"));
  assert.equal(packageAt(config, "deepmerge-ts").version, "8.0.0");
  assert.equal(packageAt(config, "effect").version, "3.21.0");
  const platform = createRequire(api.resolve("@nestjs/platform-express"));
  assert.equal(packageAt(platform, "multer").version, "2.5.0");
  const express = createRequire(platform.resolve("express"));
  assert.equal(packageAt(express, "body-parser").version, "2.4.0");
  assert.equal(packageAt(express, "qs").version, "6.16.1");
  assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"))).pnpm.overrides, {
    "@prisma/config@6.19.3>deepmerge-ts": "8.0.0",
    "@nestjs/platform-express@11.1.19>multer": "2.5.0"
  });
});

test("actual config CJS/ESM, used merge values and unchanged schema-only repository config load", async () => {
  const prisma = createRequire(api.resolve("prisma/package.json"));
  const configPath = prisma.resolve("@prisma/config"), config = prisma("@prisma/config");
  const esm = await import(pathToFileURL(configPath).href);
  assert.equal(typeof esm.defineConfig, "function");
  const configRequire = createRequire(configPath), merge = configRequire("deepmerge-ts").deepmerge;
  const fn = () => 42, left = { schema: "old", options: { values: [1], handler: fn, keep: true } };
  const result = merge(left, { schema: "prisma/schema.prisma", options: { values: [2], optional: undefined } });
  assert.equal(result.schema, "prisma/schema.prisma"); assert.deepEqual(result.options.values, [1, 2]);
  assert.equal(result.options.handler(), 42); assert.equal(result.options.keep, true); assert.deepEqual(left.options.values, [1]);
  for (const module of [config, esm]) assert.equal(module.defineConfig({ schema: "prisma/schema.prisma" }).schema, "prisma/schema.prisma");
  const file = join(root, "apps/api/prisma.config.mjs");
  assert.equal(readFileSync(file, "utf8"), execFileSync("git", ["show", "4e4f2638bf09a69be63c61dba8cac387e655c422:apps/api/prisma.config.mjs"], { cwd: root, encoding: "utf8" }));
  const loaded = await config.loadConfigFromFile({ configFile: file });
  assert.equal(loaded.error, undefined); assert.ok(loaded.config);
  assert.equal(resolve(dirname(file), loaded.config.schema), join(root, "apps/api/prisma/schema.prisma"));
  const parent = join(root, ".artifacts/af-181"); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "invalid-map-config-"));
  try {
    const invalid = join(directory, "invalid.config.mjs");
    writeFileSync(invalid, 'export default { schema: new Map([["invalid", "prisma/schema.prisma"]]) };\n');
    const rejected = await config.loadConfigFromFile({ configFile: invalid });
    assert.ok(rejected.error, "Map-valued config is outside the current validated repository inputs");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
