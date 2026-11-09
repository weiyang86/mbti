# AF-215 candidate — 实现工作台同任务验收的组合适配层

Status: candidate only, not CODE_VERIFIED; final candidate SHA is supplied by the exact-Dispatch worker_done receipt. Writer will STOP ALL WRITING after the exact-title candidate commit and confirmed handoff. Root formal verification/integration/owner acceptance remain outstanding.

## Identity and source

- actualTask `task_349ebfa0d142`; Dispatch `ctx_af44a9fff04e`; worker handle `term_efa53a73-d713-4a56-ac2a-d475152ccb67`.
- Registered WT `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W20-AF215`; instance `013877fe-a36c-4128-a6ec-d6fa40ad87f1`; branch `weiyang86/AIJ-W20-AF215`.
- Initial HEAD and verified actual origin/dev `94b0236f775fa40a07944c5e0545ac6ce0e123f3`; remote `git@github.com:weiyang86/aij-foundation.git`; initial status clean (initial receipt `msg_eadfe2ed719e`). No branch switch, push or other repo write.
- Read original root AGENTS and W20 CONTRACT (SHA256 `9c40f7e10b129535fc2fd490f58b86ba4212d1a0ad4473b216b805827ca8b40c`) before implementation. SOURCE_BOOTSTRAP SHA256 `0dd96fc9dbe0b3652a2f1d82e577d1aeb39a36ea2d897ea1673f0e6da653220b` matched; materialized only its961 exact blobs via one read-only git cat-file batch from immutable `129aa515b5c7fd8a3269d97b3521136fc641f59d`, verifying SHA256 before and after write.
- Separate bootstrap commit `9cf1fac8afcc0ae35686e3e5c0209ee8fc07cf41`, title `W20 verified source-only bootstrap`. Candidate diff is measured from this commit; bootstrap is not for root cherry-pick. Pending AF191/203/live-root implementation and user changes were neither read nor copied.
- Actual I dependencies: `task_753e493b8c33` and W20 governance `task_04ba27b7c5dd`, confirmed by coordinator `msg_34ecfcf52ed0`. Missing native case/port schemas were clarified in that same receipt; no shared contract was changed.

## Exact five-path delta

1. `scripts/verification/workbench-sdk-target-adapter.mjs`: actual runtime composition and original delegated owner methods, opaque unknown error propagation/no retries, bounded private HTTP hashes, one outside consumer mount, actual driver-only native receipt admission, idempotent measured cleanup with failure propagation.
2. `scripts/verification/workbench-sdk-target-adapter-evidence.mjs`: same-task ready lease projection, canonical fixed cases, full tgz/source/installed/lock graph/hash assertions, narrow original DB/counter evidence, native PNG/binding/time/privacy checks and safe descriptor construction. No generated PASS success certificate.
3. `scripts/verification/workbench-sdk-target-adapter.test.mjs`: synthetic composition units and real filesystem byte/hash/refusal branches; explicitly no App/PG/HTTP server/GUI and no native target proof.
4. `docs/planning/auto-ai-program-20261105/W20/AF-215-ROOT_WIRING.md`: concrete shared-owner admission/restoration hooks, callback/consumer/matrix/receipt schemas, remaining real validation and manual review steps.
5. This candidate execution record.

No database/schema/API endpoint/page/permission/dependency/logger owner changed. New verification artifact JSON contains safe ownership metadata, narrow DB facts, counters and hashes only; existing Job.status completed remains intact. No UI was implemented/redesigned. Frontend-design-review skill was read as dispatched; existing AntD/adminTheme are unchanged, with no Figma claim. No running access address was started.

## Actual worker validation

Node `v24.21.0`, pnpm `10.0.0`. Private workspace `pnpm install --frozen-lockfile --ignore-scripts --store-dir /Users/lei/.pnpm-store-w20-download`: exit0,800 packages,12m57s wall time; only download/store content reusable, no shared node_modules/env/uploads. Frozen manifests/lock unchanged. Install scripts were intentionally not run; no Prisma client generation/native/full application build is claimed.

- `node --check scripts/verification/workbench-sdk-target-adapter.mjs` and evidence module: exit0.
- `pnpm --filter @aij/contracts build`: exit0, actual package TS declarations/runtime graph emitted.
- `pnpm --filter @aij/sdk build`: exit0, actual complete public package TS declarations/runtime graph emitted; emitted files remain ignored/private to this WT.
- Targeted ESLint on the three new `.mjs` files with `--max-warnings=0`: exit0.
- `pnpm exec tsc --noEmit --allowJs --checkJs --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck` for both adapter implementation modules: exit0 after fixing two initial dynamic-property inference errors. Initial attempt exit2 is retained as a repaired check, not hidden.
- `node --test scripts/verification/workbench-sdk-target-adapter.test.mjs scripts/verification/workbench-sdk-target-runtime.test.mjs`: exit0,13 tests passed,0 failed/skipped/cancelled (9 composition units +4 original runtime pure units). Durable logs: `.artifacts/auto-ai-program-20261105/W20/AF215-worker/{units.log,validation.json}`; initial combined run passed12/12 before an additional refusal test was added.
- `git diff --check`: exit0. Exact scope/source audit: all961 source SHA256 unchanged, exactly five new allowPaths and no inherited/shared changes; durable `.artifacts/auto-ai-program-20261105/W20/AF215-worker/source-audit.json`.

Composition units cover delegated identity/status, unknown POST once/no retry, original Response preservation, query/private body redaction, absent driver, exact14 names including document-hidden/unmount, full graph/marker/lock/hash/symlink/lease refusal, receipt tampering/other task/run/staleness/current PNG/privacy/API status, fake matrix/native receipt rejection, unsafe sources, duplicate runtime/mount, concurrent mount+close and failure paths that still attempt both acquired owners. Synthetic native collaborators only exercise composition checks.

## NOT_RUN and handoff

NOT_RUN: root verify:task, real protected PG/migrate/seed, real App/API/transport execution, real outside npm installation+same-Run SDK acceptance, host sockets/PG pool measurement, real fetch/environment restoration, browser/native14, GUI, Linux/native runtime/Docker, full API/Next build, vendor, AF191/full AC003 and AF203 OS download acceptance. Synthetic collaborator booleans/process receipts/PNGs are explicitly not proof of any of these. All40 targets remain NOT_RUN_TARGET_ACCEPTANCE; vendor DEFERRED_NOT_PASSED; owner PENDING.

Root must add exact AF215 original fixture admission and a measured original-runtime environmentRestored field, supply its actual marked outside consumer/handler and process receipts, formally verify current auth/privacy/transport/one-Run/Job/Trace/refusals/closure, register/update queue and integrate the five candidate paths. Adapter construction failure leaves its passed original runtime for root finally cleanup; acquired mount cleanup behavior is documented. Required root work is not silently treated as a worker blocker or completed integration.

Effective worker engineering budget charged conservatively **0.50h**, including bootstrap/private-install wall time, coordinator clarification, implementation, repair, documentation and validation (dispatch2026-11-07 14:28:41UTC; final validation14:55UTC). Final candidate SHA is recorded in the exact-Dispatch worker_done receipt; worker cap2h / total card cap4h including root, repairs and verification. No further task, push, branch/remote Issue/PR, main/tag/deploy/release or vendor action is authorized by this candidate delivery.
