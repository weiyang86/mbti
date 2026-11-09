-- PROPOSAL ONLY. Root applies to protected freshAF170 after STOPPED, never Worker DB.
-- Requires AF-159 immutable private Agent versions; no old runtime/Agent/Memory rows altered.
CREATE TABLE public.ai_personal_workflow (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, member_id TEXT NOT NULL,
 code VARCHAR(63) NOT NULL CHECK (char_length(code) BETWEEN 2 AND 63 AND code ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
 name VARCHAR(100) NOT NULL CHECK (char_length(btrim(name))>0 AND btrim(name)=name),
 graph JSONB NOT NULL CHECK (COALESCE(jsonb_typeof(graph)='object' AND graph ?& ARRAY['schemaVersion','inputKeys','nodes','edges'] AND graph->'schemaVersion'='1'::jsonb AND jsonb_typeof(graph->'nodes')='array' AND jsonb_typeof(graph->'edges')='array' AND jsonb_typeof(graph->'inputKeys')='array' AND octet_length(graph::text)<=65536,false)),
 graph_digest VARCHAR(64) NOT NULL CHECK (graph_digest ~ '^[0-9a-f]{64}$'),
 content_digest VARCHAR(64) NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
 initial_digest VARCHAR(64) NOT NULL CHECK (initial_digest ~ '^[0-9a-f]{64}$'),
 revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>=1),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL, deleted_at TIMESTAMP(3),
 CONSTRAINT ai_personal_workflow_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.client_workspace(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ai_personal_workflow_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.member_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX ai_personal_workflow_id_scope_key ON public.ai_personal_workflow(id,workspace_id,member_id);
CREATE UNIQUE INDEX ai_personal_workflow_owner_code_key ON public.ai_personal_workflow(workspace_id,member_id,code);
CREATE INDEX ai_personal_workflow_owner_page_idx ON public.ai_personal_workflow(workspace_id,member_id,deleted_at,id);
CREATE INDEX ai_personal_workflow_member_idx ON public.ai_personal_workflow(member_id);
CREATE TABLE public.ai_personal_workflow_version (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, workspace_id TEXT NOT NULL, member_id TEXT NOT NULL,
 code VARCHAR(63) NOT NULL, name VARCHAR(100) NOT NULL,
 graph JSONB NOT NULL CHECK (COALESCE(jsonb_typeof(graph)='object' AND graph ?& ARRAY['schemaVersion','inputKeys','nodes','edges'] AND graph->'schemaVersion'='1'::jsonb AND jsonb_typeof(graph->'nodes')='array' AND jsonb_typeof(graph->'edges')='array' AND jsonb_typeof(graph->'inputKeys')='array' AND octet_length(graph::text)<=65536,false)),
 graph_digest VARCHAR(64) NOT NULL CHECK (graph_digest ~ '^[0-9a-f]{64}$'),
 content_digest VARCHAR(64) NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
 revision INTEGER NOT NULL CHECK (revision>=1), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 agent_binding_count SMALLINT NOT NULL CHECK (agent_binding_count BETWEEN 0 AND 64),
 CONSTRAINT ai_personal_workflow_version_owner_fkey FOREIGN KEY (workflow_id,workspace_id,member_id)
 REFERENCES public.ai_personal_workflow(id,workspace_id,member_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX ai_personal_workflow_version_id_scope_key ON public.ai_personal_workflow_version(id,workspace_id,member_id);
CREATE UNIQUE INDEX ai_personal_workflow_version_revision_key ON public.ai_personal_workflow_version(workflow_id,revision);
CREATE INDEX ai_personal_workflow_version_owner_idx ON public.ai_personal_workflow_version(workspace_id,member_id,workflow_id,revision);
CREATE TABLE public.ai_personal_workflow_agent_binding (
 id TEXT PRIMARY KEY, workflow_version_id TEXT NOT NULL, workspace_id TEXT NOT NULL, member_id TEXT NOT NULL,
 node_id VARCHAR(48) NOT NULL CHECK (node_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,47}$' AND node_id NOT IN ('constructor','prototype','__proto__')),
 agent_version_id TEXT NOT NULL,
 CONSTRAINT ai_personal_workflow_binding_owner_fkey FOREIGN KEY (workflow_version_id,workspace_id,member_id)
 REFERENCES public.ai_personal_workflow_version(id,workspace_id,member_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ai_personal_workflow_binding_agent_fkey FOREIGN KEY (agent_version_id,workspace_id,member_id)
 REFERENCES public.ai_personal_agent_version(id,workspace_id,member_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX ai_personal_workflow_binding_node_key ON public.ai_personal_workflow_agent_binding(workflow_version_id,node_id);
CREATE INDEX ai_personal_workflow_binding_agent_idx ON public.ai_personal_workflow_agent_binding(agent_version_id,workspace_id,member_id);

CREATE FUNCTION public.aij_personal_workflow_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Personal workflow retained history is immutable' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER ai_personal_workflow_retained BEFORE DELETE OR TRUNCATE ON public.ai_personal_workflow
FOR EACH STATEMENT EXECUTE FUNCTION public.aij_personal_workflow_immutable();
CREATE TRIGGER ai_personal_workflow_version_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.ai_personal_workflow_version
FOR EACH STATEMENT EXECUTE FUNCTION public.aij_personal_workflow_immutable();
CREATE TRIGGER ai_personal_workflow_binding_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.ai_personal_workflow_agent_binding
FOR EACH STATEMENT EXECUTE FUNCTION public.aij_personal_workflow_immutable();
CREATE FUNCTION public.aij_personal_workflow_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('ai-personal-workflows:'||NEW.workspace_id||':'||NEW.member_id,0));
   IF NEW.revision<>1 OR NEW.deleted_at IS NOT NULL OR NEW.initial_digest<>NEW.content_digest THEN
     RAISE EXCEPTION 'Invalid initial workflow draft' USING ERRCODE='23514';
   END IF;
   IF (SELECT count(*) FROM public.ai_personal_workflow WHERE workspace_id=NEW.workspace_id AND member_id=NEW.member_id AND deleted_at IS NULL)>=100 THEN
     RAISE EXCEPTION 'Personal workflow limit reached' USING ERRCODE='23514';
   END IF;
 ELSE
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.code IS DISTINCT FROM OLD.code OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.initial_digest IS DISTINCT FROM OLD.initial_digest OR OLD.deleted_at IS NOT NULL THEN
     RAISE EXCEPTION 'Personal workflow identity and tombstones are immutable' USING ERRCODE='55000';
   END IF;
   IF NEW.deleted_at IS NOT NULL THEN
     IF (to_jsonb(NEW)-'deleted_at'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'deleted_at'-'updated_at') THEN
       RAISE EXCEPTION 'Deletion cannot change workflow content' USING ERRCODE='55000';
     END IF;
   ELSIF NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW.content_digest=OLD.content_digest THEN
     RAISE EXCEPTION 'Workflow edits require a changed next revision' USING ERRCODE='55000';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ai_personal_workflow_identity BEFORE INSERT OR UPDATE ON public.ai_personal_workflow
FOR EACH ROW EXECUTE FUNCTION public.aij_personal_workflow_identity();

CREATE FUNCTION public.aij_personal_workflow_refs(g JSONB) RETURNS TABLE(node_id TEXT,agent_id TEXT,revision INTEGER)
LANGUAGE sql IMMUTABLE STRICT AS $$
 WITH RECURSIVE bodies(body,depth) AS (
   SELECT g,1 UNION ALL SELECT n->'body',b.depth+1 FROM bodies b,
   LATERAL jsonb_array_elements(b.body->'nodes') n WHERE n->>'type'='loop' AND b.depth<4
 ) SELECT n->>'id',n->>'agentId',(n->>'revision')::integer FROM bodies b,
 LATERAL jsonb_array_elements(b.body->'nodes') n WHERE n->>'type'='agent';
$$;
CREATE FUNCTION public.aij_personal_workflow_snapshot_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w public.ai_personal_workflow%ROWTYPE;
BEGIN
 SELECT * INTO w FROM public.ai_personal_workflow WHERE id=NEW.workflow_id AND workspace_id=NEW.workspace_id AND member_id=NEW.member_id FOR SHARE;
 IF NOT FOUND OR w.deleted_at IS NOT NULL OR NEW.revision<>w.revision OR NEW.code<>w.code OR NEW.name<>w.name OR NEW.graph<>w.graph
   OR NEW.graph_digest<>w.graph_digest OR NEW.content_digest<>w.content_digest OR NEW.created_at<>w.updated_at
   OR NEW.agent_binding_count<>(SELECT count(*) FROM public.aij_personal_workflow_refs(NEW.graph)) THEN
   RAISE EXCEPTION 'Workflow snapshot must match current draft' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ai_personal_workflow_snapshot_insert BEFORE INSERT ON public.ai_personal_workflow_version
FOR EACH ROW EXECUTE FUNCTION public.aij_personal_workflow_snapshot_insert();
CREATE FUNCTION public.aij_personal_workflow_binding_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- The node is an exact authored Agent ref; no arbitrary snapshots or copied prompt data.
 PERFORM a.id FROM public.ai_personal_workflow_version w,
 LATERAL public.aij_personal_workflow_refs(w.graph) r,
 public.ai_personal_agent_version v JOIN public.ai_personal_agent a ON a.id=v.agent_id AND a.workspace_id=v.workspace_id AND a.member_id=v.member_id
 WHERE w.id=NEW.workflow_version_id AND w.workspace_id=NEW.workspace_id AND w.member_id=NEW.member_id
   AND r.node_id=NEW.node_id AND r.agent_id=v.agent_id AND r.revision=v.revision
   AND v.id=NEW.agent_version_id AND v.workspace_id=NEW.workspace_id AND v.member_id=NEW.member_id AND a.deleted_at IS NULL
 FOR SHARE OF a,v;
 IF NOT FOUND THEN RAISE EXCEPTION 'Workflow Agent reference unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ai_personal_workflow_binding_insert BEFORE INSERT ON public.ai_personal_workflow_agent_binding
FOR EACH ROW EXECUTE FUNCTION public.aij_personal_workflow_binding_insert();
CREATE FUNCTION public.aij_personal_workflow_binding_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT count(*) FROM public.ai_personal_workflow_agent_binding WHERE workflow_version_id=NEW.id)<>NEW.agent_binding_count THEN
   RAISE EXCEPTION 'Workflow immutable binding list incomplete' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER ai_personal_workflow_binding_complete AFTER INSERT ON public.ai_personal_workflow_version
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.aij_personal_workflow_binding_complete();
CREATE FUNCTION public.aij_personal_workflow_snapshot_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.ai_personal_workflow_version v WHERE v.workflow_id=NEW.id AND v.workspace_id=NEW.workspace_id AND v.member_id=NEW.member_id
   AND v.revision=NEW.revision AND v.code=NEW.code AND v.name=NEW.name AND v.graph=NEW.graph
   AND v.graph_digest=NEW.graph_digest AND v.content_digest=NEW.content_digest) THEN
   RAISE EXCEPTION 'Workflow current draft requires immutable snapshot' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER ai_personal_workflow_snapshot_complete AFTER INSERT OR UPDATE ON public.ai_personal_workflow
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.aij_personal_workflow_snapshot_complete();
