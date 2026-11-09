# AF-190 candidate — 交付个人纯文本文档编辑与不可变历史

Status: CANDIDATE_DELIVERED_ROOT_ACCEPTANCE_PENDING; candidate is NOT CODE_VERIFIED. Sole Writer: dispatched Codex; no helpers.

- Worktree: `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W14-AF190`
- Task: `task_9873cb3a1e9b`; Dispatch: `ctx_0f5d95ecf53e`; terminal: `term_182e35a3-bd85-4811-b174-91ff47c0ac26`.
- Branch: `weiyang86/AIJ-W14-AF190`; initial clean HEAD: `94b0236f775fa40a07944c5e0545ac6ce0e123f3`.
- Remote: `origin git@github.com:weiyang86/aij-foundation.git` (fetch/push; no network Git mutation).
- Immutable source: `b434da8ba34f03b07b83f03be19b20061bb92fa9`; manifest SHA256 `995f2af4cbfb2fa8ca60ebcb7e66d03f4f5466190edee57ad646e6e32d4138d3`; all 773 listed blobs independently hashed before restore.
- Separate bootstrap commit: `0ce1b50a9f840cc8d4860b8c4bf3d6f246cb7540`; bootstrap is excluded from candidate delta and remains read-only.
- Budget: worker <=1.5h, total card 4h; reserve at least 2.5h for root wiring, real validation and fixes.

Root-only PG/migrate/API/browser/application server/heavy builds/verify:task NOT_RUN by worker. Native OS picker and true document-hidden proof remain NOT_PROVEN. REQ022/037/038 remain PARTIAL.

## Delivered delta (after bootstrap)

- `apps/api/src/documents/personal-documents.{module,controller,dto,service}.ts`: real module + private/origin-checked endpoints; strict decoded text/UUID/cursor allowlists; current project/org/plugin + shared membership locks before per-owner advisory/row locks; metadata lists, CAS saves/immutable version append, exact initial replay, no-op, quotas and softdelete; audit stores IDs/action/revision only.
- `packages/sdk/src/personal-documents.ts`: independent typed implementation with strict request/success response parsing, scoped no-store calls and no retries. Index remains root-owned; public packed composition NOT_PROVEN by worker.
- `apps/web/app/components/client-document-manager.tsx`: typed injected SDK port/scope/revalidation, existing PageHeading/AntD/adminTheme, explicit textarea save and readonly history,409 draft retention, unknown read+ack lock, fresh CAS and stale confirmation/request fences; RAM-only text cleared by scope/account/session/member/role/permission revalidation, focus/visibility/pagehide/unmount. No new global styles/dependencies.
- `scripts/verification/personal-documents.test.mjs`: nine offline actual-source suites. SQL fixture does not prove real DB concurrency.
- `scripts/verification/personal-documents-live.test.mjs`: root-only real fresh lease migration, two API instances/pools, packed ESM/CJS, actual FK/history/quota/CAS/held revocation/audit rollback/UTF8/control/namespace refusals, no provider/foreign-owner content/ledger writes, logs and pools; requires real production native-browser adapter, hard FAIL if absent.
- `docs/development/PERSONAL_DOCUMENTS.md` and `docs/planning/auto-ai-program-20261105/W14/AF-190-ROOT_WIRING.md`: contract, exact SQL/Prisma proposals, permissions/module/SDK/route/nav/transport wiring and browser adapter contract. Root must use route-specific512kb JSON wire parser so legal escaped65,536-byte decoded bodies are accepted; other routes retain existing limit.

## Checks and preserved failures

PASS (worker offline only):

- Independent `pnpm install --frozen-lockfile --ignore-scripts` (779 packages, no shared node_modules; lock untouched).
- `node scripts/prisma-schema.mjs generate` — compilation-only/no environment load/no DB, ignored generated client only.
- Small public prerequisite builds `@aij/contracts`, `@aij/ui`, `@aij/core`, `@aij/runtime-contracts` passed. Baseline `@aij/sdk` build passed as dependency preparation; it does NOT include the new unexported documents source and is NOT AF-190 public composition proof.
- `node --test scripts/verification/personal-documents.test.mjs` —9 pass/0 fail/0 skip. Covers real DTO/service/SDK/store source with explicit fixture, rollback/metadata/replay/cap/owner/refusal tests, fixture races,409 draft, unknown create/update/delete read+ack, revalidation invalidating prior acknowledgement, late old-scope/session writes/reads and stale delete confirmation. `.artifacts-af190-tests-before.log`, `-after.log`, `-final.log` retained.
- `pnpm exec eslint apps/api/src/documents apps/web/app/components/client-document-manager.tsx packages/sdk/src/personal-documents.ts scripts/verification/personal-documents*.mjs --max-warnings=0` —0 errors/warnings. Initial failure log retained: `.artifacts-af190-lint-before.log` (intentional control regex flagged, render-time ref assignment, unused SDK helper/test destructure, hook dependency); fixed by numeric control validation, layout-effect ref update, scoped effect dependencies and removing unused code. Final `.artifacts-af190-lint-final.log` empty.
- `pnpm exec tsc --noEmit --strict --skipLibCheck --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --target ES2022 --module commonjs --moduleResolution node --types node apps/api/src/documents/personal-documents.module.ts packages/sdk/src/personal-documents.ts` —PASS real dependency closure, `.artifacts/AF-190/target-types-final.log` empty.
- `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext packages/sdk/src/personal-documents.ts` —PASS.
- `pnpm exec tsc --noEmit --project apps/web/tsconfig.json` —PASS including new UI and type-only local SDK typing.
- `node --check scripts/verification/personal-documents-live.test.mjs` —syntax PASS only; live script was NEVER executed by worker.

Preserved FAIL: whole API `pnpm exec tsc --noEmit --project apps/api/tsconfig.json` initially had missing built prerequisite packages; after those small builds, exactly two inherited failures remain: `dictionaries.controller.ts` cannot import `DICTIONARY_READ_PERMISSION`, and `rbac/permissions.service.ts` cannot import `dictionaryEffectivePermissions` from frozen `scripts/dictionary-policy.cjs` declarations. Both outside allowPaths and untouched; `.artifacts-af190-api-types.log` and `-after.log` retained. Targeted document closure passed; no whole API pass claimed.

NOT_RUN / acceptance remains incomplete: formal `verify:task`, migration/seed/PG/FK/trigger execution, compiled application/API server, installed AF-190 packed SDK, heavy API/Web builds, production desktop/390px browser, root adapter and pools0 checks. Harness adapter absence is FAIL at root; there is no fabricated success/skip. No native browser, Docker, DB, application server, paid/vendor call, root-source copy, push, queue/registry/shared wiring change or remote publication occurred. No access URL is running.

## Acceptance, dependencies and handoff

Root must integrate ONLY the eleven allowed candidate paths after bootstrap, wire the real owner paths and schema from the proposal, supply the browser adapter, resolve its current actual baseline compiler state if needed, build/pack/install SDK, execute formal gates plus live success/refusal/PG/browser proof and update queue/record/exact-title root commit/SHA readback. No downstream dependency may call this candidate CODE_VERIFIED; downstream must depend on the real integration Task ID assigned by coordinator. Owner check remains pending. No Trea wait.

Manual root checks: create/save/history exact Unicode and empty text without model/key; actual two-API stale CAS one commit;100th document race; v200 no-op/save refusal; stale current-role/member/plugin held locks; same-space other-member/foreign-space/namespace/readonly denial; softdelete history404 and code409; unknown result read+ack before fresh CAS; desktop/mobile390 keyboard labels/focus, oldscope late responses, no private cache/log/nonowner table bodies and all pools0. REQ022/037/038 stay PARTIAL; Word/PDF, AI section regen, restore, retention and backup are outside scope; native OS picker/true OS hidden remain NOT_PROVEN.

Worker actual elapsed approximately0.40h (2026-11-06 07:31–07:55 Asia/Shanghai including bootstrap/checks/docs; upper worker budget1.5h). Root reserve approximately3.60h of total4h; implementation estimate for root wiring/validation/fixes2.5–3h. If actual root acceptance exceeds remaining budget, preserve failed evidence and split; do not weaken gates.

Candidate exact-title commit will contain only these allowed paths; its SHA is returned in worker_done (cannot self-reference in committed record). Separate bootstrap SHA and manifest hash above remain immutable. **STOP ALL WRITING after candidate commit and worker_done; Writer hands off explicitly to root.**
