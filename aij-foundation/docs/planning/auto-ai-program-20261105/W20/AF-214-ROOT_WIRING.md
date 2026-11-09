# AF-214 root integration contract

Candidate only; not CODE_VERIFIED. Source is immutable `129aa515b5c7fd8a3269d97b3521136fc641f59d`; root exclusively owns shared service/module/bootstrap/SDK barrel/page/registry/queue edits and real acceptance. No schema or permission additions are necessary. Original CODE dependencies: `task_64bbf46af804`, `task_accf9151274c`; root must attach the actual W20 governance I dependency (its ID was not included in this worker dispatch), then create/complete the real AF-214 I task only after formal validation.

## Required original-owner wiring

1. In the original `AiRuntimeModule` (`apps/api/src/plugins/aij-ai/ai-runtime.module.ts`), register `AiKnowledgeCitationsController` and `{ provide: KnowledgeCitationPort, useExisting: AiKnowledgeService }`. Do not instantiate a second knowledge/auth/service owner. The existing module already imports `ClientAuthModule`; preserve that injection.
2. In `bootstrap.ts`, register `knowledgeCitationPrivateMiddleware` before CORS and all body parsers/guards. Register `knowledgeCitationParserErrorMiddleware` after body parsers, preserving every existing parser/private hook. It sets private/no-store/nosniff for the citation route, including malformed-body failures. The controller filter redacts guard/owner failures, preserving 401/403/404/409/410; no URL/content/cause is returned.
3. Add only the narrow `AiKnowledgeService.readCitation(memberId, workspaceId, questionId, documentId, claims)` method. Use the existing Prisma/WorkspaceContext/PluginRuntimeAccess/ClientAuth owners in one bounded ReadCommitted transaction. Do not use `getQuestion`: it performs maintenance writes. Do not call URL imports, Jobs, model execution, Run, Trace, audit or cost mutations.
4. Export `* from './knowledge-citations.js'` from the SDK barrel, build the actual SDK, and consume that export in the mounted Web component. The candidate uses a relative import of its own SDK implementation so it can typecheck without editing the shared barrel; root may replace that import with `@aij/sdk` after publication. Update the unit loader if changing that import: its private temporary CJS/ESM compile currently injects the owned SDK module only for that relative import.
5. In the original answered citation `<article>` in `client-knowledge-questions-page.tsx`, mount `<ClientKnowledgeCitation request={clientApi} workspaceId={workspaceId} questionId={question.id} documentId={citation.documentId} />`. Keep the original answer/title/code/excerpt semantics and existing AntD/adminTheme provider. The component reads nothing on mount and opens only on explicit “查看当前来源”.

## Narrow service method outline

The following is a concrete integration outline against the validated original owners, not an executed database acceptance result. Root implements this in the shared service, preserving the lock order **plugin lifecycle → membership permission → question → document → session** and final checks after any lock wait.

```ts
async readCitation(memberId: string, workspaceId: string, questionId: string,
  documentId: string, claims: ClientClaims) {
  knowledgeCitationId(questionId);
  knowledgeCitationId(documentId);
  if (!claims || claims.sub !== memberId) throw new UnauthorizedException('CITATION_SESSION_REQUIRED');
  if (!this.clientAuth) throw new ServiceUnavailableException('CITATION_UNAVAILABLE');
  const auth = this.clientAuth;
  try {
    return await this.prisma.$transaction(async tx => {
      // Existing owner checks lifecycle and then locks active member/workspace/
      // role/grant/permission. knowledgeManage is deliberately not requested.
      await this.assertWriteAccessInTransaction(tx, memberId, workspaceId,
        CLIENT_WORKSPACE_PERMISSION.knowledgeQuery);
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM public.ai_knowledge_question
        WHERE id = ${questionId} AND workspace_id = ${workspaceId}
          AND member_id = ${memberId} AND deleted_at IS NULL FOR SHARE`;
      if (locked.length !== 1) throw new NotFoundException('CITATION_UNAVAILABLE');
      const question = await tx.aiKnowledgeQuestion.findFirst({
        where: { id: questionId, workspaceId, memberId, deletedAt: null },
        select: { id: true, workspaceId: true, memberId: true, status: true,
          query: true, citations: true, createdAt: true, updatedAt: true,
          deletedAt: true, contentPurgedAt: true }
      });
      // Lock the original current row, including inactive/deleted rows. The
      // helper gives these the same unavailable response as missing sources.
      await tx.$queryRaw`
        SELECT id FROM public.ai_knowledge_document
        WHERE id = ${documentId} AND workspace_id = ${workspaceId} FOR SHARE`;
      const document = await tx.aiKnowledgeDocument.findFirst({
        where: { id: documentId, workspaceId },
        select: { id: true, workspaceId: true, documentCode: true, title: true,
          content: true, status: true, updatedAt: true, deletedAt: true }
      });
      // Recheck the original lifecycle/membership permissions after potential
      // row waits. Their locks are already held by this transaction.
      await this.assertWriteAccessInTransaction(tx, memberId, workspaceId,
        CLIENT_WORKSPACE_PERMISSION.knowledgeQuery);
      // Use the original clock_timestamp-aware session fence. The older
      // assertActiveSessionInTransaction uses CURRENT_TIMESTAMP and is
      // insufficient for a session expiring during a lock wait.
      await auth.assertSessionInTransaction(tx, claims);
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`
        SELECT clock_timestamp() AS now`;
      if (!clock) throw new ServiceUnavailableException('CITATION_UNAVAILABLE');
      return currentKnowledgeCitation({ memberId, workspaceId, questionId,
        documentId, question, document, now: clock.now });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 2000, timeout: 5000 });
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException('CITATION_UNAVAILABLE');
  }
}
```

Import `currentKnowledgeCitation` and `knowledgeCitationId` from the new helper. The helper is deterministic and never authorizes or acquires locks: a successful helper unit does not prove a successful authenticated source read. Expiry is the question's original `createdAt + 7 days`, not its answer/update time. Expired own questions return 410 even if already purged; foreign/deleted questions and missing stored references return 404. Nonanswered/purged inconsistencies return 404. Unavailable/inactive/deleted current documents return 404. A title, code or recomputed excerpt mismatch, or `document.updatedAt > question.updatedAt`, returns 409 `SOURCE_CHANGED`. Equality of timestamps is accepted. Exact UTF8 bytes up to 65,536 are accepted and SHA256 is computed from that exact stored content. The original extraction algorithm can join disjoint sentences, so substring containment is not a valid excerpt check.

## Root formal validation still required

- Register AF-214's real fixture admission and `verify:task`/quality gates. Use protected isolated PG, serial root ownership, original schema and auth; all credentials remain outside this worker. Candidate is not a deployment and exposes no running URL.
- Real HTTP Cookie + Workspace success from a query-only member, without knowledgeManage. Assert exact nine-key envelope data, actual SHA256 and private/no-store/nosniff. Verify 20/32 ID boundaries, malformed IDs, all extra query strings, GET JSON/stream bodies, guard and parser rejection privacy.
- Real 401 expired/revoked/wrong-product session; 403 membership/role/grant/workspace/lifecycle refusal according to original owners; 404 cross-workspace, wrong member, missing/unstored document, nonanswered/deleted/purged question, inactive/deleted document; 410 exact seven-day expiry; 409 title/code/excerpt/newer-document change.
- Hold original lifecycle/membership/question/document/session locks in controlled separate transactions; change/revoke/expire state while waiting and assert final decisions use current authorization and `clock_timestamp()`. Assert no question maintenance and zero Job/Run/Trace/cost/audit writes. These lock/database outcomes are NOT_RUN in the worker.
- Native original question article: explicit open, loading/error/close, keyboard/focus, narrow screen and text wrapping, actual 409/410 explanations, literal HTML rendered as text, no new external fetch. Verify blur/hidden/pagehide, question/workspace/request scope changes, logout/session rotation, role/grant revocation, held/late responses and unmount all clear/cancel private data. Authorized open sources revalidate only me/context every two seconds with an eight-second request deadline; this is periodic revocation detection, not push notification or citation polling. On failure/change the controller clears and requires explicit reopen; no automatic source retries.
- Verify actual public SDK ESM/CJS/types and installed consumer after root barrel export, page/module composition, required shared gates and final recorded I dependency. Native and target acceptance remain NOT_RUN_TARGET_ACCEPTANCE; vendor DEFERRED_NOT_PASSED and owner PENDING.

The UI keeps source only in RAM, uses escaped React text, and creates no storage entry, URL, ObjectURL, HTML renderer or log. Root remains responsible for browser/network/DOM evidence; server-rendered markup and controller units do not substitute for that acceptance.
