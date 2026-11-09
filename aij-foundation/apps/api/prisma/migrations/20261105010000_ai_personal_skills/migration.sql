-- AF-154: client-owned prompt data only, never an execution/cost ledger.
CREATE TABLE "ai_personal_skill" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "code" VARCHAR(63) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "instructions" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "ai_personal_skill_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_personal_skill_prompt_check" CHECK (char_length(instructions) BETWEEN 1 AND 8000 AND octet_length(instructions)<=32768),
  CONSTRAINT "ai_personal_skill_name_check" CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT "ai_personal_skill_code_check" CHECK (char_length(code) BETWEEN 2 AND 63 AND code ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  CONSTRAINT "ai_personal_skill_revision_check" CHECK (revision>=1)
);
CREATE UNIQUE INDEX "ai_personal_skill_owner_code_key" ON "ai_personal_skill" ("workspace_id","member_id","code");
CREATE UNIQUE INDEX "ai_personal_skill_id_scope_key" ON "ai_personal_skill" ("id","workspace_id","member_id");
CREATE INDEX "ai_personal_skill_owner_page_idx" ON "ai_personal_skill" ("workspace_id","member_id","deleted_at","id");
CREATE INDEX "ai_personal_skill_member_idx" ON "ai_personal_skill" ("member_id");
ALTER TABLE "ai_personal_skill" ADD CONSTRAINT "ai_personal_skill_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "client_workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_personal_skill" ADD CONSTRAINT "ai_personal_skill_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "ai_personal_skill_version" (
  "id" TEXT NOT NULL,
  "skill_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "code" VARCHAR(63) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "instructions" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_personal_skill_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_personal_skill_version_prompt_check" CHECK (char_length(instructions) BETWEEN 1 AND 8000 AND octet_length(instructions)<=32768),
  CONSTRAINT "ai_personal_skill_version_name_check" CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT "ai_personal_skill_version_code_check" CHECK (char_length(code) BETWEEN 2 AND 63 AND code ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  CONSTRAINT "ai_personal_skill_version_revision_check" CHECK (revision>=1)
);
CREATE UNIQUE INDEX "ai_personal_skill_version_revision_key" ON "ai_personal_skill_version" ("skill_id","revision");
CREATE INDEX "ai_personal_skill_version_owner_idx" ON "ai_personal_skill_version" ("workspace_id","member_id","skill_id","revision");
CREATE INDEX "ai_personal_skill_version_member_idx" ON "ai_personal_skill_version" ("member_id");
ALTER TABLE "ai_personal_skill_version" ADD CONSTRAINT "ai_personal_skill_version_skill_scope_fkey" FOREIGN KEY ("skill_id","workspace_id","member_id") REFERENCES "ai_personal_skill"("id","workspace_id","member_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_personal_skill_version" ADD CONSTRAINT "ai_personal_skill_version_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "client_workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_personal_skill_version" ADD CONSTRAINT "ai_personal_skill_version_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Enforce append-only snapshots for every writer, including direct SQL.
CREATE FUNCTION "aij_personal_skill_version_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Personal Skill revisions are immutable' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER "ai_personal_skill_version_immutable" BEFORE UPDATE OR DELETE OR TRUNCATE ON "ai_personal_skill_version"
FOR EACH STATEMENT EXECUTE FUNCTION "aij_personal_skill_version_immutable"();
CREATE FUNCTION "aij_personal_skill_identity_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.member_id IS DISTINCT FROM OLD.member_id OR NEW.code IS DISTINCT FROM OLD.code
    OR OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Personal Skill identity and tombstones are immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ai_personal_skill_identity_immutable" BEFORE UPDATE ON "ai_personal_skill"
FOR EACH ROW EXECUTE FUNCTION "aij_personal_skill_identity_immutable"();

-- Match the existing provisioning owner: OWNER gets the catalog, MEMBER stays context-read only.
INSERT INTO "client_workspace_permission" ("id","code","name","status","created_at","updated_at") VALUES
 ('af154-ai-assets-read','workspace.ai.assets.read','Workspace own AI assets read','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('af154-ai-assets-manage','workspace.ai.assets.manage','Workspace own AI assets manage','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "client_workspace_role_permission" ("id","role_id","permission_id","created_at","updated_at")
SELECT 'af154-' || md5(r.id || ':' || p.id),r.id,p.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM "client_workspace_role" r JOIN "client_workspace" w ON w.id=r.workspace_id
CROSS JOIN "client_workspace_permission" p
WHERE r.code='OWNER' AND r.is_system=true AND r.status='active' AND r.deleted_at IS NULL
  AND w.status='active' AND w.deleted_at IS NULL AND p.code IN ('workspace.ai.assets.read','workspace.ai.assets.manage')
  AND p.status='active' AND p.deleted_at IS NULL
ON CONFLICT ("role_id","permission_id") DO NOTHING;
