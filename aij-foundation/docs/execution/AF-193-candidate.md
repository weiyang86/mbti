# AF-193 · 提供外部服务配置草稿与就绪检查

Status: CANDIDATE_ONLY / ROOT_INTEGRATION_PENDING, not CODE_VERIFIED or owner/vendor acceptance.

## Identity and scope

- Worktree: `/Users/lei/orca/workspaces/aij-foundation/AIJ-W15-AF193`, registered `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W15-AF193`, instance `8eb3346a-d041-4dda-a026-f851161407c4`.
- Branch `weiyang86/AIJ-W15-AF193`; clean initial HEAD/origin/dev `94b0236f775fa40a07944c5e0545ac6ce0e123f3`; origin `git@github.com:weiyang86/aij-foundation.git`.
- Task `task_2f465747e482`, dispatch `ctx_6ebac97919b7`, sole Writer terminal `term_2b0649e6-c8b0-41b8-9817-eb9894ce07fc`.
- Read full formal AF-193 and W15/CONTRACT from root read-only before product writes. Verified SOURCE_BOOTSTRAP.json SHA256 `27b84d44bc097923e26427363e9c59aa22ea7e6fa88464cc5cdf1e1be373e9f6`; restored 824 exact manifest blobs via git show source `3286461a196198bb89ed3044bba2d67b982d4727`, checked every blob hash. Separate bootstrap commit `599c9b79d14d03892294b2d8b2fec3e62bb785f3`; candidate must exclude its delta.
- No root working-source copies/writes, credentials, database, migrations, seed, Docker, shared node_modules, upload copies, application/native browser, heavy API/Web build, push/PR/release or helper agents.

## Actual delta / effects

Nine allowPaths only: four API files (catalog/DTO/controller/service), SDK external-services.ts, unit and root-only PG verification scripts, root-wiring note, this record. Added 14 immutable draft schemas and API/SDK contract. Field schemas remain API-owned. No actual UI edit or runtime activation. Existing ScopedConfig/ConfigurationChange/ManagementAccessService/SecretRef owner reused; no schema or new ledger. Saving empty draft is valid; all rows are private/sensitive/disabled; server context only; current config permission plus secret permission on explicit reference edits; strict inputs, CAS, same-transaction audit/history, safe availability-only projection. No reference/value appears in GET/audit or error messages. runtimeEnabled false and externalVerification not_run always.

Provider scope is limited draft metadata, not complete vendor integration/qualification. Root-wiring note lists official links and source-fetch limitations (Weixin/WeCom retrieval failures, Dingtalk unreadable HTML/Markdown timeout) for root's source recheck. No third-party source is treated as authority. Real account values remain blank; real vendor checks remain NOT_RUN.

## Verification actually run

- `pnpm install --frozen-lockfile --ignore-scripts`: exit0, 779 independent packages installed. Nonfatal pnpm self-update registry fetch warning retained; no dependency changes.
- `node scripts/prisma-schema.mjs generate`: PASS, schema compilation only with port1 placeholder, no database connection.
- `pnpm --filter @aij/contracts build`, `pnpm --filter @aij/core build`, `pnpm --filter @aij/sdk build`: PASS, small local public package builds only. SDK current index does not export candidate until root wires it; targeted compile/runtime tests cover new module directly.
- `node --test scripts/verification/external-services.test.mjs`: 9/9 PASS including targeted API and SDK strict compiler diagnostics; real compiled DTO/service/controller and SDK behavior, synthetic scope/auth/secret port/CAS/rollback, bounded loopback Nest HTTP, closed sockets.
- Targeted ESLint and live-script syntax/diff whitespace checks: PASS at final candidate check.
- Failures retained: first bootstrap preflight stopped on clean tracked file differing from authorized source; no user changes existed; full immutable restore subsequently succeeded. Initial synthetic list test incorrectly returned the same provider row for all keys (1 failed/7 passed); corrected synthetic lookup, rerun passed. Initial targeted typecheck found four nullable-field narrowing errors; changed never-returning parser helper to a function declaration and passed. Initial lint found two unused live-test imports; removed and reran. Staged whitespace check found three trailing spaces from the TypeScript printer; trimmed and reran. No failed result is represented as a successful earlier run.
- NOT_RUN: root protected fresh PG script, root AppModule/SDK-index integration, formal verify:task and registered quality gates, application builds, real browser/390px/keyboard, actual credential/vendor/paid calls, original strict AF191/full40 targets. No dev URL running.

## Root acceptance and handoff

See `docs/planning/auto-ai-program-20261105/W15/AF-193-ROOT_WIRING.md` for exact module/index/guards edits and opt-in. Root-only PG script requires fresh AF-193 protected lease and exact root dev identity; missing module/lease fails, never skips. It exercises real application HTTP/current permissions/CSRF and persistence, concurrent CAS, audit-trigger rollback, preserve/clear/safe generic-config projection, zero external/resolve calls, cleanup. Script is provided but PG acceptance is NOT_RUN here. Root must wire/build/export, source-recheck inaccessible official pages, run PG/formal gates and normal Config/SecretRef regressions, compose downstream UI, and supply true integration Task ID before dependents claim CODE_VERIFIED.

Manual acceptance: login as config manager, read catalog/default view, save/reload empty draft and version, edit/conflict with draft retention, secret-manager preserve/clear owned synthetic ref, verify normal admin403/no-CSRF/cross-product refusal and safe output. No runtime/vendor success is claimed. Candidate commit uses exact task title; no queue/registry updates by worker. Local work about 0.6 engineering hours, below 1.75h worker budget.

Writer handoff: STOP ALL WRITING after candidate commit and final read-only verification; no follow-on work or push. Candidate SHA is returned in worker_done (not self-embedded in this commit).
