# AF-206 root wiring — candidate only

Source: immutable 2ee9172a30be7694dc2cb097a43fbce1f0a14e65 and W18 CONTRACT R1 (SHA256 b2340b8926523bfaf435ef0d21938ba25adbbfa9d8ecc22496709d4d38b532da). No other candidate imported. This is **not CODE_VERIFIED**. Root must integrate after actual I205 CODE_VERIFIED, before I207. Workers did not change schema, modules, original runtime, formal queue or registry.

## DI and adapters (required; absent ports fail 503)

Register `AiPersonalWorkflowRunOriginService`, `AiPersonalWorkflowRunsService` in the original AI module. Bind `PersonalWorkflowRunOriginPort` with useExisting origin service; bind `WorkflowPublicationRuntimePort` with useExisting AF205 `AiPersonalWorkflowPublicationService`, implementing BOTH `resolveInTransaction` and `resolveForReadInTransaction`; bind `WorkflowSessionPort` with useExisting original `ClientAuthService` (export/import original module). This is the SAME original session owner/namespace, never a new token verifier. Runtime `resolveInTransaction` must invoke supplied gate after workflow lock, before Agent, including existing-idempotency paths. It must never call snapshot.resolve or lock Agent/Memory in this runtime resolver.

Implement `WorkflowRunDriver` with a narrow adapter forwarding `submitWorkflow/read/recoverRequest` to original `AiCenterRunService` (dates remain Date internally). Inject original `AiPersonalAgentRunPreviewsService` directly. Do not turn submitWorkflow into submitPersonal or nested submitSource transactions.

Implement `WorkflowRunReadAccess`:

- `withCurrent<T>(member, workspace, permissions, operation(tx, scope))`: one short ReadCommitted transaction (maxWait 5000/timeout 10000); acquire original plugin/project/org, member/grant, scoped config locks; scope.projectId MUST be actual ProjectProfile.id. Require all supplied permissions, then invoke operation. No Agent lock in this prelude. No IO across transaction.
- `assertAgentCurrent(tx,scope,ref)`: after operation's publication/session check, use original configuration.current + original personalSnapshots.resolve(tx,current,member,workspace,ref.agentId,ref.agentRevision), compare source.versionId/revision/publicationVersion to ref and agent.code/revision. No second snapshot owner; no Memory lock needed for read-only readiness. Validate dependencies through original resolver. Throw fixed 409 for mismatch, preserve auth 401/403. Runtime separately uses original Memory/Agent validation.
- `locate` uses original run scoped by current project/member/workspace, its own immutable relation, then current publication and **query claims**. Query claims need not equal stored origin claims. No Run snapshot needed for recovery after content purge. Session fields never serialized. Submit post-check uses EXECUTE permissions, GET checks use READ permissions.
- R1 corrects the root contract defect identified in the original candidate: GET must NOT inherit ai.execute. `read/recover` locate uses `resolveReadOrigin` → A.`resolveForReadInTransaction`, requiring exactly ai.assets.read+ai.read+workspace.ai.workflows.execute. `submit` pre/post and `preview` use `resolveOrigin` → A.`resolveInTransaction`, requiring ai.assets.read+ai.execute+workspace.ai.workflows.execute. Runtime admission/dispatch and recordOrigin's prior admission fence remain execution-only. Both origin methods share strict current ref/project/input/session checks; neither falls back after 403. Private locate purpose is selected by the server method, never client DTO. Missing read port fails 503. Both A resolvers preserve identical workflow/version/epoch/binding/session/lock-order semantics and do not lock Agent/Memory early. Original query-session versus startup-session separation remains unchanged.

## Exact original owner hooks

Line anchors below refer to frozen source, not future line numbers.

1. `ai-center-run.service.ts`, immediately after submitPersonal (source lines 76–80): add server-only `submitWorkflow(memberId,workspaceId,raw:{publicationId,input,idempotencyKey},claims:ClientClaims,correlationId?)`. DTO/Guard claims never accepted from body. Strict body keys and original input/key rules. Pass a discriminated internal source context into submitSource, preserving both legacy branches and hashes byte-for-byte.
2. In submitSource, after admissionContext and the EXISTING idempotency advisory (lines 92–93), call origin.resolveOrigin(tx,{projectId:c.projectId,memberId,workspaceId},publicationId,claims). Require workflow.execute through the original grant owner BEFORE scoped config. Resolve current publication/session BEFORE testing previous hash. Compute `workflowRequestHash(origin.ref, ORIGINAL validated input)`; normalization/redaction remains after hashing, matching original rules. Publication inputFields must equal resolved Agent inputFields and actual input keys. Existing row: same hash AND persisted relation/ref validation; otherwise fixed 409. Never alias personal/catalog/another publication. Never automatically retry POST.
3. New admission retains original `personalMemories.select → personalSnapshots.resolve` order using origin.ref agent ID/revision. Add `workflowOrigin: workflowRef(origin.ref)` only to original personal snapshot.source, preserving memoryRefs/skills. `assertWorkflowSnapshot(s,origin.ref,origin.inputFields)` checks actual resolved versionId/revision/publicationVersion; do this before reserve. Never resolve Agent before waiting on workflow.
4. Immediately after original aiAgentRun.create (source line 115), call `recordOrigin(tx,run,origin,claims)` before publicRun. Original reserve, one maxAttempts:1 job, Run, immutable origin insert, and metadata-only audit must commit/rollback together. No second reserve, job, Trace, cost or status owner. recordOrigin does not reacquire session/workflow after Agent; it relies on resolveOrigin's held fences. SQL/audit errors propagate, never swallowed or treated as idempotent success.
5. Add `workflowOrigin?: WorkflowRef` to original PersonalAgentSnapshotSource in `ai-personal-agent-snapshots.service.ts` (source lines 10–15), using a type-only import from B. Keep type='personal'. Original resolver never supplies the marker itself.
6. At the START of original validateSnapshot (source line 184), before the no-source branch and Memory/Agent locks, call origin.assertOriginCurrent(tx,run). All THREE execute call sites already run after original lockRun and eligibility checks: first dispatch before trace/credential (217), credential IO return before provider/attemptedAt (241), provider/storage return before settlement (265). A lost lease must fail at lockRun BEFORE origin, and repeated lockRun after waiting on workflow/Memory/Agent must remain. Missing port with marker is fail-closed; detect a relation with missing marker too (root may always require this port after migration, while legacy no-marker/no-relation returns unchanged).
7. Only after successful origin check, remove the known workflowOrigin extension from comparison copy, along with existing memoryRefs deletion (validateSnapshot lines 198–201). `withoutWorkflowMarker(s,verifiedRef)` is supplied for this purpose; preserves ALL unknown extensions. Don't strip arbitrary keys or change original deep equality. Continue original Memory→Agent/Skill checks, including original Agent publicationVersion, after workflow/session validation.
8. Leave catch/finishFailure/failLocked, uncertain reserve preservation, lease nonce/attemptedAt, maxAttempts1, storage cleanup, Trace failure and terminal cleanup behavior intact. Never gate safe failure cleanup on a now-revoked workflow/session. Unknown remains unknown; RuntimeJob.completed is not Run.succeeded.

LOCK ORDER: plugin/project/org → member/grants → scoped catalog → admission idempotency OR dispatch Job→Run → workflow advisory/head/publication → original session → original Memory/grants → Agent/Skill → settlement. No secret/provider/storage IO inside these transactions. Queries/readiness cannot hold locks while delegating driver or preview: B deliberately ends its pre-check transaction and starts a fresh post-check.

## Root-only SQL / Prisma proposal

Origin service uses raw SQL with exact table/column names below. Existing IDs are text, publication ID is UUID; do not cast legacy asset IDs to UUID. AF205 root publication must expose immutable `ref jsonb` equal to its exact typed columns (or generate that JSON from them); B stores the exact public ref, no body. If A stores expanded ref columns, root can add the ref generated column/constraint to that original publication relation, not another publication truth.

```sql
ALTER TABLE public.ai_agent_run ADD CONSTRAINT ai_run_origin_scope_uq
  UNIQUE(id,project_id,workspace_id,member_id);
-- AF205 publication table: ref equals its full immutable public WorkflowRef.
ALTER TABLE public.ai_personal_workflow_publication ADD CONSTRAINT workflow_pub_origin_scope_uq
  UNIQUE(id,project_id,workspace_id,member_id,ref);
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
BEGIN RAISE EXCEPTION 'immutable workflow run origin'; END $$;
CREATE TRIGGER workflow_run_origin_immutable BEFORE UPDATE OR DELETE ON public.ai_personal_workflow_run_origin
  FOR EACH ROW EXECUTE FUNCTION public.reject_workflow_run_origin_mutation();
CREATE TRIGGER workflow_run_origin_no_truncate BEFORE TRUNCATE ON public.ai_personal_workflow_run_origin
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_workflow_run_origin_mutation();
```

AF205 publication constraints must enforce exact JSON ref keys, lowerhex64, integer bounds, id equality, and its scoped version/Agent binding FKs, so origin's composite FK cannot reference another owner/ref. FK's NULL bypass prevented by NOT NULL. Use matching Prisma scalar mappings: runId String @id @map("run_id"), publicationId String @db.Uuid, projectId/workspaceId/memberId/sessionId String, tokenVersion Int, ref Json, createdAt DateTime @db.Timestamptz; @@map("ai_personal_workflow_run_origin"). Add inverse relations/composite uniques in original models. There is deliberately no FK to mutable member.tokenVersion: changing it must invalidate dispatch, not prevent password rotation. Session expiry/revocation is a read fence, not deletion. Coordinate eventual session retention with immutable references; no cascade or trigger bypass. Original Run cleanup clears content but retains the Run row and origin.

## Required actual root evidence, not supplied by collaborator tests

Fresh isolated PG constraints: cross-project/member/workspace/ref FKs; duplicate run relation; update/delete/truncate denial; audit failure rolls back Run+reserve+Job+origin. Original runtime/admission: concurrent same key one reserve/job/Run/Trace, conflicts across source/publications, no auto retry, workflow and Agent ABA, session rotation/password/tokenVersion/revocation, known marker missing relation/port, unknown extension, no Agent-before-workflow deadlock, lease loss while awaiting workflow and stale nonce. Check original three phases with real credential/provider/storage barriers and revoked auth; assert no provider before second gate and no success settlement after third gate, original unknown/budget/cleanup preserved. Check GET using newer same-owner session, 401/403/404/410/503 and late read/preview authorization, original legacy hashes/results/regressions. Then actual HTTP and installed packed SDK, required types/build/lint/verify:task. No vendor/native/Linux/full40 acceptance inferred.

R1 root acceptance addition: actual PG/HTTP permission matrix must permit read/recover with all READ grants and no ai.execute, deny each missing READ grant without provider/enqueue/reserve, and deny execution/preview/runtime without ai.execute even when READ grants exist; repeat after late IO grant revocation and with a new query session. The 21 collaborator tests are not that actual acceptance evidence. Prior candidate/history remains preserved.
