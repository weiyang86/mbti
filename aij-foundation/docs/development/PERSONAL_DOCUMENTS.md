# Personal plain-text documents — AF-190 integrated

This implementation delivers a separate `personal_documents` owner: each document belongs to both the current verified Workspace and member. Another member in the same space cannot read it. It does not create a knowledge document, attachment, AI run/job/trace, cost or payment ledger. Manual editing needs no model/key and sends no provider call.

First-stage assembly uses the existing aij-ai current project/organization/installation lifecycle lock. Enabled aij-ai makes documents available; disabling it stops them. This does not introduce a plugin or duplicate an AI owner. Root completed the module, dedicated permissions, SQL migration/Prisma, actual public SDK export and production route; the original Worker proposal remains in [AF-190-ROOT_WIRING](../planning/auto-ai-program-20261105/W14/AF-190-ROOT_WIRING.md). Root formal run-Gc3xNb passed actual fresh PG/two APIs/installed artifacts/production native desktop+390 and original Agent/workflow regressions; see [AF-190 execution](../execution/AF-190.md). All acceptance services and tabs are closed; no persistent address is running. Worker alone did not start applications.

## Contract

All `/api/client/documents` routes require a current client session, verified `x-aij-workspace-id`, active member/workspace/role/grant and current project/org/plugin. Private responses, refusals and parser failures must carry `Cache-Control: private, no-store`. Mutations also require the configured Web Origin. Every route rechecks permissions inside the same transaction before owner quota and row locks. Personal owner is never client-supplied memberId/projectId.

| Method / suffix | Permission | Payload / result |
| --- | --- | --- |
| POST `/` | workspace.documents.manage | `{code,name,body}` → current full head |
| GET `/` | workspace.documents.read | `limit` 1..50 default20, `afterId` UUID → metadata page |
| GET `/:id` | workspace.documents.read | current full head |
| PATCH `/:id` | workspace.documents.manage | `{expectedRevision,name,body}` → current full head |
| DELETE `/:id` | workspace.documents.manage | `{expectedRevision}` → `{id,revision,deleted:true}` |
| GET `/:id/versions` | workspace.documents.read | `limit` 1..50, `beforeRevision` 1..200 → descending metadata page, numeric nextCursor |
| GET `/:id/versions/:revision` | workspace.documents.read | exact historical name/body, requested on demand |

UUID document IDs are canonicalized; member/workspace IDs retain existing identifier format. Code is 2–63 lowercase safe characters matching personal asset conventions, starts with a letter, no repeated/trailing dash. Name is 1–160 Unicode code points, already trimmed and visible; no control/format/surrogate characters. Body is <=65,536 UTF8 bytes, preserves exact Unicode/TAB/LF/CR and allows empty text; rejects NUL, lone surrogates and other C0/C1 controls. Strict object allowlists reject nested fields, extra/symbol/prototype/accessor keys. Root transport parser must admit escaped valid JSON up to512kb on this route only; the decoded UTF8 bound remains64KiB.

Max100 undeleted documents per member+Workspace. Each initial create creates v1; each changed save increments revision and appends one immutable snapshot in the same transaction as metadata audit. Exact no-op creates neither audit nor history, including at v200. Save v201 is409; prior history is retained. Same code+exact initial name/body returns the current head; a different initial payload or tombstoned code is409. Replay never rewinds content. Concurrent saves require matching expectedRevision; one CAS succeeds, others409. Delete hides current document and every historical route with404, reserves code permanently, retains history, does not create a save or advance revision. No trash/restore/erasure/retention/backup promise.

SDK validates requests and success responses, rejects identity/revision/shape/cursor mismatch and issues one request per explicit call. Local body validation is a definite400; malformed success responses and transport/5xx write results remain unknown. There are no automatic retries. Public SDK export, isolated installed ESM/CJS and strict type consumers were verified by root.

## Interface / privacy

Injected `ClientDocumentManager` uses current AntD, PageHeading and adminTheme with one explicit save action, labeled textarea, wrapping metadata lists and deliberate history reads. It explains plain-text scope. Names/body/drafts/history are RAM only; no URL/storage/log/unsafeHTML path. Session/member/workspace/role/permission revalidation, focus/visibility loss and unmount clear private content and fence old asynchronous callbacks. Pending mutations are marked uncertain before awaiting; focus revalidation does not resend them or unlock them. A stale delete confirmation is fenced too. Unknown outcomes require active current-read plus separate acknowledgement before another change, using freshly read CAS revision.409 keeps the draft and blocks overwrite until deliberate current reload; reload explicitly discards draft so users can manually merge. Read-only roles can inspect only their own documents/history.

## Verification and manual root acceptance

Worker offline: `node --test scripts/verification/personal-documents.test.mjs` (actual source/DTO/SDK/store, explicit SQL fixture; not PG proof), targeted lint, strict noEmit for real DocumentsModule dependency closure+SDK, full Web noEmit, root harness syntax. Root-only `personal-documents-live.test.mjs` requires a fresh protected PG lease, real compiled API, two independent API pools for CAS/quota races, installed packed SDK and real production native-browser adapter; missing adapter is FAIL. Formal `verify:task`, production builds, migration/PG/API/browser have NOT_RUN by worker. Full API noEmit found inherited dictionary declaration mismatches outside allowPaths; details in candidate record.

Root manually verifies desktop and390px: create empty/Unicode doc, edit+save, select v1 readonly history, concurrent stale save retains draft, explicitly reload+merge, interrupt a write and reconcile by read/ack, switch members/Workspace with pending history callbacks, revoke current role, test readonly and keyboard focus, inspect no-store and logs. Verify DB FKs/immutability/triggers, cap200, quota race, no-op, replay/tombstone, audit rollback, held member/role/plugin revocations, no model/key edit, no foreign ledger/body leaks and all pools0 using the live harness. Production route and public SDK factory must be real composition.

Native OS picker and actual OS document-hidden proof stay NOT_PROVEN. REQ022/037/038 stay PARTIAL until AI/section regeneration, Word/PDF, restore, retention and backup get separate authorized cards. No export/attachment/AI/billing capability is claimed.
