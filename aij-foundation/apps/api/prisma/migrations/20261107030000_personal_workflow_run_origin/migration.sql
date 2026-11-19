ALTER TABLE public.ai_agent_run ADD CONSTRAINT ai_run_origin_scope_uq
  UNIQUE(id,project_id,workspace_id,member_id);
-- Publication ref compound unique was installed by AF205.
ALTER TABLE public.client_auth_session ADD CONSTRAINT client_session_origin_member_uq UNIQUE(id,member_id);
CREATE TABLE public.ai_personal_workflow_run_origin (
  run_id text PRIMARY KEY,
  project_id text NOT NULL,
  workspace_id text NOT NULL,
  member_id text NOT NULL,
  publication_id uuid NOT NULL,
  ref jsonb NOT NULL CHECK (jsonb_typeof(ref)='object'),
  session_id text NOT NULL,
  token_version integer NOT NULL CHECK(token_version>=0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(run_id,project_id,workspace_id,member_id)
    REFERENCES public.ai_agent_run(id,project_id,workspace_id,member_id) ON DELETE RESTRICT,
  FOREIGN KEY(publication_id,project_id,workspace_id,member_id,ref)
    REFERENCES public.ai_personal_workflow_publication(id,project_id,workspace_id,member_id,ref) ON DELETE RESTRICT,
  FOREIGN KEY(session_id,member_id) REFERENCES public.client_auth_session(id,member_id) ON DELETE RESTRICT
);
CREATE INDEX workflow_run_origin_publication_idx ON public.ai_personal_workflow_run_origin(publication_id,run_id);
CREATE INDEX workflow_run_origin_owner_idx ON public.ai_personal_workflow_run_origin(project_id,workspace_id,member_id,run_id);
CREATE FUNCTION public.reject_workflow_run_origin_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable workflow run origin' USING ERRCODE='55000'; END $$;
CREATE TRIGGER workflow_run_origin_immutable BEFORE UPDATE OR DELETE ON public.ai_personal_workflow_run_origin
  FOR EACH ROW EXECUTE FUNCTION public.reject_workflow_run_origin_mutation();
CREATE TRIGGER workflow_run_origin_no_truncate BEFORE TRUNCATE ON public.ai_personal_workflow_run_origin
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_workflow_run_origin_mutation();

CREATE FUNCTION public.aij_workflow_run_origin_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r public.ai_agent_run%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.ai_agent_run WHERE id=NEW.run_id AND project_id=NEW.project_id AND workspace_id=NEW.workspace_id AND member_id=NEW.member_id FOR SHARE;
 IF NOT FOUND OR (r.snapshot #> '{source,workflowOrigin}') IS DISTINCT FROM NEW.ref
  OR r.snapshot #>> '{source,type}' IS DISTINCT FROM 'personal'
  OR r.snapshot #>> '{source,agentId}' IS DISTINCT FROM NEW.ref->>'agentId'
  OR r.snapshot #>> '{source,versionId}' IS DISTINCT FROM NEW.ref->>'agentVersionId'
  OR r.snapshot #>> '{source,revision}' IS DISTINCT FROM NEW.ref->>'agentRevision'
  OR r.snapshot #>> '{source,publicationVersion}' IS DISTINCT FROM NEW.ref->>'agentPublicationEpoch'
  OR r.agent_code IS DISTINCT FROM 'personal:'||(NEW.ref->>'agentId')
  OR r.agent_revision::text IS DISTINCT FROM NEW.ref->>'agentRevision' THEN
  RAISE EXCEPTION 'Workflow run snapshot origin mismatch' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER workflow_run_origin_insert BEFORE INSERT ON public.ai_personal_workflow_run_origin FOR EACH ROW EXECUTE FUNCTION public.aij_workflow_run_origin_insert();
