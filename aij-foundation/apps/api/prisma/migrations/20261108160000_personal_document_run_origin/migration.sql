-- AF-227 registered additive document generation metadata relation.
-- Frozen source: 165338eb41eca99d3b779964a7e9f73f402a0d23.
-- Pattern: 20261107030000_personal_workflow_run_origin/migration.sql.
-- Root reviewed the frozen proposal and registers the matching Prisma model; verify
-- against the protected 55433 acceptance target. No workflow publication is used.
-- Existing compound UNIQUE targets (do not recreate them):
-- AiAgentRun -> ai_agent_run: ai_run_origin_scope_uq(id,project_id,workspace_id,member_id)
-- PersonalDocument -> personal_document: personal_document_scope_key(id,workspace_id,member_id)
-- PersonalDocumentVersion -> personal_document_version:
--   personal_document_version_revision_key(document_id,revision)
-- AiPersonalAgentVersion -> ai_personal_agent_version:
--   ai_personal_agent_version_publication_key(id,agent_id,workspace_id,member_id,revision)
-- ClientAuthSession -> client_auth_session: client_session_origin_member_uq(id,member_id)
-- Document/version IDs are uuid; Run/Agent/version/session IDs are text.
-- ClientAuthSession has NO token_version column: current token/session validation
-- remains ClientAuthService.assertSessionInTransaction, not an invented SQL field.

CREATE TABLE public.ai_personal_document_run_origin (
  run_id text PRIMARY KEY,
  project_id text NOT NULL,
  workspace_id text NOT NULL,
  member_id text NOT NULL,
  document_id uuid NOT NULL,
  document_revision integer NOT NULL CHECK (document_revision BETWEEN 1 AND 200),
  agent_id text NOT NULL CHECK (agent_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  agent_version_id text NOT NULL CHECK (agent_version_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  agent_revision integer NOT NULL CHECK (agent_revision BETWEEN 1 AND 2147483647),
  ref jsonb NOT NULL,
  session_id text NOT NULL,
  token_version integer NOT NULL CHECK (token_version >= 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT document_run_origin_run_fk FOREIGN KEY (run_id,project_id,workspace_id,member_id)
    REFERENCES public.ai_agent_run(id,project_id,workspace_id,member_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT document_run_origin_document_fk FOREIGN KEY (document_id,workspace_id,member_id)
    REFERENCES public.personal_document(id,workspace_id,member_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT document_run_origin_version_fk FOREIGN KEY (document_id,document_revision)
    REFERENCES public.personal_document_version(document_id,revision)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT document_run_origin_agent_fk FOREIGN KEY (agent_version_id,agent_id,workspace_id,member_id,agent_revision)
    REFERENCES public.ai_personal_agent_version(id,agent_id,workspace_id,member_id,revision)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT document_run_origin_session_fk FOREIGN KEY (session_id,member_id)
    REFERENCES public.client_auth_session(id,member_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- IS TRUE matters: a missing key/JSON null must never pass via SQL UNKNOWN.
  CONSTRAINT document_run_origin_ref_identity CHECK ((
    jsonb_typeof(ref) = 'object'
    AND ref ?& ARRAY['format','document','agentId','agentVersionId','agentRevision',
      'agentPublicationEpoch','catalogVersion','modelCode','modelRevision',
      'instructionSha256','inputSha256','maximumEstimatedCostNanos']
    AND (ref - ARRAY['format','document','agentId','agentVersionId','agentRevision',
      'agentPublicationEpoch','catalogVersion','modelCode','modelRevision',
      'instructionSha256','inputSha256','maximumEstimatedCostNanos']) = '{}'::jsonb
    AND ref->>'format' = 'aij-document-generation-v1'
    AND ref->'agentId' = to_jsonb(agent_id)
    AND ref->'agentVersionId' = to_jsonb(agent_version_id)
    AND ref->'agentRevision' = to_jsonb(agent_revision)
    AND jsonb_typeof(ref->'agentPublicationEpoch') = 'number'
    AND (ref->>'agentPublicationEpoch')::numeric BETWEEN 1 AND 2147483647
    AND (ref->>'agentPublicationEpoch')::numeric = trunc((ref->>'agentPublicationEpoch')::numeric)
    AND jsonb_typeof(ref->'catalogVersion') = 'number'
    AND (ref->>'catalogVersion')::numeric BETWEEN 1 AND 2147483647
    AND (ref->>'catalogVersion')::numeric = trunc((ref->>'catalogVersion')::numeric)
    AND jsonb_typeof(ref->'modelRevision') = 'number'
    AND (ref->>'modelRevision')::numeric BETWEEN 1 AND 2147483647
    AND (ref->>'modelRevision')::numeric = trunc((ref->>'modelRevision')::numeric)
    AND jsonb_typeof(ref->'modelCode') = 'string'
    AND ref->>'modelCode' ~ '^[a-z][a-z0-9-]{1,62}$'
    AND jsonb_typeof(ref->'instructionSha256') = 'string'
    AND ref->>'instructionSha256' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(ref->'inputSha256') = 'string'
    AND ref->>'inputSha256' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(ref->'maximumEstimatedCostNanos') = 'string'
    AND ref->>'maximumEstimatedCostNanos' ~ '^(0|[1-9][0-9]{0,18})$'
    AND (ref->>'maximumEstimatedCostNanos')::numeric <= 9223372036854775807
    AND jsonb_typeof(ref->'document') = 'object'
    AND (ref->'document') ?& ARRAY['format','indexFormat','documentId','revision',
      'bodySha256','sectionId','start','end','sectionSha256']
    AND ((ref->'document') - ARRAY['format','indexFormat','documentId','revision',
      'bodySha256','sectionId','start','end','sectionSha256']) = '{}'::jsonb
    AND ref #>> '{document,format}' = 'aij-document-section-source-v1'
    AND ref #>> '{document,indexFormat}' = 'aij-plain-sections-v1'
    AND ref #> '{document,documentId}' = to_jsonb(document_id::text)
    AND ref #> '{document,revision}' = to_jsonb(document_revision)
    AND jsonb_typeof(ref #> '{document,bodySha256}') = 'string'
    AND ref #>> '{document,bodySha256}' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(ref #> '{document,sectionSha256}') = 'string'
    AND ref #>> '{document,sectionSha256}' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(ref #> '{document,sectionId}') = 'string'
    AND ref #>> '{document,sectionId}' ~ '^section-(0|[1-9][0-9]?|1[01][0-9]|12[0-7])$'
    AND jsonb_typeof(ref #> '{document,start}') = 'number'
    AND jsonb_typeof(ref #> '{document,end}') = 'number'
    AND (ref #>> '{document,start}')::numeric = trunc((ref #>> '{document,start}')::numeric)
    AND (ref #>> '{document,end}')::numeric = trunc((ref #>> '{document,end}')::numeric)
    AND (ref #>> '{document,start}')::numeric >= 0
    AND (ref #>> '{document,end}')::numeric > (ref #>> '{document,start}')::numeric
    AND (ref #>> '{document,end}')::numeric <= 65536
    AND (ref #>> '{document,end}')::numeric - (ref #>> '{document,start}')::numeric <= 2000
  ) IS TRUE)
);
CREATE INDEX document_run_origin_owner_idx
  ON public.ai_personal_document_run_origin(project_id,workspace_id,member_id,run_id);
CREATE INDEX document_run_origin_document_idx
  ON public.ai_personal_document_run_origin(document_id,document_revision,run_id);

CREATE FUNCTION public.reject_document_run_origin_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable document run origin' USING ERRCODE='55000';
END $$;
CREATE TRIGGER document_run_origin_immutable
  BEFORE UPDATE OR DELETE ON public.ai_personal_document_run_origin
  FOR EACH ROW EXECUTE FUNCTION public.reject_document_run_origin_mutation();
CREATE TRIGGER document_run_origin_no_truncate
  BEFORE TRUNCATE ON public.ai_personal_document_run_origin
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_document_run_origin_mutation();

CREATE FUNCTION public.aij_document_run_origin_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r public.ai_agent_run%ROWTYPE;
  input_canonical text;
BEGIN
  -- Like the original workflow-origin guard, inspect the existing original Run.
  -- The owner already holds Job -> Run -> Document -> Memory/Agent in that order;
  -- do not reacquire Document/Agent/session locks here in reverse order.
  SELECT * INTO r FROM public.ai_agent_run WHERE id=NEW.run_id
    AND project_id=NEW.project_id AND workspace_id=NEW.workspace_id AND member_id=NEW.member_id
    FOR UPDATE;
  IF NOT FOUND OR r.content_purged_at IS NOT NULL
    OR (r.snapshot #> '{source,documentOrigin}') IS DISTINCT FROM NEW.ref
    OR r.snapshot #>> '{source,type}' IS DISTINCT FROM 'personal'
    OR (r.snapshot->'source') ? 'workflowOrigin'
    OR EXISTS (SELECT 1 FROM public.ai_personal_workflow_run_origin WHERE run_id=NEW.run_id)
    OR r.snapshot #>> '{source,agentId}' IS DISTINCT FROM NEW.agent_id
    OR r.snapshot #>> '{source,versionId}' IS DISTINCT FROM NEW.agent_version_id
    OR r.snapshot #> '{source,revision}' IS DISTINCT FROM to_jsonb(NEW.agent_revision)
    OR r.snapshot #> '{source,publicationVersion}' IS DISTINCT FROM NEW.ref->'agentPublicationEpoch'
    OR r.agent_code IS DISTINCT FROM 'personal:'||NEW.agent_id
    OR r.agent_revision IS DISTINCT FROM NEW.agent_revision
    OR to_jsonb(r.catalog_version) IS DISTINCT FROM NEW.ref->'catalogVersion'
    OR r.snapshot #>> '{agent,code}' IS DISTINCT FROM r.agent_code
    OR r.snapshot #> '{agent,revision}' IS DISTINCT FROM to_jsonb(NEW.agent_revision)
    OR r.snapshot #> '{agent,published}' IS DISTINCT FROM 'true'::jsonb
    OR r.snapshot #> '{agent,enabled}' IS DISTINCT FROM 'true'::jsonb
    OR r.snapshot #>> '{agent,outputFormat}' IS DISTINCT FROM 'text'
    OR r.snapshot #>> '{agent,modelCode}' IS DISTINCT FROM NEW.ref->>'modelCode'
    OR r.snapshot #>> '{model,capability}' IS DISTINCT FROM 'text'
    OR r.snapshot #>> '{model,code}' IS DISTINCT FROM NEW.ref->>'modelCode'
    OR r.snapshot #> '{model,revision}' IS DISTINCT FROM NEW.ref->'modelRevision'
    OR r.estimated_cost_nanos::text IS DISTINCT FROM NEW.ref->>'maximumEstimatedCostNanos'
  THEN
    RAISE EXCEPTION 'Document run snapshot origin mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT (jsonb_typeof(r.snapshot #> '{agent,inputFields}') = 'array'
    AND (r.snapshot #> '{agent,inputFields}') @> '["source","instruction"]'::jsonb
    AND jsonb_array_length(r.snapshot #> '{agent,inputFields}') = 2
    AND jsonb_typeof(r.input) = 'object'
    AND r.input ?& ARRAY['source','instruction']
    AND (r.input - ARRAY['source','instruction']) = '{}'::jsonb
    AND jsonb_typeof(r.input->'source') = 'string'
    AND jsonb_typeof(r.input->'instruction') = 'string') IS TRUE
  THEN
    RAISE EXCEPTION 'Document run input mismatch' USING ERRCODE='23514';
  END IF;
  -- Exact JSON.stringify([['instruction',redactedInstruction],['source',redactedSource]]).
  -- jsonb::text adds whitespace and is NOT this digest. to_json(text) supplies JSON
  -- string escaping; separators/order are explicit. Root must test Unicode/CRLF/
  -- quote/backslash/control escaping against JS and the actual server encoding.
  -- Never reconstruct instructionSha256 from the redacted stored instruction.
  input_canonical := '[["instruction",' || to_json(r.input->>'instruction')::text
    || '],["source",' || to_json(r.input->>'source')::text || ']]';
  IF encode(sha256(convert_to(input_canonical,'UTF8')),'hex') IS DISTINCT FROM NEW.ref->>'inputSha256'
  THEN
    RAISE EXCEPTION 'Document run input digest mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_run_origin_insert BEFORE INSERT ON public.ai_personal_document_run_origin
  FOR EACH ROW EXECUTE FUNCTION public.aij_document_run_origin_insert();

-- Suggested additive companion guard: the old workflow insert guard knows only
-- workflowOrigin and would otherwise accept a later mixed marker. Root must review
-- this cross-owner DDL together with the document relation; no old function is replaced.
-- Both insertion directions serialize on the SAME original Run row (FOR UPDATE),
-- then inspect the other relation after that lock, including concurrent inserts.
CREATE FUNCTION public.aij_workflow_run_reject_document_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r public.ai_agent_run%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.ai_agent_run WHERE id=NEW.run_id FOR UPDATE;
  IF (r.snapshot->'source') ? 'documentOrigin'
    OR EXISTS (SELECT 1 FROM public.ai_personal_document_run_origin WHERE run_id=NEW.run_id)
  THEN
    RAISE EXCEPTION 'Mixed document and workflow run origin' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workflow_run_origin_document_exclusion
  BEFORE INSERT ON public.ai_personal_workflow_run_origin
  FOR EACH ROW EXECUTE FUNCTION public.aij_workflow_run_reject_document_origin();

-- No Run/Job/Trace/reserve/settle/request/output rows are introduced here.
-- No cascade, retention deletion, session bypass, current-source authorization,
-- section parser or raw source/instruction copy is implemented in this relation.
-- The original seven-day purge may clear Run.input/output/snapshot, while this
-- immutable relation remains: marker OR relation must fence all legacy routes.
