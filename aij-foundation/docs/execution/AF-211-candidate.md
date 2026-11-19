# AF-211 提供私有脚本执行API与公共SDK — candidate

Task `task_a96cbd8e542d`, Dispatch `ctx_dcb40ce1c683`, terminal `term_92f21823-ba02-4d6a-9f98-4d72239df8b1`. Registered worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W19-AF211`, branch `AIJ-W19-AF211`, clean initial HEAD `94b0236f775fa40a07944c5e0545ac6ce0e123f3`, remote `git@github.com:weiyang86/aij-foundation.git`.

Read main-root AGENTS and CONTRACT readonly; CONTRACT SHA256 `6081e956e0a2714d9b0c3732e529ccbe8fdfa11f0ccdccdb74afbf4286d97dd3`; manifest SHA256 `df4fb08a26cde63273f7689c74d030b202fd06aa5fdfae15dff5feadaee0c6ef`. Materialized exactly all 910 manifest blobs via `git show 4cfb95436d894f9145662ecbd79c2ea1075c417c:path`, each sha256 verified. Separate bootstrap commit `e59dd64af773652b51e67d4ba2109e7431d21a2b`, title `W19 verified source-only bootstrap`. Git emitted inherited AppleDouble pack-index warnings but all blob hashes/commit completed exit0; no repository maintenance or source-root modifications attempted.

Candidate delta against bootstrap is only these six new paths:

- `apps/api/src/plugins/aij-ai/ai-personal-script-execution.controller.ts`
- `apps/api/src/plugins/aij-ai/ai-personal-script-execution.dto.ts`
- `packages/sdk/src/personal-script-execution.ts`
- `scripts/verification/personal-script-api-sdk.test.mjs`
- `docs/planning/auto-ai-program-20261105/W19/AF-211-ROOT_WIRING.md`
- `docs/execution/AF-211-candidate.md`

Implemented isolated `/client/script-executions` controller seven endpoints, exact permission metadata, original Guard-only scope/claims/session gate, Origin checks and safe unavailable ports. DTOs reject unknown/accessor/prototype/Unicode/nonfinite/duplicate/depth/entry/byte-invalid values and canonicalize inputs without trimming/re-encoding source. Prefix hooks preserve other routes; private metadata uses existing wrapper and content uses raw response. SDK seven methods strictly validate requests/ref/source/run/artifact/capability and exact frozen policy, provenance, source SHA256, response bytes/name/mime/size/checksum, with one original ClientApi fetch and no POST retry. Download failure/abort clears temporary bytes; no persistence/logging/object URL.

Impact: no schema/migration/DB write, configuration/default grant/module/index/registry/queue change, no UI or running access URL. New API/permission declarations are inert until root wiring. No source/input/session body logging, new audit store or scheduler owner; lifecycle/auth/cleanup/retention/SUCCESS truth remain original integrated owners.

Validation (final result):

- `pnpm install --frozen-lockfile --ignore-scripts` exit0; private installation, no shared node_modules.
- `pnpm --filter @aij/contracts build` exit0; `pnpm --filter @aij/sdk build` exit0 for bootstrap export graph only, which deliberately lacks new SDK index export pending root.
- `pnpm --filter @aij/api exec prisma generate --config prisma.config.mjs` exit0, schema-only/no env loading/database connection.
- `node --test scripts/verification/personal-script-api-sdk.test.mjs` exit0: 17 tests, 17 pass, zero skipped. Actual body-parser streams, original ClientApi binary streamed fetch, truncated/overrun/abort/limit failure, seven-method count/scope/credentials/cache, ESM/CJS, strict targeted API/SDK and MTS/CTS consumers, DTO limits and controller session/permission/Origin/private/provenance behavior.
- `pnpm exec eslint apps/api/src/plugins/aij-ai/ai-personal-script-execution.controller.ts apps/api/src/plugins/aij-ai/ai-personal-script-execution.dto.ts packages/sdk/src/personal-script-execution.ts scripts/verification/personal-script-api-sdk.test.mjs --max-warnings=0` exit0.
- First unit invocation exit1 (11/14) exposed test envelope missing original required message and wrong hoisted typeRoots; corrected fixture/config, reran successfully. First lint exit1 on getter-return test fixture; fixed. No gate was skipped/relaxed and no failed run is called PASS.

Actual HTTP / installed tarball / full API build / root verify:task / DB / Docker / Linux / native / vendor / full40 / owner acceptance: NOT_RUN. See AF-211-ROOT_WIRING for exact root changes and remaining real success/refusal checks. No completed I209/I210 IDs exist in this worker context; candidate imposes no fake CODE dependency and cannot be CODE_VERIFIED. Candidate local commit uses exact title `提供私有脚本执行API与公共SDK`; its SHA is supplied in the final immutable handoff (self-reference excluded here).

Worker effective engineering time approximately 0.4h, within 2h cap; reserve root integration/real gates within remaining card budget, predict/split if root cannot meet conditions. Root needs precise module/permission/bootstrap/CORS/SDK-index wiring, actual integrated owners and real database/container/HTTP/tarball gates; no claim those conditions exist. Writer self-check is not independent review. Final handoff is STOP ALL WRITING; root may integrate only the six-path candidate delta relative bootstrap, not entire bootstrap/history. No edits after handoff; root owns subsequent integration and OWNER_CHECK_PENDING decision.
