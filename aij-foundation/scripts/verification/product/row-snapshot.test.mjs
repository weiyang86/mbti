import assert from "node:assert/strict";
import test from "node:test";
import { snapshotProductRows } from "./row-snapshot.mjs";

const models = [{ name: "Permission", dbName: "permission" }, { name: "EmptyModel", dbName: null }];
const rows = () => ({ _prisma_migrations: ['{"id":"migration","checksum":"unchanged"}'],
  permission: ['{"id":"reference-a","name":"A"}', '{"id":"reference-b","name":"B"}'], EmptyModel: [] });
function client(tables, queries = []) {
  return { async query(sql, parameters) {
    queries.push(sql);
    if (parameters) {
      assert.deepEqual(parameters, ["public"]);
      return { rows: Object.keys(tables).map(tablename => ({ tablename })) };
    }
    const quoted = sql.match(/FROM public\."((?:""|[^"])*)" AS product_row$/)?.[1];
    assert.notEqual(quoted, undefined);
    const name = quoted.replaceAll('""', '"');
    assert.ok(Object.hasOwn(tables, name));
    return { rows: tables[name].map(row => ({ row })) };
  } };
}

test("reference rows and empty tables are all fingerprinted, including the migration ledger", async () => {
  const data = rows(), snapshot = await snapshotProductRows(client(data), models);
  assert.deepEqual(snapshot.map(row => [row.table, row.count]), [["EmptyModel", 0], ["_prisma_migrations", 1], ["permission", 2]]);
  data.permission.reverse();
  assert.deepEqual(await snapshotProductRows(client(data), models), snapshot);
});

test("insert, delete, content update and ledger modification each invalidate the complete baseline", async () => {
  const before = await snapshotProductRows(client(rows()), models);
  for (const mutate of [
    data => { data.permission.push('{"id":"unexpected"}'); },
    data => { data.permission.pop(); },
    data => { data.permission[0] = '{"id":"reference-a","name":"changed"}'; },
    data => { data._prisma_migrations[0] = '{"id":"migration","checksum":"changed"}'; }
  ]) {
    const data = rows(); mutate(data);
    assert.notDeepEqual(await snapshotProductRows(client(data), models), before);
  }
});

test("missing or unexpected tables and zero models cannot produce a preservation baseline", async () => {
  for (const data of [{ ...rows(), unexpected: [] }, { _prisma_migrations: [], permission: [] }]) {
    await assert.rejects(snapshotProductRows(client(data), models), /every current model/);
  }
  await assert.rejects(snapshotProductRows(client(rows()), []), /Missing product models/);
});

test("unmapped model names fall back safely and SQL identifiers escape embedded quotes", async () => {
  const name = 'Mapped"Table', queries = [];
  await snapshotProductRows(client({ _prisma_migrations: [], [name]: [] }, queries), [{ name, dbName: null }]);
  assert.ok(queries.some(sql => sql.includes('public."Mapped""Table" AS product_row')));
});

test("query failures propagate rather than omitting a table or creating a success fingerprint", async () => {
  const failure = new Error("offline query failure");
  await assert.rejects(snapshotProductRows({ query: async () => { throw failure; } }, models), error => error === failure);
});
