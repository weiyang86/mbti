import assert from "node:assert/strict";

// Fresh migrated auth/RBAC/admin-user fixtures have no customer workspaces.
// Their only workspace rows are the fixed permission catalog inserted by:
// 20261102000000_ai_knowledge_document and 20261104020000_general_ai_runs.
// Both use ON CONFLICT (code) DO NOTHING; code is UNIQUE in
// 20261029030000_client_workspace. Do not permit fixture-created permissions,
// grants or other business rows under this baseline.
export const clientWorkspacePermissionBaselineSql = 'SELECT * FROM public."client_workspace_permission" ORDER BY "code"';

export function assertClientWorkspacePermissionBaseline(rows) {
  const expected = [
    { id: "aij_workspace_ai_execute", code: "workspace.ai.execute", name: "Workspace AI execute" },
    { id: "aij_workspace_ai_read", code: "workspace.ai.read", name: "Workspace own AI results read" },
    { id: "aij_workspace_knowledge_manage", code: "workspace.knowledge.manage", name: "Workspace knowledge manage" },
    { id: "aij_workspace_knowledge_query", code: "workspace.knowledge.query", name: "Workspace knowledge query" }
  ];
  assert.ok(Array.isArray(rows), "Workspace permission baseline must be query rows");
  assert.equal(rows.length, expected.length, "Only the four migrated workspace permission definitions may exist");
  const columns = ["id", "code", "name", "description", "status", "created_at", "updated_at", "deleted_at"].sort();
  for (const [i, row] of rows.entries()) {
    assert.deepEqual(Object.keys(row).sort(), columns, "Verify every permission column; schema drift requires an explicit baseline update");
    const { created_at: createdAt, updated_at: updatedAt, ...definition } = row;
    assert.deepEqual(definition, { ...expected[i], description: null, status: "active", deleted_at: null }, "Workspace permission definition must match its migration exactly");
    // CURRENT_TIMESTAMP is generated at migration time, not a fixed fixture
    // literal. Each INSERT initializes both columns (TIMESTAMP(3)) equally;
    // its two VALUES rows share the same transaction timestamp.
    for (const value of [createdAt, updatedAt]) assert.ok(value instanceof Date && Number.isFinite(value.getTime()), "Migration timestamps must be non-null valid dates");
    assert.equal(updatedAt.getTime(), createdAt.getTime(), "Migrated permission timestamps must be unchanged");
  }
  assert.equal(rows[0].created_at.getTime(), rows[1].created_at.getTime(), "AI permission pair must retain its shared migration timestamp");
  assert.equal(rows[2].created_at.getTime(), rows[3].created_at.getTime(), "Knowledge permission pair must retain its shared migration timestamp");
}
