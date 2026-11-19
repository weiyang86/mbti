import assert from "node:assert/strict";
import test from "node:test";
import { assertGeneratedSchema, assertOwnerExtensions, assertRetainedBusinessAbsent, schemaTokens } from "./prisma-schema-assertions.mjs";

test("generated schema comparison tolerates formatting while rejecting changed values, tokens and constraints", () => {
  const source = 'model Example {\n id String @id\n title String? @default("a b // kept")\n}';
  assertGeneratedSchema('// copied by Prisma\nmodel Example {\n id   String @id\n @@map("example")\n title String? @default("a b // kept")\n}', source.replace('\n}', '\n @@map("example")\n}'));
  assert.deepEqual(schemaTokens('// comment\nmodel Example { id String }'), schemaTokens('model Example{id String}'));
  for (const changed of [source.replace('a b', 'ab'), source.replace('String?', 'String'), source.replace('id String', 'idString'), source.replace('@id', '@unique')]) {
    assert.throws(() => assertGeneratedSchema(changed, source));
  }
});

test("retained source business owners and unauthorized external relations still fail", () => {
  assertRetainedBusinessAbsent([{ name: "ClientWorkspace", fields: [] }, { name: "PaymentOrder", fields: [] }]);
  assert.throws(() => assertRetainedBusinessAbsent([{ name: "ActionTask", fields: [] }]));
  assert.throws(() => assertRetainedBusinessAbsent([{ name: "CompanyProfile", fields: [] }]));
  assert.throws(() => assertRetainedBusinessAbsent([{ name: "FileAsset", fields: [{ kind: "object", type: "MissingOwner" }] }]));
  assert.throws(() => assertOwnerExtensions([{ name: "FileAsset", fields: [{ kind: "object", name: "unexpected", type: "MemberUser" }] }], ["FileAsset"]));
});
