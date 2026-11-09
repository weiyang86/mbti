# AIJ Async Runtime

Current implementation owner: `apps/api/src/async-runtime`; Prisma data owner: AIJ platform runtime. `RuntimeRegistry` accepts handlers from the host. This guide describes the G9-01–04 implementation, not provider integrations or exactly-once delivery.

## Persistence and delivery contract

The initial runtime migration adds `RuntimeOutbox`, `RuntimeJob`, `RuntimeSchedulerLock`, and `RuntimeIdempotency`. Producers may create Job/Outbox work inside their existing Prisma transaction so the business write and enqueue commit or roll back together. Server-side scope/type/idempotency checks and database uniqueness protect duplicate records.

The worker claims rows with a database lease. Expired leases can be reclaimed; retries are bounded by `maxAttempts` and use persisted scheduling/backoff state. The idempotency ledger protects database side effects performed in the runtime transaction. A handler that calls an external service must still make that provider call idempotent and honor cancellation. The runtime does not claim external exactly-once behavior.

Worker and scheduler timers are off by default. The API only assembles `AsyncRuntimeModule` when administrator auth and the database capability are both configured. `ASYNC_RUNTIME_ENABLED=true` starts the worker/scheduler loops; an invalid value is rejected by the shared runtime environment parser. Shutdown stops polling and waits for active poll/schedule promises before module close completes.

## Readiness and management API

With the global `/api` prefix, the runtime management routes are:

| Route | Permission | Purpose |
|---|---|---|
| `GET /api/admin/runtime/readiness` | `admin.runtime.read` | Database readiness, worker/scheduler public state, and Job/Outbox status counts |
| `GET /api/admin/runtime/jobs` | `admin.runtime.read` | Paginated status projection |
| `GET /api/admin/runtime/outbox` | `admin.runtime.read` | Paginated status projection |
| `POST /api/admin/runtime/jobs/:id/retry` | `admin.runtime.manage` | Retry eligible failed/dead/cancelled job |
| `POST /api/admin/runtime/jobs/:id/cancel` | `admin.runtime.manage` | Cancel eligible pending/retry job |
| `POST /api/admin/runtime/outbox/:id/retry` | `admin.runtime.manage` | Retry eligible dead/retry event |

The runtime readiness route returns 503 when database readiness fails or the worker/scheduler is not running. Process liveness remains the separate `/api/health` contract. Responses expose state/counts and a boolean `hasError`; they omit payload, secret, idempotency/correlation keys, raw errors, and internal instance identifiers. State changes recheck the authenticated operator's permission and write a minimal audit row in the same protected transaction.

These APIs are administrative controls, not a browser UI. A 201 on POST denotes successful creation of the command result; callers should not assume 200. Invalid state transitions fail closed.

## Verification evidence and limits

NEXT-05 final runner reports:

- AF-049 `.artifacts/verification/AF-049/run-ayK3ct/report.json`: migration, transaction persistence, uniqueness, projection redaction, and rollback.
- AF-050 `.artifacts/verification/AF-050/run-3ur5C5/report.json`: competing Prisma pools, lease claim/reclaim, bounded attempts, scheduler exclusion, graceful drain.
- AF-051 `.artifacts/verification/AF-051/run-HWr7WQ/report.json`: backoff/dead, error sanitization, transactional idempotent side effect.
- AF-052 `.artifacts/verification/AF-052/run-CetCRq/report.json`: real HTTP/RBAC, monitor redaction, database outage/readiness recovery, health liveness, Prisma pool closure.

All tests use this repository's randomly named local acceptance databases and synthetic rows. They do not connect to Qingqi, send messages, invoke paid providers, or demonstrate external exactly-once delivery. The batch is code verified; unified owner acceptance remains pending.
