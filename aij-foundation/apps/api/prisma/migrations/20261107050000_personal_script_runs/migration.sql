-- Additive original-Job/source/result relation; no second scheduling or AI cost ledger.
ALTER TABLE public.runtime_job ADD CONSTRAINT runtime_job_script_scope_key UNIQUE(id,scope_id,workspace_id);
ALTER TABLE public.file_asset ADD CONSTRAINT file_asset_script_owner_key UNIQUE(id,project_id,workspace_id,owner_id);
CREATE TABLE public.generated_file_cleanup_fence (
 asset_id text PRIMARY KEY, object_key text NOT NULL UNIQUE,
 reserved_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, removed_at timestamp(3)
);
CREATE FUNCTION public.generated_file_cleanup_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('aij-generated-file:'||NEW.id,0));
 IF NEW.object_key IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('aij-generated-object:'||NEW.object_key,0));
 END IF;
 IF EXISTS(SELECT 1 FROM public.generated_file_cleanup_fence WHERE asset_id=NEW.id OR object_key=NEW.object_key) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Generated file cleanup reserved';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER generated_file_cleanup_insert_guard BEFORE INSERT OR UPDATE OF id,object_key ON public.file_asset
 FOR EACH ROW EXECUTE FUNCTION public.generated_file_cleanup_insert_guard();

CREATE TABLE public.ai_personal_script_run (
 id uuid PRIMARY KEY, project_id text NOT NULL, workspace_id text NOT NULL, member_id text NOT NULL,
 script_version_id uuid NOT NULL, skill_ref jsonb NOT NULL,
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 -- json preserves escaped U+0000 in legal JSON strings/keys; jsonb cannot represent it.
 input json CHECK(input IS NULL OR octet_length(input::text)<=16384), session_id text NOT NULL, token_version integer NOT NULL CHECK(token_version>=0),
 job_id text NOT NULL CONSTRAINT ai_personal_script_run_job_id_key UNIQUE,
 attempted_at timestamp(3), outcome text, output_asset_id text,
 created_at timestamp(3) NOT NULL, expires_at timestamp(3) NOT NULL, content_purged_at timestamp(3),
 CONSTRAINT ai_personal_script_run_job_scope_key UNIQUE(job_id,project_id,workspace_id),
 CONSTRAINT ai_personal_script_run_request_key UNIQUE(project_id,workspace_id,member_id,request_key),
 CHECK(expires_at=created_at+interval '7 days'),
 CHECK((outcome='SUCCESS') IS NOT TRUE OR (attempted_at IS NOT NULL AND output_asset_id IS NOT NULL)),
 CHECK(output_asset_id IS NULL OR outcome IS NOT DISTINCT FROM 'SUCCESS'),
 CHECK(outcome IS NULL OR outcome IN ('SUCCESS','DISABLED','INVALID_CONFIGURATION','INVALID_INPUT','BUSY','ABORTED','TIMEOUT','OUTPUT_LIMIT','INVALID_UTF8','IMAGE_UNAVAILABLE','EXECUTION_FAILED','SCRIPT_NONZERO','OOM_KILLED','CLEANUP_UNCONFIRMED','DENIED','UNKNOWN','INVALID_OUTPUT')),
 CHECK((content_purged_at IS NULL AND input IS NOT NULL) OR (content_purged_at IS NOT NULL AND input IS NULL)),
 CONSTRAINT ai_personal_script_run_source_fkey FOREIGN KEY(script_version_id,project_id,workspace_id,member_id)
  REFERENCES public.ai_personal_script_version(id,project_id,workspace_id,member_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ai_personal_script_run_job_fkey FOREIGN KEY(job_id,project_id,workspace_id)
  REFERENCES public.runtime_job(id,scope_id,workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ai_personal_script_run_session_fkey FOREIGN KEY(session_id,member_id)
  REFERENCES public.client_auth_session(id,member_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ai_personal_script_run_asset_fkey FOREIGN KEY(output_asset_id,project_id,workspace_id,member_id)
  REFERENCES public.file_asset(id,project_id,workspace_id,owner_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX ai_personal_script_run_expiry_idx ON public.ai_personal_script_run(expires_at) WHERE content_purged_at IS NULL;
CREATE FUNCTION public.ai_personal_script_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v public.ai_personal_script_version; j public.runtime_job; a public.file_asset;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.project_id,NEW.workspace_id,NEW.member_id,NEW.script_version_id,NEW.skill_ref,NEW.request_key,NEW.request_hash,NEW.session_id,NEW.token_version,NEW.job_id,NEW.created_at,NEW.expires_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.workspace_id,OLD.member_id,OLD.script_version_id,OLD.skill_ref,OLD.request_key,OLD.request_hash,OLD.session_id,OLD.token_version,OLD.job_id,OLD.created_at,OLD.expires_at) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable script origin';
  END IF;
  IF NEW.input::text IS DISTINCT FROM OLD.input::text OR NEW.content_purged_at IS DISTINCT FROM OLD.content_purged_at THEN
   IF OLD.content_purged_at IS NOT NULL OR NEW.input IS NOT NULL OR NEW.content_purged_at IS NULL OR NEW.content_purged_at<NEW.expires_at OR clock_timestamp()<NEW.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid script retention';
   END IF;
  END IF;
  IF (OLD.attempted_at IS NOT NULL AND NEW.attempted_at IS DISTINCT FROM OLD.attempted_at)
   OR (OLD.outcome IS NOT NULL AND NEW.outcome IS DISTINCT FROM OLD.outcome)
   OR (OLD.output_asset_id IS NOT NULL AND NEW.output_asset_id IS DISTINCT FROM OLD.output_asset_id) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable script outcome';
  END IF;
 ELSE
  IF NEW.attempted_at IS NOT NULL OR NEW.outcome IS NOT NULL OR NEW.output_asset_id IS NOT NULL OR NEW.content_purged_at IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Script run must start pending';
  END IF;
 END IF;
 SELECT * INTO v FROM public.ai_personal_script_version WHERE id=NEW.script_version_id;
 IF NOT FOUND OR NEW.skill_ref IS DISTINCT FROM jsonb_build_object('scriptVersionId',v.id::text,'skillId',v.skill_id,'skillVersionId',v.skill_version_id,'revision',v.revision,'scriptDigest',v.script_digest,'policyDigest',v.policy_digest) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid script source reference';
 END IF;
 SELECT * INTO j FROM public.runtime_job WHERE id=NEW.job_id;
 IF NOT FOUND OR j.scope<>'plugin' OR j.scope_id<>NEW.project_id OR j.workspace_id IS DISTINCT FROM NEW.workspace_id OR j.plugin_code<>'aij-ai'
  OR j.job_type<>'aij-ai.personal-script-execute' OR j.job_version<>1 OR j.max_attempts<>1 OR j.payload IS DISTINCT FROM jsonb_build_object('runId',NEW.id::text) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid original script job';
 END IF;
 -- Mutable attachment availability gates the initial publication, not subsequent lawful erasure.
 IF NEW.output_asset_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.output_asset_id IS DISTINCT FROM OLD.output_asset_id) THEN
  SELECT * INTO a FROM public.file_asset WHERE id=NEW.output_asset_id;
  IF NOT FOUND OR a.project_id IS DISTINCT FROM NEW.project_id OR a.workspace_id IS DISTINCT FROM NEW.workspace_id OR a.plugin_code IS DISTINCT FROM 'aij-ai'
   OR a.owner_type<>'user' OR a.owner_id IS DISTINCT FROM NEW.member_id OR a.uploader_id IS DISTINCT FROM NEW.member_id
   OR a.mime_type<>'application/json' OR a.original_name<>'script-'||NEW.id::text||'.json' OR a.size NOT BETWEEN 1 AND 65536
   OR a.checksum IS NULL OR a.checksum !~ '^[a-f0-9]{64}$' OR a.status<>'active' OR a.deleted_at IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid original script attachment';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ai_personal_script_run_guard BEFORE INSERT OR UPDATE ON public.ai_personal_script_run
 FOR EACH ROW EXECUTE FUNCTION public.ai_personal_script_run_guard();
CREATE FUNCTION public.ai_personal_script_run_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable script request identity'; END; $$;
CREATE TRIGGER ai_personal_script_run_no_delete BEFORE DELETE OR TRUNCATE ON public.ai_personal_script_run
 FOR EACH STATEMENT EXECUTE FUNCTION public.ai_personal_script_run_no_delete();
