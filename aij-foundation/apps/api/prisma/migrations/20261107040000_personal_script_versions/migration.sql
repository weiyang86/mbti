-- Additive executable extension; original Skill remains the only head/version/audit owner.
ALTER TABLE public.ai_personal_skill_version ADD CONSTRAINT ai_personal_skill_version_script_ref_key UNIQUE(id,skill_id,workspace_id,member_id,revision);
CREATE TABLE public.ai_personal_script_version (
 id uuid PRIMARY KEY, project_id text NOT NULL, workspace_id text NOT NULL, member_id text NOT NULL,
 skill_id text NOT NULL, skill_version_id text NOT NULL, revision integer NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
 script_source text NOT NULL CHECK(octet_length(script_source) BETWEEN 1 AND 65536),
 script_digest text NOT NULL CHECK(script_digest ~ '^[0-9a-f]{64}$'),
 policy_digest text NOT NULL CHECK(policy_digest='f069cddadeaa30648a61bc2bcc93a817c9f4147c3d3f808936b30db7e12c4aef'),
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ai_personal_script_source_hash CHECK(script_digest=encode(sha256(convert_to(script_source,'UTF8')),'hex')),
 CONSTRAINT ai_personal_script_version_original_fkey FOREIGN KEY(skill_version_id,skill_id,workspace_id,member_id,revision)
 REFERENCES public.ai_personal_skill_version(id,skill_id,workspace_id,member_id,revision) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_script_version_project_fkey FOREIGN KEY(project_id) REFERENCES public.project_profile(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_script_version_original_key UNIQUE(skill_version_id),
 CONSTRAINT ai_personal_script_version_original_scope_key UNIQUE(skill_version_id,skill_id,workspace_id,member_id,revision),
 CONSTRAINT ai_personal_script_version_scope_key UNIQUE(id,project_id,workspace_id,member_id)
);
CREATE FUNCTION public.aij_script_version_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- A version created in an older transaction cannot later acquire executable semantics.
 IF current_setting('aij.script_project_id',true) IS DISTINCT FROM NEW.project_id OR NOT EXISTS(
  SELECT 1 FROM public.ai_personal_skill_version v JOIN public.ai_personal_skill s
   ON s.id=v.skill_id AND s.workspace_id=v.workspace_id AND s.member_id=v.member_id
  WHERE v.id=NEW.skill_version_id AND v.skill_id=NEW.skill_id AND v.workspace_id=NEW.workspace_id AND v.member_id=NEW.member_id
   AND v.revision=NEW.revision AND s.revision=v.revision AND s.deleted_at IS NULL
   AND v.xmin::text::bigint=mod(txid_current(),4294967296)) THEN
  RAISE EXCEPTION 'Executable version requires current original append and runtime project' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER ai_personal_script_version_insert BEFORE INSERT ON public.ai_personal_script_version FOR EACH ROW EXECUTE FUNCTION public.aij_script_version_insert();
CREATE FUNCTION public.aij_script_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable personal script version' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER ai_personal_script_version_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.ai_personal_script_version
 FOR EACH STATEMENT EXECUTE FUNCTION public.aij_script_version_immutable();
INSERT INTO public.client_workspace_permission(id,code,name,status,created_at,updated_at) VALUES
 ('af209-scripts-manage','workspace.ai.scripts.manage','Workspace own script versions manage','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('af209-scripts-execute','workspace.ai.scripts.execute','Workspace own scripts execute','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(code) DO NOTHING;
INSERT INTO public.client_workspace_role_permission(id,role_id,permission_id,created_at,updated_at)
SELECT 'af209_'||md5(r.id||':'||p.id),r.id,p.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM public.client_workspace_role r CROSS JOIN public.client_workspace_permission p
WHERE r.code='OWNER' AND r.is_system=true AND r.status='active' AND r.deleted_at IS NULL
 AND p.status='active' AND p.deleted_at IS NULL AND ((p.code='workspace.ai.scripts.manage' AND p.name='Workspace own script versions manage') OR
 (p.code='workspace.ai.scripts.execute' AND p.name='Workspace own scripts execute')) ON CONFLICT(role_id,permission_id) DO NOTHING;
