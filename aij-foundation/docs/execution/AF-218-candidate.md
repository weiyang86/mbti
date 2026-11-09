# AF-218 candidate execution record

Status: **CANDIDATE_ONLY / NOT_CODE_VERIFIED / NOT_RUN_TARGET_ACCEPTANCE**. Original title: **提供个人Agent历史配置恢复为新版本**. Worker writes stop immediately after the exact-title candidate commit; coordinator receives actual candidate SHA through worker_done, since a commit cannot include its own hash.

## Identity and frozen baseline

- Task `task_583f9c45edcd`; Dispatch `ctx_e1859ca68a1d`; worker terminal `term_39e36e64-82ea-456e-a5f9-7db95ffc4c03`; coordinator terminal `term_26cef18e-31e9-4c43-8f62-bd8db5c92ea5`.
- Registered worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W21-AF218`; instance `1221bcc0-5d17-452c-844d-01ae4631b6b0`; branch `weiyang86/AIJ-W21-AF218`.
- Initial HEAD = actual origin/dev `94b0236f775fa40a07944c5e0545ac6ce0e123f3`; initial status clean; origin `git@github.com:weiyang86/aij-foundation.git`.
- Read AGENTS and root read-only W21 CONTRACT first; SHA256 `038af86823af97bd7650f8d3dd3cf91b55d04d4f84c38eacadac954924829614`. Manifest SHA256 `b17b864c7587471a2ed98507429f0c019d4f0f9ef70502d54fd71939745a82b5`.
- Only immutable source `f0e12d76b0c2c5dccf4d1c56369019e979e52902` was materialized using `git show <source>:<path>`. All **1009** manifest paths were SHA256 checked before and after writing; **514** paths differ from the initial verified origin/dev. Separate bootstrap commit **`79a7099757b43de69b6436d58b841256da7404bb`**, title `W21 verified source-only bootstrap`. Root live implementation, AF191/203 WIP, peers, credentials/env, uploads and node_modules were not copied.
- Git emits a pre-existing shared object-store diagnostic for `.git/objects/pack/._pack-f03e767c944ca97bc7cba847811aab0e60e02cb8.idx` (`non-monotonic index`). Bootstrap commands nevertheless exited 0, resolved source blobs and matched every required content hash. Worker did not modify shared Git pack files.

## Exact new delta and behavior

Only these six new paths belong to the candidate:

1. `apps/web/app/components/client-agent-version-restore-panel.tsx`: original AntD/adminTheme embedded panel, explicit history paging/selection, field comparison, original model/catalog/Skill pin display, separate confirmation/cancel, readback/recovery acknowledgement and bounded accessible text.
2. `apps/web/app/components/client-agent-version-restore-state.mjs`: original-client state controller, whitelist/disabled projection, no-op/CAS, before/after real auth/context/session/head fencing, success head/publication readback, RAM-only original-owner uncertain PATCH lock, explicit reconciliation and no retries.
3. `apps/web/app/components/client-agent-version-restore-state.d.mts`: exact typed panel/controller contract.
4. `scripts/verification/client-agent-version-restore-state.test.mjs`: offline synthetic SDK/state/render tests and direct original service dependency-validation test.
5. `docs/planning/auto-ai-program-20261105/W21/AF-218-ROOT_WIRING.md`: exact original library/lifecycle/lint hooks, formal gate and real acceptance handoff.
6. `docs/execution/AF-218-candidate.md`: this record.

No original owner/module/barrel/schema/global dependency/permission/registry/queue file was edited. Backend/API/database schema has zero candidate changes. When root mounts it, changed restores call only ordinary original Agent PATCH, producing existing immutable-version/publication/audit behavior; the candidate introduces no new database owner or audit/log format. No restoration publishes, enables, executes or changes earlier versions or Run references. Runtime private configuration is only in instance RAM, with no persistent browser/URL/body logging or HTML insertion. Every attempted PATCH failure is treated as potentially committed, including 4xx. Root-owned database/API/native checks remain necessary.

## Actual commands and results

| Command/check | Actual outcome |
| --- | --- |
| `git status --short --branch`, branch/HEAD/origin readback, `orca worktree current --json` | exit 0; identity above; initial clean |
| `shasum -a 256` root CONTRACT and SOURCE_BOOTSTRAP.json | exit 0; both exact expected digests |
| Python manifest verification + per-path `git show` + SHA256 before/after + exact source-only staging/commit | exit 0; 1009 exact blobs; bootstrap SHA above |
| `pnpm install --frozen-lockfile --ignore-scripts --store-dir .artifacts/pnpm-store` | exit 0; private worker dependencies/store; no lifecycle scripts/shared modules |
| `pnpm --filter @aij/contracts build` | exit 0; small package only |
| `pnpm --filter @aij/ui build` | exit 0; small package only |
| `pnpm --filter @aij/sdk build` | exit 0; small package only |
| `pnpm --filter @aij/api exec prisma generate --config prisma.config.mjs` | exit 0; schema-only private client generation; config skips env loading; no DB connection/migrate/seed |
| First original-config scoped panel/state lint | FAILED diagnostics: react-hooks/refs rejected callback ref passed through initializer (combined shell exit 0 because typecheck followed it); corrected by keeping callbacks in controller and updating them in layout effect, with no rule suppression; subsequent original-config panel/state/test lint exit 0 |
| `pnpm exec eslint apps/web/app/components/client-agent-version-restore-state.d.mts --max-warnings=0` | exit 2; original parser/plugin pairing crash; root hook precisely recorded |
| Final scoped four-file lint using ignored `.artifacts/af218-eslint.config.mjs` (full command in root wiring) | exit 0; original matching Next parser/plugin pair; every original rule retained |
| `pnpm --filter @aij/web typecheck` | exit 0; strict web `tsc --noEmit`; no Next build |
| `node --test scripts/verification/client-agent-version-restore-state.test.mjs` | exit 0; **26/26 PASS**; offline only |
| `node --test scripts/verification/personal-agents.test.mjs scripts/verification/personal-agent-publications.test.mjs` | **exit 1; 29 PASS / 1 FAIL**: historical Agent migration not in bootstrap manifest, so SQL/schema source test ENOENT; original service/controller/DTO/SDK cases passed; not a full regression PASS |
| Candidate source/allow-path/dependency-root audit | exit 0; all 1009 source hashes exact, exactly six new allowPaths, bootstrap changed paths manifest-only, dependencies/store resolve inside this worker |
| `git diff --cached --check` and candidate path/title/parent/status readback | executed as final local commit audit; exact candidate SHA and readback sent with handoff |
| `pnpm verify:task -- AF-218`, root global lint/type/build, real PG/HTTP/native/390px/keyboard/actual hidden/late sessions | **NOT_RUN**; root-owned and not authorized in worker |
| Servers/GUI/DB/migrate/seed/Docker/vendor/full API/Next build/push/PR/tag/deploy/release | **NOT_RUN**; no address started, no owned service to close |

Candidate tests cover whitelist boundaries, invalid/duplicate fields and pins, ordered immutable pagination, current-vs-history target differences, cancellation zero writes, one disabled unpublished new head with unchanged code and exact immutable Skill IDs, old immutable references (synthetic), no-op zero PATCH, read/manage separation, stale model/catalog, concurrent edit, all attempted failure statuses, committed lost reply and unknown reconciliation, same-owner lock/null/dispose fencing, actual64hex session generation, role/permission/session revocation, malformed readback, delayed transport ignoring abort, timeout and original current dependency checks. Offline AntD render checks semantic controls, escaping, bounded grid/text and focus/event hooks; they do **not** claim actual keyboard, viewport or document.hidden verification. Final private worker logs are `.artifacts/AF218/{candidate-units,candidate-lint,web-types,source-boundary-audit}.txt`; these are ignored evidence, not candidate delta.

## Self-review, limitations and handoff

Applied `/Users/lei/.agents/skills/frontend-design-review/SKILL.md`: restrained embedded private configuration comparison, existing AntD controls/adminTheme, one restore action, explicit target-disabled copy, separate confirmation, actionable errors, escaped text and bounded wrapping. No Figma reference was provided or used, and no redesign/dependency was added. Native keyboard/focus/reflow/theme evaluation remains NOT_RUN. Self-review is not independent review.

Root must keep one unkeyed panel mounted with null in all forbidden parent states, add parent blur clearing, apply the exact declaration lint hook, register and run real AF-218 verification, finish PG/API/native positive and negative paths, then update root records/queue and create the original-title formal local commit. Actual I218 dependency Task/Dispatch IDs are coordinator-owned and not invented. See the root wiring document for complete manual steps. Candidate acceptance and all target statuses remain NOT_RUN_TARGET_ACCEPTANCE; vendor DEFERRED_NOT_PASSED, owner PENDING, W21 exit OWNER_CHECK_PENDING. No automatic continuation or push.

Budget: worker cap 1.5 effective hours, card total including root 3h. Work started with the registered worktree at 2026-11-07 17:49 UTC (2026-11-08 01:49 +08); actual final elapsed/effective hours and candidate SHA are returned in the final worker_done readback, covering implementation, isolated checks, repairs, audit, record and commit. Root must add its coordination/integration/repair/real-gate time within the original total, without resetting spent time.
