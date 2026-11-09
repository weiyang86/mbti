# AF-209 root wiring — candidate only

Task `task_3704f0a8142a`, Dispatch `ctx_5a49485b701d`. Worker owns only the six allowed new paths. This document requests root changes; none below is claimed integrated or PostgreSQL verified. CONTRACT SHA256 `6081e956e0a2714d9b0c3732e529ccbe8fdfa11f0ccdccdb74afbf4286d97dd3` controls this work.

## Original Skill owner adapter (required before enablement)

In `apps/api/src/plugins/aij-ai/ai-personal-skills.service.ts`, implement the exported `PersonalScriptSkillAccess` structural contract using its existing scope/owned/snapshot/audit implementation. Do not copy that owner into the extension service. Bind `{provide: PersonalScriptSkillAccess,useExisting: AiPersonalSkillsService}` and `AiPersonalScriptSkillService` in the original aij-ai module. Inject the original `PrismaService` (also optional in extension: missing access/prisma fails 503). No constructor fallback creates an alternate owner or opens a server.

- `withCurrent(scope,skillId,permissions,authorize,operation)` opens exactly the original owner transaction; fences original project/org/plugin lifecycle, actual member/workspace/grants for **every** permission; takes original Skill scope advisory then head/version locks; verifies active owned head and exact current immutable snapshot (name/instructions/revision); invokes original session gate; calls operation with that SAME tx and `ScriptSkillCurrent={projectId,skillId,skillVersionId,revision,name,instructions}`. `projectId` must be the actual `ProjectProfile.id` from original runtime access, never a DTO/config code. Do not call the original public update method as it has a no-change shortcut and a separate transaction.
- `currentInTransaction` performs the same checks/locks in the supplied tx without nested transactions. Running callers already hold original Job→scriptRun locks after lifecycle/member/grants, so keep original Skill lock order. Reuse lifecycle authorization internals rather than opening another transaction. Session is checked after head/version locks.
- Refactor existing `snapshot` to return the inserted actual version ID; existing prompt-only callers can ignore that return. `appendVersionInTransaction` CAS checks current revision, rejects max INT, updates name/instructions/revision+1 with scoped CAS, ALWAYS snapshots even unchanged name/instructions, audits through original owner in supplied tx, and returns the actual new version ID. It must not invoke a nested owner transaction. The extension validates revision+1/new ID/same skill/project/content; INSERT and extension body-free audit use the same tx, so any original audit or extension audit failure rolls back head/version/extension together.
- Keep original prompt-only update no-change behavior. Existing prompt versions and Agent pins do not change.

Permission owner `apps/api/src/client-workspaces/client-workspace-permissions.ts`: add actual `P.aiScriptsManage='workspace.ai.scripts.manage'` and `P.aiScriptsExecute='workspace.ai.scripts.execute'`, register/grant through original role policy (not aliases or inferred execute access). Candidate uses these exact literals until root owns registration; root may replace literals with these P members. Requested sets are create assets.manage+scripts.manage; source assets.read+scripts.manage; runtime assets.read+ai.execute+scripts.execute; result read assets.read+ai.read+scripts.execute. Never catch 403 and try another mode.

`readVersion` uses an initial scoped immutable extension lookup through original PrismaService solely to discover the original opaque Skill ID. It then opens `withCurrent` and repeats the scoped extension lookup and integrity check INSIDE its authorization tx; no lock or transaction is kept across those two queries. `resolveInTransaction` and `resolveForReadInTransaction` use the caller tx and distinct permission sets. All reads require exact current head/version/project/revision, source bytes digest and fixed policy; historic source reads are deliberately unavailable after head change.

## Schema and migration (root exclusively)

Use Prisma model `AiPersonalScriptVersion` mapped to `ai_personal_script_version`, camelCase fields mapped to the SQL columns below, `id String @id @db.Uuid`, all original IDs as `String`/text, revision Int, source/digests String, createdAt DateTime @db.Timestamp(3). Add relations/backrelations to actual ProjectProfile and exact SkillVersion. Preserve original migration history; create a new reviewed migration only in root. The following DDL is a concrete proposal, NOT executed by worker:

```sql
ALTER TABLE public.ai_personal_skill_version ADD CONSTRAINT ai_personal_skill_version_script_ref_key
  UNIQUE (id,skill_id,workspace_id,member_id,revision);
CREATE TABLE public.ai_personal_script_version (
 id uuid PRIMARY KEY,
 project_id text NOT NULL,
 workspace_id text NOT NULL,
 member_id text NOT NULL,
 skill_id text NOT NULL,
 skill_version_id text NOT NULL,
 revision integer NOT NULL CHECK (revision BETWEEN 1 AND 2147483647),
 script_source text NOT NULL CHECK (octet_length(script_source) BETWEEN 1 AND 65536),
 script_digest text NOT NULL CHECK (script_digest ~ '^[0-9a-f]{64}$'),
 policy_digest text NOT NULL CHECK (policy_digest = 'f069cddadeaa30648a61bc2bcc93a817c9f4147c3d3f808936b30db7e12c4aef'),
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ai_personal_script_source_hash CHECK
   (script_digest=encode(sha256(convert_to(script_source,'UTF8')),'hex')),
 CONSTRAINT ai_personal_script_version_original_fkey
   FOREIGN KEY (skill_version_id,skill_id,workspace_id,member_id,revision)
   REFERENCES public.ai_personal_skill_version(id,skill_id,workspace_id,member_id,revision)
   ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_script_version_project_fkey FOREIGN KEY (project_id)
   REFERENCES public.project_profile(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_script_version_original_key UNIQUE(skill_version_id),
 CONSTRAINT ai_personal_script_version_scope_key UNIQUE(id,project_id,workspace_id,member_id)
);
CREATE FUNCTION public.ai_personal_script_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Immutable personal script version';
END; $$;
CREATE TRIGGER ai_personal_script_version_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.ai_personal_script_version
 FOR EACH STATEMENT EXECUTE FUNCTION public.ai_personal_script_version_immutable();
```

Run only in root protected fresh UTF8 PostgreSQL test target; PostgreSQL UTF8 text itself rejects malformed encoding/NUL. Explicitly test byte boundaries, digest CHECK, policy CHECK, INT bounds, original version mismatch, workspace/member mismatch, project FK, unique original version, all mutation operations (including no-row UPDATE/DELETE and TRUNCATE), actual rollback on late original/extension audit and session failure. Original Skill has no project column; the authoritative association to the actual project is supplied by original runtime adapter, not a fabricated workspace→project mapping. A valid-but-other project must fail runtime current/ref comparison; root acceptance must prove this and reject a forged association at insertion via trusted adapter (or add equivalent INSERT trigger runtime-project guard). If original scope later supports several projects, add a real scoped original project association rather than claiming the standalone project FK proves it.

No source copy goes into head, original prompt snapshots, audit, job payload, SDK URLs, errors, or AI trace. INSERT binds source parameter only in this extension owner. Audit fields are IDs/revision/digests only.

## Agent prompt safety hooks (root required)

1. `AiPersonalAgentsService.bindings` in `ai-personal-agents.service.ts`: after resolving each precise original version, detect extension by `skill_version_id` + workspace/member (and actual runtime project if available), reject script-bearing version with bounded `ConflictException('Executable Skill binding unavailable')`. Do not silently strip the script.
2. `AiPersonalAgentSnapshotsService` in `ai-personal-agent-snapshots.service.ts`: before converting loaded Skill bindings to prompt snapshots, detect ANY extension on those precise version IDs and reject the same way. This shared snapshot path must protect preview, dispatch and workflow Agent resolution. Confirm all resolver call sites actually flow through it.
3. Agent publication paths (including publication of older Agent versions) must run this check; resolve exact bound version, not only the latest Skill head. Existing old prompt-only Agent pins still resolve even if the Skill later gains a new script-bearing revision. New script-bearing pins must never yield prompt-only success.
4. Add regression coverage at binding/publish/preview/dispatch, plus original prompt-only unchanged behavior. This candidate does not claim Agent executable binding.

## Parser/ports for downstream integration

`ai-personal-script-skill-contract.ts` exports fixed `SCRIPT_POLICY_BYTES`, `SCRIPT_POLICY_DIGEST`, source/ref validators, `scriptInputCanonical`, `parseScriptJson` and `scriptRequestHash`. Hash sequence is JSON.stringify array `['personal-script-v1',scriptVersionId,skillId,skillVersionId,revision,scriptDigest,policyDigest,inputCanonical]` in the fixed ScriptRef field order; no name/source/instructions/session. All values are original validated values; source is never trimmed. Root and AF210 must freeze this precise request domain together; do not change original Run idempotency hashing.

`parseScriptJson(Buffer,maxBytes=65536)` rejects invalid UTF8/BOM, duplicate decoded keys, unsafe keys, isolated surrogates, nonfinite numbers, prefixes/second documents and depth/entries/byte overflow. Returned object is for validation/use; original stdout Buffer stays authoritative for attachment bytes. HTTP root may call the parser with original 100kb transport cap then apply DTO source limits; AF210 inputs use 16384 bytes and outputs 65536. Always parse raw bytes before ordinary JSON parsing loses duplicate-key evidence. Never convert source/input text to logs. Strict source validates UTF8 Unicode text, NUL and bytes; it deliberately does not claim a Python syntax check or sandbox execution.

Public signatures are exactly CONTRACT `createVersion`, `readVersion`, `resolveInTransaction`, `resolveForReadInTransaction`. Root binds controller asset port to this service; AF210 must use its own structural matching runtime port without importing an unfinished candidate. SessionGate is original `ClientAuthService.assertSessionInTransaction` bound by trusted Guard-derived claims only; never sourced from DTO. Optional gates support internal trusted composition, not unauthenticated HTTP operation.

## Root acceptance and handoff

No root verify:task/DB/migration/seed/server/Docker/browser/full API build/Linux/native/vendor/full40 ran here. Root must apply schema/adapter/permissions/module/Agent safety, register AF209 checks, run targeted tests plus fresh PG success/refusal/concurrency/rollback and original Skill/Agent regressions, then applicable exact gates and original-name integration commit. Complete actual I209 only after root evidence; I210 must reference that real completed task ID. Candidate is not CODE_VERIFIED or owner accepted. Continue I209→I210→I211 only under approved W19 budget.
