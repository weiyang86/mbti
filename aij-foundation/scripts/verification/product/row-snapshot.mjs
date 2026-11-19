import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Only called against the freshly migrated, protected acceptance database.
// Include every public table and the migration ledger; no reference-data exemptions.
export async function snapshotProductRows(client, models) {
  assert.ok(Array.isArray(models) && models.length > 0, "Missing product models");
  const names = models.map(model => model.dbName ?? model.name);
  assert.ok(names.every(name => typeof name === "string" && name.length > 0 && !name.includes("\0")), "Invalid model table");
  assert.equal(new Set(names).size, names.length, "Duplicate model tables");
  const expected = [...names, "_prisma_migrations"].sort();
  const { rows: catalog } = await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname=$1 ORDER BY tablename", ["public"]);
  assert.deepEqual(catalog.map(row => row.tablename).sort(), expected, "Migrated public tables must match every current model plus the ledger");
  const snapshot = [];
  for (const name of expected) {
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    // Hash PostgreSQL's canonical jsonb text, preserving exact bigint/decimal values.
    // Sorting whole rows makes the fingerprint independent of the physical row order.
    const { rows } = await client.query("SELECT to_jsonb(product_row)::text AS row FROM public." + quoted + " AS product_row");
    const values = rows.map(row => row.row).sort();
    assert.ok(values.every(value => typeof value === "string"), "Missing row content");
    snapshot.push({ table: name, count: values.length,
      sha256: createHash("sha256").update(JSON.stringify(values)).digest("hex") });
  }
  return snapshot;
}
