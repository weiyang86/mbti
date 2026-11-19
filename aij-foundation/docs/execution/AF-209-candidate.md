# AF-209 candidate delivery

Status: CANDIDATE_READY, root integration/verification NOT_RUN; not CODE_VERIFIED and not owner acceptance. Writer: dispatched worker only, no helpers. Actual Task `task_3704f0a8142a`, Dispatch `ctx_5a49485b701d`, terminal `term_55f44e80-db05-4497-af51-05e2aad38703`.

## Baseline and provenance

Registered worktree `/Users/lei/orca/workspaces/aij-foundation/AIJ-W19-AF209`, branch `AIJ-W19-AF209`, initial HEAD and verified origin/dev `94b0236f775fa40a07944c5e0545ac6ce0e123f3`; remote `git@github.com:weiyang86/aij-foundation.git`, initial porcelain status empty. Read root AGENTS and W19 CONTRACT read-only before writing. CONTRACT SHA256 `6081e956e0a2714d9b0c3732e529ccbe8fdfa11f0ccdccdb74afbf4286d97dd3`; SOURCE_BOOTSTRAP SHA256 `df4fb08a26cde63273f7689c74d030b202fd06aa5fdfae15dff5feadaee0c6ef` both matched.

Materialized exactly 910 manifest paths with `git show 4cfb95436d894f9145662ecbd79c2ea1075c417c:path`; verified SHA256 of each returned blob and every written file. Separate source bootstrap commit `1961358570c9b4fbd330cf3974811dd90b1beeb3`, title `W19 verified source-only bootstrap`. No live-root source copy. Existing shared git object folder emits `non-monotonic index .../._pack-...idx` diagnostics; git operations nevertheless returned success and exact manifest hashes matched. Worker did not alter shared git metadata. Initial report incorrectly used unsupported message type `info` (exit 1); re-sent with supported `status` (exit 0, message `msg_3661f04042d6`).

Candidate commit is the single child commit of the bootstrap, exact title `实现个人Python Skill不可变脚本版本`; its actual SHA is reported by the completion message (avoids a self-referential commit hash in this file).

## Exact candidate delta relative to bootstrap

Only these six new files:

- `apps/api/src/plugins/aij-ai/ai-personal-script-skill.dto.ts`
- `apps/api/src/plugins/aij-ai/ai-personal-script-skill.service.ts`
- `apps/api/src/plugins/aij-ai/ai-personal-script-skill-contract.ts`
- `scripts/verification/personal-script-skill-assets.test.mjs`
- `docs/planning/auto-ai-program-20261105/W19/AF-209-ROOT_WIRING.md`
- `docs/execution/AF-209-candidate.md`

Extension owner inserts new executable source only after original owner appends a real new SkillVersion/revision, including unchanged prompt content; same transaction performs extension INSERT and body-free audit. CAS/max revision and broken append fail closed. Original head/version implementation is delegated through the fixed access port, never duplicated. Source has exact original UTF8 bytes; strict DTO/ref/input/raw JSON parsers reject accessors/proxies/non-plain objects/symbols/unsafe keys/bad Unicode/nonfinite/cycles/sparse arrays/duplicates/byte-depth-entry overflow. Canonical input hash includes the fixed complete version identity and policy. Source reads and execution/result resolvers have separate exact permission sets, current ref/head/project/source digest/policy fences and trusted session-gate forwarding; absent owner or source-read Prisma DI gives bounded 503. Public return values contain exact ScriptRef and optional source only on the private read endpoint.

Database impact: raw SQL INSERT/SELECT of the proposed new immutable relation, plus existing audit owner; actual schema/migration is root-only and not applied. Interface impact: four fixed service methods only, no registered HTTP route in this candidate. Page impact: none. Permissions: exact new scripts.manage/scripts.execute codes requested in original permission owner; no grants changed here. Logs: no logging added, no source/input/error detail in generic availability errors or audit. Existing root files, owners, schema, migrations, Agent logic, module, queue, registry, SDK and inherited UI/playbook untouched.

## Verification and failures

Private worktree install (no root node_modules sharing): `pnpm install --frozen-lockfile --ignore-scripts`, exit 0. Schema-only generation: initial `pnpm --filter @aij/api exec prisma generate --schema prisma/schema.prisma`, exit 0, then sanitized `node scripts/prisma-schema.mjs generate`, exit 0; both compilation only, no database connection or env loading. Small original packages `pnpm --filter @aij/contracts build`, `pnpm --filter @aij/runtime-contracts build`, `pnpm --filter @aij/core build`, each exit 0; ignored build outputs not committed.

Final commands:

```sh
node --test scripts/verification/personal-script-skill-assets.test.mjs
pnpm exec eslint apps/api/src/plugins/aij-ai/ai-personal-script-skill-contract.ts apps/api/src/plugins/aij-ai/ai-personal-script-skill.dto.ts apps/api/src/plugins/aij-ai/ai-personal-script-skill.service.ts scripts/verification/personal-script-skill-assets.test.mjs --max-warnings=0
pnpm --filter @aij/api exec tsc --noEmit --strict --skipLibCheck --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --target ES2022 --module commonjs --moduleResolution node src/plugins/aij-ai/ai-personal-script-skill-contract.ts src/plugins/aij-ai/ai-personal-script-skill.dto.ts src/plugins/aij-ai/ai-personal-script-skill.service.ts
```

Each final command exit 0; 7/7 source-level test groups pass, no skipped tests; explicit original-access, transaction and audit collaborators, no PostgreSQL/live or independent reviewer claim. Covers fixed policy bytes, raw source/bounds, DTO hostile properties, canonical input/ref provenance/hash, raw JSON duplicate/bad UTF8/output checks, unchanged-prompt append, exact read-vs-execute permissions, session forwarding, CAS/append/audit/late-session rollback, current head/version/project/digest/policy mismatch, deletion/scope/grant/session refusal, absent DI and invalid ID. Transaction rollback is a collaborator behavior under test, not evidence of real PostgreSQL constraints.

Earlier failed checks retained honestly: first test run exit 1 (6/7) because a synchronous missing-DI throw was passed to assert.rejects; fixed to assert.throws. First lint exit 1 for test getter-return, fixed to a throwing getter. First targeted compiler-API check found 13 diagnostics because TypeScript did not narrow after an arrow-constant never function; changed it to a never-returning function declaration, then 0 diagnostics and standalone tsc exit 0. The first compiler shell command also ran read-only sed afterward and therefore shell exit was 0 despite diagnostics; it was not treated as PASS. No implementation safety rule was relaxed to fix checks.

NOT_RUN: original adapter/real source version persistence, immutable SQL constraints and triggers, actual project insertion enforcement, original Agent script-binding refusal, real PG rollback/concurrency/session windows, HTTP/API/SDK/Job/File integration, root verify:task, DB/migrate/seed, Docker/Python execution, servers/browser/UI, heavy API/Next build, Linux/native, vendors, full40 and owner acceptance. No access URL has been started. Source validates bounded text, not Python syntax or successful sandbox execution.

## Root acceptance and handoff

Apply the precise original owner/permissions/module/schema/migration/Agent refusal requests in `AF-209-ROOT_WIRING.md`. Root should manually create original prompt Skill, append script revision (unchanged prompt still adds actual new original version), read exact current source, alter head then verify old script read/execute refuse; exercise actual owner/member/grants/session revocation and audit rollback, mutation triggers/FKs/digests and unchanged prompt Agent pin regressions in protected fresh PG. No standalone root action is claimed done by this worker.

Estimated effective worker time ~0.4h including implementation/checks/fixes/record; root still has its bounded 1.25h allocation, total AF209 cap 3.25h. Root needs shared file wiring and full applicable evidence before actual I209 completion; no completed I209 ID exists in this candidate. I210→I211 dependencies must use actual completed integration IDs, never this candidate Task. Candidate handoff is STOP ALL WRITING after the commit and worker_done; root becomes sole integrator, no edits/push from this worker after handoff.
