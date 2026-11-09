CREATE TABLE public.personal_document_export (
 id uuid PRIMARY KEY,
 document_id uuid NOT NULL,
 workspace_id text NOT NULL,
 member_id text NOT NULL,
 project_id text NOT NULL REFERENCES public.project_profile(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 revision integer NOT NULL CHECK (revision BETWEEN 1 AND 200),
 file_asset_id text NOT NULL,
 format text NOT NULL CHECK (format IN ('docx','pdf')),
 renderer_version text NOT NULL CHECK (renderer_version = 'aij-plain-document-v1'),
 page_count integer,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT personal_document_export_scope_fk FOREIGN KEY (document_id,workspace_id,member_id)
   REFERENCES public.personal_document(id,workspace_id,member_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT personal_document_export_revision_fk FOREIGN KEY (document_id,revision)
   REFERENCES public.personal_document_version(document_id,revision) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT personal_document_export_file_fk FOREIGN KEY (file_asset_id,workspace_id)
   REFERENCES public.file_asset(id,workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT personal_document_export_tuple_key UNIQUE(document_id,revision,format,renderer_version),
 CONSTRAINT personal_document_export_file_key UNIQUE(file_asset_id),
 CONSTRAINT personal_document_export_pages_check CHECK (
   (format='docx' AND page_count IS NULL) OR
   (format='pdf' AND page_count IS NOT NULL AND page_count BETWEEN 1 AND 100))
);
CREATE INDEX personal_document_export_owner_idx ON public.personal_document_export(workspace_id,member_id,document_id,revision);
CREATE FUNCTION public.personal_document_export_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable document export' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER personal_document_export_immutable_trigger BEFORE UPDATE OR DELETE ON public.personal_document_export
 FOR EACH ROW EXECUTE FUNCTION public.personal_document_export_immutable();
CREATE TRIGGER personal_document_export_no_truncate BEFORE TRUNCATE ON public.personal_document_export FOR EACH STATEMENT EXECUTE FUNCTION public.personal_document_export_immutable();

-- Incremental export permission; do not reactivate disabled definitions/roles.
INSERT INTO public.client_workspace_permission(id,code,name,status,created_at,updated_at)
VALUES ('af202_documents_export','workspace.documents.export','Workspace own document exports','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.client_workspace_role_permission(id,role_id,permission_id,created_at,updated_at)
SELECT 'af202_'||md5(r.id||':'||p.id),r.id,p.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM public.client_workspace_role r CROSS JOIN public.client_workspace_permission p
WHERE r.code='OWNER' AND r.is_system=true AND r.status='active' AND r.deleted_at IS NULL
AND p.code='workspace.documents.export' AND p.name='Workspace own document exports' AND p.status='active' AND p.deleted_at IS NULL
ON CONFLICT(role_id,permission_id) DO NOTHING;
