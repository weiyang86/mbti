-- CreateTable
CREATE TABLE "ai_knowledge_document" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "document_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by_member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_knowledge_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_knowledge_document_workspace_status_idx" ON "ai_knowledge_document"("workspace_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "ai_knowledge_document_workspace_created_idx" ON "ai_knowledge_document"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_knowledge_document_workspace_code_key" ON "ai_knowledge_document"("workspace_id", "document_code");

-- AddForeignKey
ALTER TABLE "ai_knowledge_document" ADD CONSTRAINT "ai_knowledge_document_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "client_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_document" ADD CONSTRAINT "ai_knowledge_document_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- G19: register the knowledge permissions once and grant them only to existing active system OWNER roles.
INSERT INTO "public"."client_workspace_permission" ("id", "code", "name", "status", "created_at", "updated_at")
VALUES
  ('aij_workspace_knowledge_manage', 'workspace.knowledge.manage', 'Workspace knowledge manage', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('aij_workspace_knowledge_query', 'workspace.knowledge.query', 'Workspace knowledge query', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "public"."client_workspace_role_permission" ("id", "role_id", "permission_id", "created_at", "updated_at")
SELECT 'g19_knowledge_' || md5(role."id" || ':' || permission."id"), role."id", permission."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "public"."client_workspace_role" AS role
JOIN "public"."client_workspace_permission" AS permission ON permission."code" IN ('workspace.knowledge.manage', 'workspace.knowledge.query')
WHERE role."code" = 'OWNER' AND role."is_system" = TRUE AND role."status" = 'active' AND role."deleted_at" IS NULL
  AND permission."status" = 'active' AND permission."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
