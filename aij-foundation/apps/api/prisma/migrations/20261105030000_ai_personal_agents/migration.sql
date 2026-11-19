-- AF-159: aij-ai owns private configuration assets, never execution ledgers.
-- AF-154 must already be applied. Only ONE new index on its existing tables.
CREATE UNIQUE INDEX "ai_personal_skill_version_id_scope_key" ON "ai_personal_skill_version" ("id","workspace_id","member_id");

CREATE FUNCTION "aij_personal_agent_field_names"(v JSONB) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE x JSONB; seen TEXT[] := ARRAY[]::TEXT[]; n TEXT;
BEGIN
  IF jsonb_typeof(v) <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(v)>20 THEN RETURN false; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(v) LOOP
    IF jsonb_typeof(x)<>'string' THEN RETURN false; END IF;
    n := x #>> '{}';
    IF n !~ '^[a-zA-Z][a-zA-Z0-9_]{0,47}$' OR n IN ('__proto__','constructor','prototype') OR n=ANY(seen) THEN RETURN false; END IF;
    seen := array_append(seen,n);
  END LOOP;
  RETURN true;
END;
$$;

CREATE TABLE "ai_personal_agent" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "code" VARCHAR(63) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "instructions" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "model_code" VARCHAR(63) NOT NULL,
  "model_revision" INTEGER NOT NULL,
  "catalog_version" INTEGER NOT NULL,
  "input_fields" JSONB NOT NULL,
  "output_format" VARCHAR(4) NOT NULL,
  "output_fields" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "ai_personal_agent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_personal_agent_prompt_check" CHECK (char_length(btrim(instructions))>0 AND char_length(instructions)<=8000 AND octet_length(instructions)<=32768),
  CONSTRAINT "ai_personal_agent_name_check" CHECK (char_length(name) BETWEEN 1 AND 100 AND btrim(name)=name),
  CONSTRAINT "ai_personal_agent_code_check" CHECK (char_length(code) BETWEEN 2 AND 63 AND code ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  CONSTRAINT "ai_personal_agent_model_check" CHECK (char_length(model_code) BETWEEN 2 AND 63 AND model_code ~ '^[a-z][a-z0-9-]{1,62}$' AND model_revision>=1 AND catalog_version>=1),
  CONSTRAINT "ai_personal_agent_revision_check" CHECK (revision>=1),
  CONSTRAINT "ai_personal_agent_inputs_check" CHECK (aij_personal_agent_field_names(input_fields) AND input_fields<>'[]'::jsonb),
  CONSTRAINT "ai_personal_agent_outputs_check" CHECK (aij_personal_agent_field_names(output_fields) AND output_format IN ('text','json') AND (output_format<>'json' OR output_fields<>'[]'::jsonb))
);
CREATE UNIQUE INDEX "ai_personal_agent_id_scope_key" ON "ai_personal_agent" ("id","workspace_id","member_id");
ALTER TABLE "ai_personal_agent" ADD CONSTRAINT "ai_personal_agent_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "client_workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_personal_agent" ADD CONSTRAINT "ai_personal_agent_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "ai_personal_agent_version" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "code" VARCHAR(63) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "instructions" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "model_code" VARCHAR(63) NOT NULL,
  "model_revision" INTEGER NOT NULL,
  "catalog_version" INTEGER NOT NULL,
  "input_fields" JSONB NOT NULL,
  "output_format" VARCHAR(4) NOT NULL,
  "output_fields" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "agent_id" TEXT NOT NULL,
  "skill_binding_count" SMALLINT NOT NULL CHECK (skill_binding_count BETWEEN 0 AND 8),
  CONSTRAINT "ai_personal_agent_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_personal_agent_version_prompt_check" CHECK (char_length(btrim(instructions))>0 AND char_length(instructions)<=8000 AND octet_length(instructions)<=32768),
  CONSTRAINT "ai_personal_agent_version_name_check" CHECK (char_length(name) BETWEEN 1 AND 100 AND btrim(name)=name),
  CONSTRAINT "ai_personal_agent_version_code_check" CHECK (char_length(code) BETWEEN 2 AND 63 AND code ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  CONSTRAINT "ai_personal_agent_version_model_check" CHECK (char_length(model_code) BETWEEN 2 AND 63 AND model_code ~ '^[a-z][a-z0-9-]{1,62}$' AND model_revision>=1 AND catalog_version>=1),
  CONSTRAINT "ai_personal_agent_version_revision_check" CHECK (revision>=1),
  CONSTRAINT "ai_personal_agent_version_inputs_check" CHECK (aij_personal_agent_field_names(input_fields) AND input_fields<>'[]'::jsonb),
  CONSTRAINT "ai_personal_agent_version_outputs_check" CHECK (aij_personal_agent_field_names(output_fields) AND output_format IN ('text','json') AND (output_format<>'json' OR output_fields<>'[]'::jsonb))
);
CREATE UNIQUE INDEX "ai_personal_agent_version_id_scope_key" ON "ai_personal_agent_version" ("id","workspace_id","member_id");
ALTER TABLE "ai_personal_agent_version" ADD CONSTRAINT "ai_personal_agent_version_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "client_workspace"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_personal_agent_version" ADD CONSTRAINT "ai_personal_agent_version_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "ai_personal_agent_owner_code_key" ON "ai_personal_agent" ("workspace_id","member_id","code");
CREATE INDEX "ai_personal_agent_owner_page_idx" ON "ai_personal_agent" ("workspace_id","member_id","deleted_at","id");
CREATE INDEX "ai_personal_agent_member_idx" ON "ai_personal_agent" ("member_id");
CREATE UNIQUE INDEX "ai_personal_agent_version_revision_key" ON "ai_personal_agent_version" ("agent_id","revision");
CREATE INDEX "ai_personal_agent_version_owner_idx" ON "ai_personal_agent_version" ("workspace_id","member_id","agent_id","revision");
CREATE INDEX "ai_personal_agent_version_member_idx" ON "ai_personal_agent_version" ("member_id");
ALTER TABLE "ai_personal_agent_version" ADD CONSTRAINT "ai_personal_agent_version_agent_scope_fkey" FOREIGN KEY ("agent_id","workspace_id","member_id") REFERENCES "ai_personal_agent"("id","workspace_id","member_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "ai_personal_agent_skill_binding" (
  "id" TEXT NOT NULL,
  "agent_version_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "skill_version_id" TEXT NOT NULL,
  "position" SMALLINT NOT NULL,
  CONSTRAINT "ai_personal_agent_skill_binding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_personal_agent_skill_binding_position_check" CHECK (position BETWEEN 0 AND 7),
  CONSTRAINT "ai_personal_agent_binding_version_scope_fkey" FOREIGN KEY ("agent_version_id","workspace_id","member_id") REFERENCES "ai_personal_agent_version"("id","workspace_id","member_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ai_personal_agent_binding_skill_scope_fkey" FOREIGN KEY ("skill_version_id","workspace_id","member_id") REFERENCES "ai_personal_skill_version"("id","workspace_id","member_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "ai_personal_agent_binding_position_key" ON "ai_personal_agent_skill_binding" ("agent_version_id","position");
CREATE UNIQUE INDEX "ai_personal_agent_binding_skill_key" ON "ai_personal_agent_skill_binding" ("agent_version_id","skill_version_id");
CREATE INDEX "ai_personal_agent_binding_skill_scope_idx" ON "ai_personal_agent_skill_binding" ("skill_version_id","workspace_id","member_id");

CREATE FUNCTION "aij_personal_agent_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Personal Agent history and retained assets are immutable' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER "ai_personal_agent_version_immutable" BEFORE UPDATE OR DELETE OR TRUNCATE ON "ai_personal_agent_version"
FOR EACH STATEMENT EXECUTE FUNCTION "aij_personal_agent_immutable"();
CREATE TRIGGER "ai_personal_agent_binding_immutable" BEFORE UPDATE OR DELETE OR TRUNCATE ON "ai_personal_agent_skill_binding"
FOR EACH STATEMENT EXECUTE FUNCTION "aij_personal_agent_immutable"();
CREATE TRIGGER "ai_personal_agent_retained" BEFORE DELETE OR TRUNCATE ON "ai_personal_agent"
FOR EACH STATEMENT EXECUTE FUNCTION "aij_personal_agent_immutable"();
CREATE FUNCTION "aij_personal_agent_identity_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.member_id IS DISTINCT FROM OLD.member_id OR NEW.code IS DISTINCT FROM OLD.code
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Personal Agent identity and tombstones are immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    IF (to_jsonb(NEW)-'deleted_at'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'deleted_at'-'updated_at') THEN
      RAISE EXCEPTION 'Personal Agent deletion cannot change content' USING ERRCODE='55000';
    END IF;
  ELSIF NEW.revision::bigint <> OLD.revision::bigint+1 THEN
    RAISE EXCEPTION 'Personal Agent updates require next revision' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ai_personal_agent_identity_immutable" BEFORE UPDATE ON "ai_personal_agent"
FOR EACH ROW EXECUTE FUNCTION "aij_personal_agent_identity_immutable"();

-- Freeze membership of the binding list too: a snapshot declares its exact size,
-- positions fill all slots at commit, and no later INSERT can find a free slot.
CREATE FUNCTION "aij_personal_agent_binding_slot"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n SMALLINT;
BEGIN
  SELECT skill_binding_count INTO n FROM public.ai_personal_agent_version
    WHERE id=NEW.agent_version_id AND workspace_id=NEW.workspace_id AND member_id=NEW.member_id;
  IF n IS NULL OR NEW.position>=n THEN
    RAISE EXCEPTION 'Personal Agent binding outside snapshot slots' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ai_personal_agent_binding_slot" BEFORE INSERT ON "ai_personal_agent_skill_binding"
FOR EACH ROW EXECUTE FUNCTION "aij_personal_agent_binding_slot"();
CREATE FUNCTION "aij_personal_agent_binding_complete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM public.ai_personal_agent_skill_binding WHERE agent_version_id=NEW.id) <> NEW.skill_binding_count THEN
    RAISE EXCEPTION 'Personal Agent snapshot binding list incomplete' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ai_personal_agent_binding_complete" AFTER INSERT ON "ai_personal_agent_version"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "aij_personal_agent_binding_complete"();
