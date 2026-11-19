# AF-207 root integration wiring

Candidate boundary only, not CODE_VERIFIED. Source `2ee9172a30be7694dc2cb097a43fbce1f0a14e65`; no A/B candidate imported. Integrate only after actual I205→I206 CODE_VERIFIED; AF203 native status is not this backend dependency. Root owns all shared writes below.

## Module and original owner

In `apps/api/src/plugins/aij-ai/ai-runtime.module.ts`, register `AiPersonalWorkflowExecutionController` and `WorkflowExecutionPrivateGuard`, import their exported abstract tokens, then bind:

```ts
{ provide: WorkflowExecutionPublicationsPort, useExisting: AiPersonalWorkflowPublicationService },
{ provide: WorkflowExecutionRunsPort, useExisting: AiPersonalWorkflowRunsService },
```

The owners must already be registered once, with their real A/B access/driver/preview/origin adapters. Existing `ClientAuthModule` provides `ClientAuthService`; do not create another auth owner, run service, queue or configuration. No fallback success implementation. The controller's abstract methods deliberately accept structurally matching own request types and return `Promise<unknown>`: it passes through the actual owner result; Nest's original JSON serializer projects owner Dates as ISO and the original TransformInterceptor adds the success envelope. SDK validates the exact public shape, without importing A/B types. No server session metadata may appear in either envelope.

Publication read/publish/unpublish receive the closure `(tx) => originalClientAuthService.assertSessionInTransaction(tx, guardedClaims)`; the claims object is exactly `request.clientClaims` produced by original `WorkspaceContextGuard`→`ClientAuthGuard`, with `claims.sub === request.client.id` enforced before any delegation. Runs submit/preview/read/recover receive those actual claims; B must perform its contract-required transactional session and current publication checks before and after original owner IO. It must never require GET's current session to equal the original startup session. Scope comes only from current Guard principal and workspace context. `correlationId` is forwarded on submit only. Original namespace and audience validation stays in the original Guard.

Submit additionally preserves `AI_CENTER_CLIENT_EXECUTION_ENABLED === 'true'` from the original direct-run controller. Preview remains advisory with configured=false allowed. Root's original runtime/provider hooks must preserve all original execution/configuration gates too.

## Bootstrap before parsers

In `apps/api/src/bootstrap.ts`:

1. Import `workflowExecutionPrivateMiddleware` and `workflowExecutionJsonVerify` from the new controller.
2. Call `app.use(workflowExecutionPrivateMiddleware)` alongside the existing early private middleware, before every parser and auth guard. It covers `/api/client/workflow-executions` and unprefixed `/client/workflow-executions`, including query/path children; headers are `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
3. In the existing `workflowParserOptions.verify`, after saving `request.rawBody`, invoke `workflowExecutionJsonVerify(request, response, buffer)` alongside the old workflow hook. Do not replace rawBody preservation or other prefix hooks. Keep `useBodyParser('json', false, ...)`: Nest rawBody=true would replace the custom verify hook.
4. Keep wire limit 100kb; the new hook applies the stricter 98304-byte bound, fatal UTF8 decode, original duplicate-key/prototype-key parser and recursive finite-number validation before JSON.parse receives the body. Ensure alternate content types/parser failure paths cannot bypass body rejection; exercise actual Express/Nest request handling. GET handlers require absent body, zero content-length and no transfer-encoding; every route rejects query extensions, capability accepts only one UUID string.

Middleware headers must also hold on oversized/invalid JSON, 401/403, unknown routes under the prefix, and origin rejection. Hook errors are fixed messages without input echo. Real malformed HTTP/UTF8/duplicate-key behavior is root-only NOT_RUN here; worker tests feed actual chunked Readable buffers through the hook and use Web ReadableStream through original ClientApi with a fetch collaborator, without binding a server.

## Permissions / SDK public entry

Root adds exact definitions `workspace.ai.workflows.publish` and `workspace.ai.workflows.execute` in the original permission registry/migration, only incrementally granting active system OWNER; disabled definitions and soft-deleted grants must remain disabled. The controller declares:

| Route | Original permissions plus new permission |
|---|---|
| GET publications/:workflowId | workspace.ai.assets.read |
| POST publications; POST publications/:workflowId/unpublish | workspace.ai.assets.manage + workspace.ai.workflows.publish |
| GET capability; POST runs | workspace.ai.assets.read + workspace.ai.execute + workspace.ai.workflows.execute |
| GET requests/:key; GET runs/:id | workspace.ai.assets.read + workspace.ai.read + workspace.ai.workflows.execute |

Status codes: publish/run submit 201, unpublish 200; GET default 200. All paths are under `/client/workflow-executions` (runtime global prefix `/api`).

Root alone adds to `packages/sdk/src/index.ts`:

```ts
export * from './personal-workflow-execution.js';
```

This exposes `createPersonalWorkflowExecutionClient` and the new module's types, including WorkflowRef/PublicationMetadata/Preview/RunEnvelope/RecoveryEnvelope, without changing any old SDK type or route. Verify no naming conflict when integrating A/B. There are exactly seven methods: publication/publish/unpublish/preview/submit/recover/read; options only signal. All use the original supplied ClientApi once, never a separate fetch. Recovery GET uses only the explicitly supplied original key. No automatic retry after unknown success/network/5xx; no localStorage/sessionStorage/logging. Run.agentCode must match original snapshot owner `personal:` + origin.agentId (immutable source snapshot service line 72); read must return the requested run ID, submit/preview the requested publication UUID, metadata the requested workflow and valid CAS epoch interval.

## Root acceptance remains required

No schema/migration change is requested by C beyond A/B's specified original-owner additions. Root must bind real A/B owners and original run admission/dispatch/settlement hooks; perform fresh isolated PG, current membership/session/revocation checks, actual upstream HTTP (local fixture), ABA/concurrency/leases/unknown/cleanup/audit rollback/regressions; then original applicable lint/types/build/registered verify:task. Pack the SDK after its index export; install actual tarballs in an outside consumer and validate ESM/CJS/strict TS and original ClientApi transport, all seven methods and real HTTP denial/success/malformed/unknown recovery. Worker direct-module transpilation is explicitly not installed-package evidence. No real credentials/vendor calls, no full40/native14 acceptance claimed. External DEFERRED_NOT_PASSED and real credential values remain blank.
