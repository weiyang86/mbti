# AF-210 root wiring — candidate, NOT CODE_VERIFIED

Task task_e5c8d3cc5a4a / Dispatch ctx_8be747aa51ca. Source 4cfb95436d894f9145662ecbd79c2ea1075c417c; bootstrap 6fe46418c3a8738e5f255f423305b980dc1164aa. Integrate only after actual completed I209 Task ID; no unfinished peer import and no candidate-as-CODE dependency.

## Original owner composition

- Register AiPersonalScriptRunsService, AiPersonalScriptExecutionService, ScriptSandboxConfiguration once in original aij-ai module. Execution.onModuleInit is sole registerOrchestratedJob call for `aij-ai.personal-script-execute@1`; do not duplicate registration in module constructor. JobService direct enqueue, payload only runId, maxAttempts1, timeout120000. No new scheduler/AI Run/Trace/cost.
- ScriptRuntimeConfiguration → useExisting ScriptSandboxConfiguration; ScriptSkillRuntimePort → useExisting I209 AiPersonalScriptSkillService; ScriptExecutionAuthPort → original ClientAuthService; ScriptGeneratedFilesPort → original GeneratedFileAssetsService after hooks below. Missing dependencies fail503.
- SCRIPT_SANDBOX_OPTIONS is trusted root config only, default disabled. Enabled requires fixed normalized absolute Docker CLI and approved docker.io/library/python@sha256 digest. One shared runner instance per process, forced maxConcurrency1. `configured` is config syntax/readiness, not Docker probe, capacity, vendor or script success. Worker never reads real env or invokes host Python.
- ScriptRunAccessPort.withCurrent must open original short ReadCommitted transaction, lock lifecycle project/org/plugin → member/grants and validate ALL supplied exact permissions, then invoke callback with real ProjectProfile.id/member/workspace. Do not prelock Skill/session: callback locks original Job → scriptRun → original Skill → startup session. Reuse original services, no copied auth owner.
- Actual permission strings are workspace.ai.assets.read, workspace.ai.execute, workspace.ai.read; root registers workspace.ai.scripts.execute/manage and grants according to owner policy. Capability checks assets.read/session before checking execute permissions; no fake ai.* aliases.
- Original JobService claim/execute must pass attempt,maxAttempts,leaseOwner,leaseNonce,signal. Worker only reads/locks original Job, never writes scheduler fields. Every critical short transaction uses clock_timestamp lease checks both before and after Skill/session/file/audit waits.
- Root existing retention maintenance calls execution.purgeExpiredInputs; no new scheduler. Expiry nulls private input and preserves key/hash/source identity, expired API access410, no rerun. Original file owner controls eventual file purge; no cascade deleting run identities.

## Root GeneratedFileAssetsService hooks

1. Extend original format union with json, MIME application/json, exact script-<runUUID>.json name, 1..65536 bytes, checksum SHA256. Fatal UTF8 decode then exported outputBytes validation covers full JSON/duplicates/depth16/entries2048/finite/Unicode/dangerous keys. Preserve stdout UTF8 bytes including whitespace. Existing PDF/DOCX checks must remain unchanged.
2. Keep original stage/commitInTransaction/confirm/discard and WeakMap-owned GeneratedFileTicket. Script commit+FileAsset+outcome+audit share one transaction; ticket never serializes and no storage owner is copied.
3. Add metadataInTransaction(tx,assetId,scope):GeneratedFileMetadata, original scoped active asset validation: project/workspace/plugin aij-ai/ownerType user/ownerId/uploaderId, JSON name/mime/size/checksum. No IO.
4. Add prepareReadInTransaction(tx,assetId,scope):object and readPrepared(ticket):Buffer. First reuses original metadata/ownership checks and returns instance-owned opaque one-use WeakMap ticket containing frozen storage identity, no IO. Second consumes ticket and uses original FileContentService.read outside caller DB transactions, bounding bytes and validating hash/strictJSON, clearing bytes on failure. Preserve original readInTransaction compatibility via these internals. Script GET authorizes before preparation and again after storage IO with current query session, not original startup session.
5. Original discard currently holds a file advisory transaction across storage.remove. Worker invokes it outside all authorization/Job locks, but CONTRACT forbids any DB lock across storage IO: root must refactor cleanup safely. A durable file-owner cleanup reservation/fence must reject pending commit while deletion runs without locks; first transaction checks exact committed identity/objectKey and retains any committed match, then IO, then final bookkeeping. Preserve original same-instance ticket identity and unknown-commit readback. This is required root work, not claimed implemented here; if budget insufficient split/fail acceptance rather than relax locking.
6. After unknown final commit/confirm, worker calls original discard (which must retain committed files) then exact run/job/scope/asset/SUCCESS relation readback. A failed readback stays uncertain, never reruns. Cleanup is outside revoked session/source gates; no blind deletion. A committed asset must not be removed on confirm error.

## Root schema and migration (not run)

Prisma model AiPersonalScriptRun maps new relation below. UUID only id/scriptVersionId; original Job/File/session IDs remain text. Use timestamp(3) matching original DateTime. Worker captures a single timestamp(3) clock value for created/expires.

```sql
CREATE TABLE public.ai_personal_script_run (
 id uuid PRIMARY KEY,
 project_id text NOT NULL, workspace_id text NOT NULL, member_id text NOT NULL,
 script_version_id uuid NOT NULL, skill_ref jsonb NOT NULL,
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 input jsonb, session_id text NOT NULL, token_version integer NOT NULL CHECK(token_version>=0),
 job_id text NOT NULL UNIQUE,
 attempted_at timestamp(3), outcome text, output_asset_id text,
 created_at timestamp(3) NOT NULL, expires_at timestamp(3) NOT NULL,
 content_purged_at timestamp(3),
 UNIQUE(project_id,workspace_id,member_id,request_key),
 CHECK(expires_at=created_at+interval '7 days'),
 CHECK((outcome='SUCCESS') IS NOT TRUE OR (attempted_at IS NOT NULL AND output_asset_id IS NOT NULL)),
 CHECK(output_asset_id IS NULL OR outcome='SUCCESS'),
 CHECK(outcome IS NULL OR outcome IN ('SUCCESS','DISABLED','INVALID_CONFIGURATION','INVALID_INPUT','BUSY','ABORTED','TIMEOUT','OUTPUT_LIMIT','INVALID_UTF8','IMAGE_UNAVAILABLE','EXECUTION_FAILED','SCRIPT_NONZERO','OOM_KILLED','CLEANUP_UNCONFIRMED','DENIED','UNKNOWN','INVALID_OUTPUT')),
 CHECK((content_purged_at IS NULL AND input IS NOT NULL) OR (content_purged_at IS NOT NULL AND input IS NULL)),
 FOREIGN KEY(script_version_id,project_id,workspace_id,member_id)
 REFERENCES public.ai_personal_script_version(id,project_id,workspace_id,member_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(session_id,member_id) REFERENCES public.client_auth_session(id,member_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX ai_personal_script_run_expiry_idx ON public.ai_personal_script_run(expires_at) WHERE content_purged_at IS NULL;
```

Root adds unique originals runtime_job(id,scope_id,workspace_id) / file_asset(id,project_id,workspace_id,owner_id), then scoped FKs from (job_id,project_id,workspace_id) / (output_asset_id,project_id,workspace_id,member_id). Session/member composite unique exists in frozen schema. Additional constraint triggers enforce Job plugin/type/version/payload={runId}/maxAttempts and asset plugin/user/uploader because plain scoped FKs cannot encode these predicates.

Extension triggers reject DELETE/TRUNCATE and immutable identity/ref/request/session/job/created/expires changes. Allow input only to SQL NULL at expiry with content_purged_at>=expires_at (JSON null remains valid initial input). attempted_at only NULL→timestamp; outcome only NULL→terminal; output_asset_id only NULL→asset together with SUCCESS. Validate six-field skill_ref exactly against scoped AF209 immutable version including fixed policy/source digest; preserve original project/member/workspace references. No independent transaction side effects or duplicate scheduling state. Relation is executable input/source/result extension, never AI AgentRun.

## Required root evidence — all NOT_RUN here

Real completed I209 dependency, protected fresh PG migration, two connections same key oneJob, original claim/execute and fixed official Linux Docker image, original FileAsset download checksum. Source/head/deletion/member/grants/session/nonce/clock expiration before/after IO, audit rollback, unknown attempted/cleanup no rerun, unknown file commit retained/readback, retention, disabled capability and malformed JSON. Verify no locks across Docker/stage/read/cleanup, original AF175 noNetwork/noMount/noCredentials/resource/OOM/PIDs/timeout/output/abort/ownedcleanup assertions. Original prompt Skill/Agent/Job/File/PDF/DOCX/doc-export regressions, API heavy checks and verify:task root only. Native/full40/vendor/owner acceptance not claimed; no server or URL running.
