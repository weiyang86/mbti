CREATE TABLE public.personal_document (
 id uuid PRIMARY KEY,
 workspace_id text NOT NULL,
 member_id text NOT NULL,
 code text NOT NULL CHECK (char_length(code) BETWEEN 2 AND 63 AND code ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
 body text NOT NULL CHECK (octet_length(body) <= 65536),
 revision integer NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 200),
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 deleted_at timestamp(3),
 CONSTRAINT personal_document_owner_fk FOREIGN KEY (workspace_id,member_id)
 REFERENCES public.client_workspace_membership(workspace_id,member_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT personal_document_scope_key UNIQUE(id,workspace_id,member_id),
 CONSTRAINT personal_document_code_key UNIQUE(workspace_id,member_id,code)
);
CREATE INDEX personal_document_owner_idx ON public.personal_document(workspace_id,member_id,deleted_at,id);
CREATE TABLE public.personal_document_version (
 id uuid PRIMARY KEY,
 document_id uuid NOT NULL,
 workspace_id text NOT NULL,
 member_id text NOT NULL,
 revision integer NOT NULL CHECK (revision BETWEEN 1 AND 200),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
 body text NOT NULL CHECK (octet_length(body) <= 65536),
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT personal_document_version_scope_fk FOREIGN KEY(document_id,workspace_id,member_id)
 REFERENCES public.personal_document(id,workspace_id,member_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT personal_document_version_revision_key UNIQUE(document_id,revision)
);
CREATE INDEX personal_document_version_owner_idx ON public.personal_document_version(workspace_id,member_id,document_id,revision);
CREATE FUNCTION public.personal_document_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'personal document history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER personal_document_version_immutable BEFORE UPDATE OR DELETE ON public.personal_document_version
FOR EACH ROW EXECUTE FUNCTION public.personal_document_history_immutable();
CREATE TRIGGER personal_document_version_no_truncate BEFORE TRUNCATE ON public.personal_document_version
FOR EACH STATEMENT EXECUTE FUNCTION public.personal_document_history_immutable();
CREATE TRIGGER personal_document_no_delete BEFORE DELETE ON public.personal_document
FOR EACH ROW EXECUTE FUNCTION public.personal_document_history_immutable();
CREATE TRIGGER personal_document_no_truncate BEFORE TRUNCATE ON public.personal_document
FOR EACH STATEMENT EXECUTE FUNCTION public.personal_document_history_immutable();
CREATE FUNCTION public.personal_document_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.revision<>1 OR NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'invalid initial document' USING ERRCODE='23514'; END IF;
 ELSE
   IF OLD.deleted_at IS NOT NULL OR (NEW.id,NEW.workspace_id,NEW.member_id,NEW.code,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.member_id,OLD.code,OLD.created_at) THEN
      RAISE EXCEPTION 'immutable document identity or tombstone' USING ERRCODE='23514';
   END IF;
   IF (NEW.name,NEW.body) IS DISTINCT FROM (OLD.name,OLD.body) THEN
     IF NEW.revision<>OLD.revision+1 OR NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'invalid document save' USING ERRCODE='23514'; END IF;
   ELSIF NEW.revision<>OLD.revision THEN RAISE EXCEPTION 'revision without save' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER personal_document_guard BEFORE INSERT OR UPDATE ON public.personal_document
FOR EACH ROW EXECUTE FUNCTION public.personal_document_head_guard();
CREATE FUNCTION public.personal_document_version_append_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h public.personal_document;
BEGIN
 SELECT * INTO h FROM public.personal_document WHERE id=NEW.document_id AND workspace_id=NEW.workspace_id AND member_id=NEW.member_id FOR UPDATE;
 IF NOT FOUND OR h.deleted_at IS NOT NULL OR (h.revision,h.name,h.body,h.updated_at) IS DISTINCT FROM (NEW.revision,NEW.name,NEW.body,NEW.created_at) THEN
   RAISE EXCEPTION 'version must match current owned head' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER personal_document_version_append BEFORE INSERT ON public.personal_document_version
FOR EACH ROW EXECUTE FUNCTION public.personal_document_version_append_guard();
CREATE FUNCTION public.personal_document_head_has_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h public.personal_document;
BEGIN
 SELECT * INTO h FROM public.personal_document WHERE id=NEW.id;
 IF NOT EXISTS(SELECT 1 FROM public.personal_document_version v WHERE v.document_id=h.id AND v.workspace_id=h.workspace_id AND v.member_id=h.member_id
   AND v.revision=h.revision AND v.name=h.name AND v.body=h.body) THEN
   RAISE EXCEPTION 'document head requires matching immutable version' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER personal_document_matching_version AFTER INSERT OR UPDATE ON public.personal_document
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.personal_document_head_has_version();
-- Add new permissions without reactivating disabled definitions or revoked grants.
INSERT INTO public.client_workspace_permission(id,code,name,status,created_at,updated_at)
VALUES ('af190_documents_read','workspace.documents.read','Workspace own documents read','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('af190_documents_manage','workspace.documents.manage','Workspace own documents manage','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.client_workspace_role_permission(id,role_id,permission_id,created_at,updated_at)
SELECT 'af190_'||md5(r.id||':'||p.id),r.id,p.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM public.client_workspace_role r CROSS JOIN public.client_workspace_permission p
WHERE r.code='OWNER' AND r.is_system=true AND r.status='active' AND r.deleted_at IS NULL
AND p.code IN ('workspace.documents.read','workspace.documents.manage') AND p.status='active' AND p.deleted_at IS NULL
AND ((p.code='workspace.documents.read' AND p.name='Workspace own documents read') OR (p.code='workspace.documents.manage' AND p.name='Workspace own documents manage'))
ON CONFLICT(role_id,permission_id) DO NOTHING;
