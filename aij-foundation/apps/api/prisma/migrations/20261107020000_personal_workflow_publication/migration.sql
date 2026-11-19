ALTER TABLE public.ai_personal_workflow
 ADD COLUMN published_revision integer,
 ADD COLUMN publication_epoch integer NOT NULL DEFAULT 0,
 ADD CONSTRAINT ai_personal_workflow_publication_head_check CHECK (
  publication_epoch BETWEEN 0 AND 2147483647 AND
  (published_revision IS NULL OR (published_revision BETWEEN 1 AND revision AND publication_epoch > 0)));
ALTER TABLE public.ai_personal_workflow_version
 ADD CONSTRAINT ai_personal_workflow_version_publication_key
 UNIQUE (id,workflow_id,workspace_id,member_id,revision,graph_digest);
ALTER TABLE public.ai_personal_agent_version
 ADD CONSTRAINT ai_personal_agent_version_publication_key
 UNIQUE (id,agent_id,workspace_id,member_id,revision);
ALTER TABLE public.ai_personal_workflow_agent_binding
 ADD CONSTRAINT ai_personal_workflow_binding_publication_key
 UNIQUE (workflow_version_id,workspace_id,member_id,node_id,agent_version_id);
CREATE TABLE public.ai_personal_workflow_publication (
 id uuid PRIMARY KEY,
 project_id text NOT NULL,
 workspace_id text NOT NULL,
 member_id text NOT NULL,
 workflow_id text NOT NULL,
 workflow_version_id text NOT NULL,
 revision integer NOT NULL CHECK (revision BETWEEN 1 AND 2147483647),
 graph_digest varchar(64) NOT NULL CHECK (graph_digest ~ '^[0-9a-f]{64}$'),
 publication_epoch integer NOT NULL CHECK (publication_epoch BETWEEN 1 AND 2147483647),
 node_id varchar(48) NOT NULL CHECK (node_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,47}$'
  AND node_id NOT IN ('constructor','prototype','__proto__')),
 agent_id text NOT NULL,
 agent_version_id text NOT NULL,
 agent_revision integer NOT NULL CHECK (agent_revision BETWEEN 1 AND 2147483647),
 agent_publication_epoch integer NOT NULL CHECK (agent_publication_epoch BETWEEN 1 AND 2147483647),
 ref jsonb NOT NULL,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ai_personal_workflow_publication_uuid_check CHECK
  (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 CONSTRAINT ai_personal_workflow_publication_epoch_key UNIQUE (workflow_id,publication_epoch),
 CONSTRAINT ai_personal_workflow_publication_id_scope_key UNIQUE (id,project_id,workspace_id,member_id),
 CONSTRAINT ai_personal_workflow_publication_project_fkey FOREIGN KEY (project_id)
  REFERENCES public.project_profile(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_workflow_publication_owner_fkey FOREIGN KEY (workflow_id,workspace_id,member_id)
  REFERENCES public.ai_personal_workflow(id,workspace_id,member_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_workflow_publication_version_fkey
  FOREIGN KEY (workflow_version_id,workflow_id,workspace_id,member_id,revision,graph_digest)
  REFERENCES public.ai_personal_workflow_version(id,workflow_id,workspace_id,member_id,revision,graph_digest)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_workflow_publication_agent_fkey
  FOREIGN KEY (agent_version_id,agent_id,workspace_id,member_id,agent_revision)
  REFERENCES public.ai_personal_agent_version(id,agent_id,workspace_id,member_id,revision)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_workflow_publication_binding_fkey
  FOREIGN KEY (workflow_version_id,workspace_id,member_id,node_id,agent_version_id)
  REFERENCES public.ai_personal_workflow_agent_binding(workflow_version_id,workspace_id,member_id,node_id,agent_version_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX ai_personal_workflow_publication_owner_idx
 ON public.ai_personal_workflow_publication(workspace_id,member_id,workflow_id,publication_epoch);
CREATE FUNCTION public.aij_workflow_publication_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'immutable workflow publication' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER ai_personal_workflow_publication_no_mutation
 BEFORE UPDATE OR DELETE ON public.ai_personal_workflow_publication
 FOR EACH ROW EXECUTE FUNCTION public.aij_workflow_publication_immutable();
CREATE TRIGGER ai_personal_workflow_publication_no_truncate
 BEFORE TRUNCATE ON public.ai_personal_workflow_publication
 FOR EACH STATEMENT EXECUTE FUNCTION public.aij_workflow_publication_immutable();

-- One ref projection, enforced by the same immutable publication owner.
ALTER TABLE public.ai_personal_workflow_publication ADD CONSTRAINT workflow_pub_origin_scope_uq UNIQUE(id,project_id,workspace_id,member_id,ref);
CREATE FUNCTION public.aij_workflow_publication_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h public.ai_personal_workflow%ROWTYPE; a public.ai_personal_agent%ROWTYPE; expected jsonb;
BEGIN
 SELECT * INTO h FROM public.ai_personal_workflow WHERE id=NEW.workflow_id AND workspace_id=NEW.workspace_id AND member_id=NEW.member_id FOR SHARE;
 IF NOT FOUND OR h.deleted_at IS NOT NULL OR h.revision<>NEW.revision OR h.graph_digest<>NEW.graph_digest OR NEW.publication_epoch::bigint<>h.publication_epoch::bigint+1 THEN
  RAISE EXCEPTION 'Publication must match current workflow' USING ERRCODE='23514';
 END IF;
 SELECT * INTO a FROM public.ai_personal_agent WHERE id=NEW.agent_id AND workspace_id=NEW.workspace_id AND member_id=NEW.member_id FOR SHARE;
 IF NOT FOUND OR a.deleted_at IS NOT NULL OR NOT a.enabled OR a.revision<>NEW.agent_revision OR a.published_revision IS DISTINCT FROM NEW.agent_revision OR a.publication_version<>NEW.agent_publication_epoch THEN
  RAISE EXCEPTION 'Publication Agent unavailable' USING ERRCODE='23514';
 END IF;
 expected := jsonb_build_object('id',NEW.id::text,'workflowId',NEW.workflow_id,'workflowVersionId',NEW.workflow_version_id,'revision',NEW.revision,'graphDigest',NEW.graph_digest,'publicationEpoch',NEW.publication_epoch,'nodeId',NEW.node_id,'agentId',NEW.agent_id,'agentVersionId',NEW.agent_version_id,'agentRevision',NEW.agent_revision,'agentPublicationEpoch',NEW.agent_publication_epoch);
 IF NEW.ref IS NOT NULL AND NEW.ref IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Publication ref mismatch' USING ERRCODE='23514'; END IF;
 NEW.ref := expected; RETURN NEW;
END; $$;
CREATE TRIGGER ai_personal_workflow_publication_insert BEFORE INSERT ON public.ai_personal_workflow_publication FOR EACH ROW EXECUTE FUNCTION public.aij_workflow_publication_insert();

-- Preserve original authoring/tombstone rules, admitting only an exact publication transition.
CREATE OR REPLACE FUNCTION public.aij_personal_workflow_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('ai-personal-workflows:'||NEW.workspace_id||':'||NEW.member_id,0));
  IF NEW.revision<>1 OR NEW.deleted_at IS NOT NULL OR NEW.initial_digest<>NEW.content_digest OR NEW.published_revision IS NOT NULL OR NEW.publication_epoch<>0 THEN
   RAISE EXCEPTION 'Invalid initial workflow draft' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM public.ai_personal_workflow WHERE workspace_id=NEW.workspace_id AND member_id=NEW.member_id AND deleted_at IS NULL)>=100 THEN
   RAISE EXCEPTION 'Personal workflow limit reached' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.member_id IS DISTINCT FROM OLD.member_id
    OR NEW.code IS DISTINCT FROM OLD.code OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.initial_digest IS DISTINCT FROM OLD.initial_digest OR OLD.deleted_at IS NOT NULL THEN
   RAISE EXCEPTION 'Personal workflow identity and tombstones are immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.published_revision IS DISTINCT FROM OLD.published_revision OR NEW.publication_epoch IS DISTINCT FROM OLD.publication_epoch THEN
   IF (to_jsonb(NEW)-'published_revision'-'publication_epoch') IS DISTINCT FROM (to_jsonb(OLD)-'published_revision'-'publication_epoch')
     OR NEW.publication_epoch::bigint<>OLD.publication_epoch::bigint+1
     OR (NEW.published_revision IS NOT NULL AND NEW.published_revision<>NEW.revision) THEN
    RAISE EXCEPTION 'Invalid workflow publication transition' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.deleted_at IS NOT NULL THEN
   IF (to_jsonb(NEW)-'deleted_at'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'deleted_at'-'updated_at') THEN
    RAISE EXCEPTION 'Deletion cannot change workflow content' USING ERRCODE='55000';
   END IF;
  ELSIF NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW.content_digest=OLD.content_digest THEN
   RAISE EXCEPTION 'Workflow edits require a changed next revision' USING ERRCODE='55000';
  END IF;
 END IF; RETURN NEW;
END; $$;
CREATE FUNCTION public.aij_workflow_publication_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.published_revision IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ai_personal_workflow_publication p WHERE p.workflow_id=NEW.id
  AND p.workspace_id=NEW.workspace_id AND p.member_id=NEW.member_id AND p.revision=NEW.published_revision AND p.publication_epoch=NEW.publication_epoch) THEN
  RAISE EXCEPTION 'Workflow publication requires immutable reference' USING ERRCODE='23514';
 END IF; RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER ai_personal_workflow_publication_head AFTER INSERT OR UPDATE ON public.ai_personal_workflow DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.aij_workflow_publication_head();

CREATE FUNCTION public.aij_workflow_publication_committed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ai_personal_workflow h WHERE h.id=NEW.workflow_id
  AND h.workspace_id=NEW.workspace_id AND h.member_id=NEW.member_id AND h.deleted_at IS NULL
  AND h.publication_epoch=NEW.publication_epoch AND h.published_revision=NEW.revision) THEN
  RAISE EXCEPTION 'Publication must commit with current head' USING ERRCODE='23514';
 END IF; RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER ai_personal_workflow_publication_committed AFTER INSERT ON public.ai_personal_workflow_publication
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.aij_workflow_publication_committed();

INSERT INTO public.client_workspace_permission(id,code,name,status,created_at,updated_at) VALUES
 ('af205-workflows-publish','workspace.ai.workflows.publish','Workspace own workflows publish','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('af205-workflows-execute','workspace.ai.workflows.execute','Workspace own workflows execute','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(code) DO NOTHING;
INSERT INTO public.client_workspace_role_permission(id,role_id,permission_id,created_at,updated_at)
SELECT 'af205_'||md5(r.id||':'||p.id),r.id,p.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM public.client_workspace_role r CROSS JOIN public.client_workspace_permission p
WHERE r.code='OWNER' AND r.is_system=true AND r.status='active' AND r.deleted_at IS NULL
 AND p.status='active' AND p.deleted_at IS NULL AND (
 (p.code='workspace.ai.workflows.publish' AND p.name='Workspace own workflows publish') OR
 (p.code='workspace.ai.workflows.execute' AND p.name='Workspace own workflows execute'))
ON CONFLICT(role_id,permission_id) DO NOTHING;
