import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "./catalog.mjs";

// The product runner first enforces the original dev worktree and serial lease.
// No start, create, migrate, seed, reset, cleanup or fallback to development here.
export function migrationInventory(root = repositoryRoot) {
  const prisma = join(root, "apps/api/prisma");
  const directory = join(prisma, "migrations");
  for (const path of [prisma, directory, join(prisma, "schema.prisma")]) assert.equal(lstatSync(path).isSymbolicLink(), false, "Migration paths cannot be symlinks");
  const migrations = readdirSync(directory, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith("._") && (entry.isDirectory() || entry.isSymbolicLink()))
    .map(entry => {
      assert.equal(entry.isSymbolicLink(), false, "Migration directory cannot be a symlink");
      assert.match(entry.name, /^\d{14}_[a-z0-9_]+$/);
      const path = join(directory, entry.name, "migration.sql");
      assert.equal(lstatSync(path).isSymbolicLink(), false, "Migration SQL cannot be a symlink");
      const sql = readFileSync(path, "utf8");
      assert.ok(sql.trim().length > 0, "Empty migration cannot verify the product");
      return { name: entry.name, sha256: createHash("sha256").update(sql).digest("hex") };
    }).sort((a, b) => a.name.localeCompare(b.name));
  assert.ok(migrations.length > 0, "Missing local migration chain");
  assert.ok(readFileSync(join(prisma, "schema.prisma"), "utf8").trim().length > 0, "Missing Schema");
  return migrations;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const migrations = migrationInventory();
  const { preflight } = await import("../../database/managed.mjs");
  const { checkDatabase } = await import("../../database/connection.mjs");
  await preflight(["test"]);
  const checked = await checkDatabase("test");
  console.log(JSON.stringify({ status: "TARGET_VERIFIED", target: checked.target, migrations }));
}
