# AF-210 接入私有Skill的受控异步脚本执行 — candidate handoff

Status: CANDIDATE_ONLY / ROOT_INTEGRATION_PENDING, not CODE_VERIFIED or owner accepted. Sole worker stopped all writing after candidate commit and handoff; coordinator is next Writer. No push/remote issue/PR/main/tag/deploy/release.

## Provenance and identity

- Task task_e5c8d3cc5a4a; Dispatch ctx_8be747aa51ca; terminal term_252738c1-b606-4e1b-bbe1-29a3f66699a8.
- Registered Worktree ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W19-AF210, instance 0c67de4c-7dcb-411e-9bd6-5964441c726f; branch AIJ-W19-AF210.
- First HEAD 94b0236f775fa40a07944c5e0545ac6ce0e123f3, clean; remote git@github.com:weiyang86/aij-foundation.git. No branch switch.
- Read main root AGENTS and frozen CONTRACT; CONTRACT SHA256 6081e956e0a2714d9b0c3732e529ccbe8fdfa11f0ccdccdb74afbf4286d97dd3; SOURCE_BOOTSTRAP SHA256 df4fb08a26cde63273f7689c74d030b202fd06aa5fdfae15dff5feadaee0c6ef.
- Materialized exactly 910 manifest paths from immutable `git show 4cfb95436d894f9145662ecbd79c2ea1075c417c:path`, each SHA256 verified. Source-only bootstrap 6fe46418c3a8738e5f255f423305b980dc1164aa, title `W19 verified source-only bootstrap`.
- Candidate commit title exactly `接入私有Skill的受控异步脚本执行`; candidate SHA returned in worker_done/readback (cannot self-embed commit hash). Only six new paths below relative to bootstrap. No root inherited AF191/203/UI/playbook or peer code copied.

## Exact candidate paths and impact

1. apps/api/src/plugins/aij-ai/ai-personal-script-run-profile.ts — fixed policy/digest/ref/request hash, strict canonical input and strict single-document stdout JSON validators.
2. apps/api/src/plugins/aij-ai/ai-personal-script-runs.service.ts — actual atomic enqueue/admission/replay/audit, read/recover/content/capability, original owner structural ports. New raw SQL only script input/source/result relation; original Job projected.
3. apps/api/src/plugins/aij-ai/ai-personal-script-execution.service.ts — original registry/runner composition; durable attemptedAt, nonce/clock lease checks, original startup session, strict output, stage/final commit/confirm and unknown commit readback. Input retention helper uses original maintenance scheduling.
4. scripts/verification/personal-script-runtime.test.mjs — actual implemented branches with explicitly synthetic SQL, auth, file owner and runner collaborators; no Docker or PG claim.
5. docs/planning/auto-ai-program-20261105/W19/AF-210-ROOT_WIRING.md — exact shared root hooks/schema proposal/real acceptance requirements.
6. docs/execution/AF-210-candidate.md — this evidence/limitations record.

DB: proposed one extension relation; no DB created/connected/migrated/seeded. API: five service methods ready for root/C controller wiring, no server started. Page/UI: none. Permissions: fixed actual workspace permission strings via required original root access adapter, startup and current query sessions separated. Audit: only run/job/outcome, no source/input/stdout/stderr/runner diagnostic; no duplicate model/trace/cost state. Source/input/output remain private RAM or authorized extension/FileAsset ownership. Runtime resultReference only fixed bounded codes.

## Verification and failures retained

- `pnpm install --frozen-lockfile --ignore-scripts`: exit0, private worktree deps, no shared node_modules.
- `pnpm --filter @aij/api exec prisma generate --config prisma.config.mjs`: exit0; config skips dotenv, schema-only generated client; no database access.
- `pnpm --filter @aij/runtime-contracts --filter @aij/core --filter @aij/contracts build`: exit0, only small private package builds.
- `pnpm --filter @aij/api exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module commonjs --moduleResolution node --experimentalDecorators --emitDecoratorMetadata --esModuleInterop src/plugins/aij-ai/ai-personal-script-runs.service.ts src/plugins/aij-ai/ai-personal-script-execution.service.ts src/plugins/aij-ai/ai-personal-script-run-profile.ts`: initial compiler exit2 (pnpm wrapper exit1) TS7023 recursive relation return type; fixed explicit Promise<ScriptRow>, rerun exit0.
- `pnpm exec eslint apps/api/src/plugins/aij-ai/ai-personal-script-{run-profile,runs.service,execution.service}.ts scripts/verification/personal-script-runtime.test.mjs --max-warnings=0`: initial lint exit1 sparse array test literal; replaced by Array(2) with same rejection coverage; rerun exit0.
- `node --test scripts/verification/personal-script-runtime.test.mjs`: final exit0, 15/15. Added primitive boundary test initially exit1 due test strict array-reference comparison; corrected deepEqual assertion, no product relaxation. Covers canonical boundaries/getters/proxies/duplicate keys, fixed digest, disabled/missingDI, replay/conflict/audit rollback simulation, real registration/orchestration branches, no simulated locks across IO, unknown attempts/no rerun, cleanup/invalid output, startup/late revocation, stale lease, committed unknown readback, current query session, byte clearing, expiry and capability separation.
- `git diff --check` / staged exact path check: exit0. Bootstrap Git commands emitted preexisting AppleDouble `._pack-*.idx non-monotonic index` warnings but exited0; all blob checks passed, no Git metadata cleanup attempted.
- One documentation creation attempt exit1 because new W19 directory did not exist; created authorized parent directory and wrote the document successfully. This was not a verification pass.

## Not run / remaining root work

PG/schema/migration/seed, true concurrent same-key transactions, actual SQL constraints/clock lease behavior, original JobService.claim/execute, real Docker/container/security/resources, actual original GeneratedFileAssets bytes/unknown commit, API/fullNext/heavybuild/root verify:task/browser/native/Linux deployment/vendor/full40/owner acceptance: **NOT_RUN**. Tests intentionally use synthetic collaborators and do not prove them. No URL or service is running.

Root must implement shared lifecycle/member/grants adapter, A/auth/file/config DI, JSON FileAsset validation and safe split read, metadata hook, original discard safe no-lock IO cleanup fence, scoped schema/immutability constraints, permission registration and retention hook. In particular original discard holds a file advisory transaction across storage.remove; worker has not changed that shared owner. This is a material integration condition, not a hidden pass. Preserve real failure/NOT_RUN if root cannot meet it within budget. Detailed signatures/schema in ROOT_WIRING.

Manual/root acceptance: after completed I209 actual Task ID, integrate only this candidate delta; wire shared owners; run protected fresh PG and original Job claim/execute with approved fixed official image; submit/replay/recover/download/check SHA256; two-connection oneJob; revoke source/owner/grants/session/nonce or expire lease before/after IO; inject audit/commit-return failures and assert no rerun/no orphan/deletion of committed asset; expiry410, default-off503 and capability; original prompt/Agent/Job/File/PDF/DOCX/document-export regressions. Complete registered verify:task and formal I210 before I211 CODE dependency. Candidate task is not integration ID.

Worker effective time approximately 0.3h including bootstrap/install/implementation/self-review/checks; below 2.5h cap. Root remaining allowance 1.5h under card4h, but adapter/migration/real Docker/cleanup refactor must be budgeted honestly and split if forecast exceeds cap. Self-review is not independent review. Root owns next Writer after explicit STOP ALL WRITING handoff.
