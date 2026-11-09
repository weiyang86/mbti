# AF-218 root wiring / acceptance handoff

Candidate only; **NOT_CODE_VERIFIED / NOT_RUN_TARGET_ACCEPTANCE**. Root is the sole original-file/registry/queue Writer. Integrate only the six new candidate paths, never the source-only bootstrap commit. No backend/API/schema/permission/SDK export change is proposed.

## Original library composition

In `apps/web/app/components/client-agent-library.tsx`, import `ClientAgentVersionRestorePanel` from `./client-agent-version-restore-panel`. Keep exactly one instance mounted at the library level, outside the conditional detail/editor/history sections and without a `key`:

```tsx
const restoreScope = state.phase === "ready" && !state.busy && !state.editor &&
  !state.confirmation && !state.historical && !state.issue &&
  state.principal && state.context && state.detail &&
  state.context.permissions.includes("workspace.ai.assets.read")
  ? { memberId: state.principal.id, workspaceId: state.workspaceId,
      agentId: state.detail.id, revision: state.detail.revision }
  : null;

<ClientAgentVersionRestorePanel request={clientApi} scope={restoreScope}
  onAgentChanged={store.refresh} />
```

This must remain mounted while the library is loading, busy, editing, showing its own confirmation, showing a historical preview, or has no current saved detail; those states pass `null`. Changing/unmounting the instance to clear an unresolved PATCH would lose its RAM lock. Keep the original read-only history and existing Agent/publication owners intact. No automatic publish, enable, run, replay or new recovery endpoint.

The original library currently clears on pagehide/hidden, and refreshes on focus. Add `window.addEventListener("blur", leave)` and its matching cleanup to its existing lifecycle effect, with `leave = () => store.dispose()`, so parent-rendered private names/body/pins also clear on actual window blur. The candidate already clears its own state on blur/pagehide/hidden, never automatically reloads it on focus, and fences late responses with scope/generation/AbortSignal/timeout. The parent must pass null whenever its context/detail becomes unavailable; do not retain an old non-null scope during parent reload.

The panel explicitly calls only original Agent `versions/get/modelOptions/update` and Agent-publication `get`, plus original auth/me and workspace/context. Restore uses current-head `expectedRevision` and an explicit historical content whitelist with `enabled=false`; Skill references retain original skillId/revision/order, and immutable skillVersionId is shown but not copied into PATCH. Server remains the live prompt-Skill/catalog validator. Successful readback proves head +1, disabled, unpublished, publicationVersion +1 before parent refresh. A no-op sends zero PATCH. Any attempted PATCH error, including 4xx, keeps the opaque original member/workspace/Agent lock. Reconciliation reads current head + publication; a separate current authorized acknowledgement re-reads both and clears only the lock, never retries PATCH. A changed scope revision is allowed for same-owner reconciliation, since a committed lost reply may have already advanced the head.

## Exact declaration lint hook

Frozen root ESLint crashes on the new declaration at `@typescript-eslint/no-unused-vars` (`TypeError: node.params is not iterable`, exit 2). This is a configuration pairing failure, not a disabled rule or passing root gate. Root owns `eslint.config.mjs`; add:

```js
const agentRestoreDeclarationFile =
  "apps/web/app/components/client-agent-version-restore-state.d.mts";
```

Add that exact file to the `typescript-eslint/base` ignores next to `scriptDeclarationFile`, and to the explicit `{ ...scriptDeclarationParser, files: [...] }` entry next to `scriptDeclarationFile`. Retain every original rule. `scriptDeclarationParser` is already the original `nextVitals.find(config => config.name === "next/typescript")`: it supplies BOTH the matching Next parser and plugin. Frozen Next 16.4.1 resolves that pair to 8.72.1; root's separately installed typescript-eslint is 8.53.1. Do not mix those objects or use a parser-only override. Coordinate the AF217 declaration hook in root rather than overwriting its change.

Worker used only ignored `.artifacts/af218-eslint.config.mjs`, importing original config, excluding the one new declaration from the older base pair and appending the original matching pair for this declaration. No global config or dependency was edited. Exact local check:

```sh
pnpm exec eslint --config .artifacts/af218-eslint.config.mjs apps/web/app/components/client-agent-version-restore-panel.tsx apps/web/app/components/client-agent-version-restore-state.mjs apps/web/app/components/client-agent-version-restore-state.d.mts scripts/verification/client-agent-version-restore-state.test.mjs --max-warnings=0
```

## Formal gates owned by root

Register AF-218 in the original verification registry with real prerequisites, effects, structured reporter, the candidate unit test, and root-owned real positive/negative acceptance. Then actually run `pnpm verify:task -- AF-218` and applicable root lint/type/build gates. Worker did not run the root runner, DB/migrate/seed/Docker, full API/Next builds, servers, GUI, vendor calls or original root checks. No URL was started. Keep all target acceptance statuses NOT_RUN until their actual complete acceptance runs.

`node --test scripts/verification/personal-agents.test.mjs scripts/verification/personal-agent-publications.test.mjs` was actually run in the isolated worker: 29/30 pass, exit 1. The only failing case (`SQL/schema scopes and history retention; no model execution imports or unsafe SQL`) cannot open `apps/api/prisma/migrations/20261105030000_ai_personal_agents/migration.sql`, which the authorized 1009-blob manifest omits; it also references `docs/execution/AF-159-schema.prisma`. Do not treat this partial result as a full regression PASS, or materialize excluded files into the worker. Root has to execute the complete original check with its actual full source. The candidate's added unit directly invokes original `AiPersonalAgentsService.validateSave` with offline transaction doubles to test current catalog/model/provider and owned live prompt-Skill/executable rejection; it does not prove PG behavior.

## Required actual acceptance / manual sequence

1. Use isolated owned current-session account/space fixtures. Read-only assets.read can page history and compare; manage-only/foreign account/space/Agent/disabled role/plugin cannot access or restore. Confirm actual64hex sessionGeneration, role and grant changes fence results; no execute permission is needed for history.
2. Prepare at least three immutable Agent versions and an old Run with an existing version reference. Explicitly read history, select an older exact version, compare all fields and original model/catalog/ordered Skill pins. Cancel confirmation: zero PATCH, zero version/audit/publication writes.
3. Confirm a changed configuration: one original PATCH, exact whitelist, current expectedRevision, enabled=false. Inspect actual PG head/version/bindings/audit and original GET/publication: exactly one new immutable head, disabled, unpublished, epoch +1; earlier versions and old Run references unchanged. No Agent execution/enable/publication calls.
4. Select history whose disabled projection already matches current. Zero PATCH/new version, no new-version success claim. A stale catalog/model must remain original and refuse a changed restore; deleted, foreign or executable Skill pins must be rejected by the original server without silently dropping/replacing dependencies.
5. Edit current head concurrently: CAS409 clears candidate private state, requires explicit current reread, and preserves the human edit. If PATCH was attempted, retain the uncertain lock even on 409/400/401/403/404/410/503; a response status alone does not prove no commit.
6. Exercise actual committed-lost-reply, network timeout, malformed/unknown reply and delayed completion. Keep one opaque original-owner lock, no automatic PATCH or retry. Explicit original head + publication read alone does not unlock; separate currently authorized acknowledgement does, with another current read and no mutation. Wrong account/workspace/Agent cannot reconcile; null/editor/history/head/session/role changes preserve unresolved locks. One explicit restore must never create two versions.
7. In actual desktop and 390px UI, use keyboard through paging, comparison, confirmation, cancel and focus return. Check bounded long text/pins, current/history labels and target-disabled meaning, readable error states. Test actual OS blur and true document.hidden, account switch, null scope, late transport and unmount; inspect cleared DOM/private metadata and no late parent refresh. Offline render structure is not native evidence.
8. Inspect actual transport/permission/audit behavior and absence of new persistent browser records, private URL/body logs or HTML insertion. Record actual started addresses and owned process closure in root evidence. Leave vendor DEFERRED_NOT_PASSED and owner PENDING.

After Writer STOP, root integrates exact candidate delta, finishes real gates/records/queue and exact original-title local card commit, and completes the actual I218 Task only then. Its actual Task/Dispatch dependency IDs must be supplied by the coordinator; none are invented here. Candidate commit and self-review are not CODE_VERIFIED or owner acceptance. Stop at W21 OWNER_CHECK_PENDING; no push or further wave is authorized.
