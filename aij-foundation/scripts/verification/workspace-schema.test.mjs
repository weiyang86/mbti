import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readDatabaseEnvironment, withDatabase } from "../database/connection.mjs";
import { createAcceptance, migrate } from "../database/migration.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const workspaceTables = [
  "client_workspace",
  "client_workspace_membership",
  "client_workspace_permission",
  "client_workspace_role",
  "client_workspace_role_permission"
];

test("G10-01 deploys the minimal customer Workspace schema in a new isolated PostgreSQL database", { timeout: 180000 }, async t => {
  const lease = await createAcceptance("test", "AF-053");
    const firstDeploy = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
    assert.equal(firstDeploy.exitCode, 0);
    assert.equal(firstDeploy.status, "DEPLOYED");
    const secondDeploy = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
    assert.equal(secondDeploy.exitCode, 0);
    assert.equal(secondDeploy.status, "DEPLOYED");
    const status = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
    assert.equal(status.status, "UP_TO_DATE");

    const acceptanceEnvironment = readDatabaseEnvironment("test", process.env, lease.id);
    const result = await withDatabase("test", acceptanceEnvironment, async client => {
      const { rows: tableRows } = await client.query(
        "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename LIKE 'client_workspace%' ORDER BY tablename"
      );
      assert.deepEqual(tableRows.map(row => row.tablename), workspaceTables);
      const { rows: forbiddenTables } = await client.query(
        "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND (tablename ILIKE '%company_profile%' OR tablename ILIKE '%ip_%' OR tablename ILIKE '%diagnos%' OR tablename ILIKE '%order%') ORDER BY tablename"
      );
      assert.deepEqual(forbiddenTables, [], "no enterprise profile, IP, diagnosis or order table is part of this migration");

      const { rows: foreignKeys } = await client.query(
        `SELECT source.relname AS source_table, target.relname AS target_table, constraint_row.conname AS constraint_name
           FROM pg_catalog.pg_constraint constraint_row
           JOIN pg_catalog.pg_class source ON source.oid = constraint_row.conrelid
           JOIN pg_catalog.pg_class target ON target.oid = constraint_row.confrelid
          WHERE constraint_row.contype = 'f' AND source.relname = ANY($1::text[])
          ORDER BY source.relname, constraint_row.conname`, [workspaceTables]
      );
      assert.ok(foreignKeys.length >= 7);
      assert.ok(foreignKeys.every(row => workspaceTables.includes(row.target_table) || row.target_table === "member_user"),
        "Workspace FKs stay inside client identity and tenant tables, never ProjectProfile, SysRole or business models");

      const member = "af053-member-owner";
      const secondMember = "af053-member-invitee";
      const now = new Date();
      await client.query(
        "INSERT INTO public.member_user (id, nickname, created_at, updated_at) VALUES ($1, 'AF-053 owner', $2, $2), ($3, 'AF-053 member', $2, $2)",
        [member, now, secondMember]
      );

      const insertWorkspace = async (id, code, ownerId, idemKey) => client.query(
        `INSERT INTO public.client_workspace (id, code, name, created_by_member_id, creation_idempotency_key, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`, [id, code, code, ownerId, idemKey, now]
      );
      await insertWorkspace("af053-ws-a", "af053-workspace-a", member, "create-a");
      await insertWorkspace("af053-ws-b", "af053-workspace-b", member, "create-b");
      await assert.rejects(insertWorkspace("af053-ws-duplicate-code", "af053-workspace-a", member, "create-c"), error => error.code === "23505");
      await assert.rejects(insertWorkspace("af053-ws-duplicate-idempotency", "af053-workspace-c", member, "create-a"), error => error.code === "23505");

      const insertRole = async (id, workspaceId, code) => client.query(
        `INSERT INTO public.client_workspace_role (id, workspace_id, code, name, updated_at)
         VALUES ($1, $2, $3, $3, $4)`, [id, workspaceId, code, now]
      );
      await insertRole("af053-role-a", "af053-ws-a", "owner");
      await insertRole("af053-role-b", "af053-ws-b", "owner");
      await assert.rejects(insertRole("af053-role-duplicate", "af053-ws-a", "owner"), error => error.code === "23505");

      await client.query(
        "INSERT INTO public.client_workspace_permission (id, code, name, updated_at) VALUES ('af053-permission', 'workspace.member.read', 'Member read', $1)", [now]
      );
      await client.query(
        "INSERT INTO public.client_workspace_role_permission (id, role_id, permission_id, updated_at) VALUES ('af053-grant', 'af053-role-a', 'af053-permission', $1)", [now]
      );
      await assert.rejects(
        client.query("INSERT INTO public.client_workspace_role_permission (id, role_id, permission_id, updated_at) VALUES ('af053-grant-duplicate', 'af053-role-a', 'af053-permission', $1)", [now]),
        error => error.code === "23505"
      );

      await client.query(
        `INSERT INTO public.client_workspace_membership (id, workspace_id, member_id, role_id, updated_at)
         VALUES ('af053-membership-a', 'af053-ws-a', $1, 'af053-role-a', $2)`, [secondMember, now]
      );
      await assert.rejects(
        client.query(
          `INSERT INTO public.client_workspace_membership (id, workspace_id, member_id, role_id, updated_at)
           VALUES ('af053-membership-cross-role', 'af053-ws-a', $1, 'af053-role-b', $2)`, [member, now]
        ), error => error.code === "23503" && error.constraint === "client_workspace_membership_workspace_id_role_id_fkey"
      );
      await assert.rejects(
        client.query(
          `INSERT INTO public.client_workspace_membership (id, workspace_id, member_id, role_id, updated_at)
           VALUES ('af053-membership-duplicate', 'af053-ws-a', $1, 'af053-role-a', $2)`, [secondMember, now]
        ), error => error.code === "23505"
      );
      await assert.rejects(client.query("DELETE FROM public.member_user WHERE id = $1", [member]), error => error.code === "23503");

      const { rows: migrationRows } = await client.query(
        "SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations WHERE migration_name = '20261029030000_client_workspace'"
      );
      assert.equal(migrationRows.length, 1);
      assert.ok(migrationRows[0].finished_at);
      assert.equal(migrationRows[0].rolled_back_at, null);
      return { tables: tableRows.map(row => row.tablename), foreignKeys, migration: migrationRows[0].migration_name, createdRows: { members: 2, workspaces: 2, roles: 2, permissions: 1, grants: 1, memberships: 1 } };
    }, { acceptanceId: lease.id });

    const evidenceDir = join(repositoryRoot, ".artifacts", "af-053");
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
    const evidencePath = join(evidenceDir, `workspace-schema-${lease.id}.json`);
    await writeFile(evidencePath, JSON.stringify({ task: "AF-053", acceptanceId: lease.id, database: lease.database, firstDeploy: firstDeploy.status, secondDeploy: secondDeploy.status, migrationStatus: status.status, ...result }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await t.test("migration is repeatable and its ledger matches the sole new Workspace migration", () => {
      assert.equal(result.migration, "20261029030000_client_workspace");
      assert.equal(status.status, "UP_TO_DATE");
    });
});
