# IntegrationCenter connector operations

## Owner and scope

`IntegrationCenter` owns connector operation records, API access, local readiness checks, retry rules, and operation audit events. `SecretCenter` remains the only SecretRef adapter; the operation service receives only the `configuredTrusted` boolean and never receives the resolved value. RBAC remains the server authorization owner. Web consumes the same API and route permission. `AsyncRuntime` remains the repository's only generic durable queue owner.

## Local operation contract

The current registered operation is `secret_reference_check`. It reads the active connector installation and asks SecretCenter whether the current SecretRef is configured in the local process environment or protected local store. It does not re-deliver or replay accepted webhook bodies, make HTTP calls to connector endpoints, or claim provider connectivity. G17-02 intentionally stores only a payload digest, so no retained webhook body exists for replay.

- `POST /api/admin/integrations/projects/:projectCode/connectors/:connectorCode/operations` starts the local check.
- `GET /api/admin/integrations/projects/:projectCode/operations` returns stable, bounded paging with optional status/connector filters.
- `GET /api/admin/integrations/projects/:projectCode/operations/:operationId` returns the safe operation and attempt history.
- `POST /api/admin/integrations/projects/:projectCode/operations/:operationId/retry` retries a failed local check, up to five attempts.

All routes require `admin.integration.manage`; the API enforces RBAC independently of the Web controls. Project, installation status, and `webhook:receive` scope are checked on the server. Retry rechecks current project, connector installation, and SecretRef metadata rather than relying on the prior result.

## Stored data and redaction

The database stores operation type, result, current installation version, attempt count, safe failure code, timestamps, and individual attempt outcomes. It does not store SecretRef values, raw secret material, webhook payloads, provider responses, arbitrary error strings, or request URLs. Audit entries contain only safe operation metadata. Retry and creation run in the same authorized transaction as their attempt record and audit record.

Current failure code: `secret_unavailable`. Unknown project/connector, disabled installation, wrong permission, malformed query, missing operation, retrying success, and retry-limit conditions are rejected without creating a new operation attempt.

## Schema lifecycle

Migration `20261101030000_connector_operation` creates `connector_operation` and `connector_operation_attempt`, constrains status/failure-code consistency and positive counts, and uses restrictive foreign keys to the current installation and parent operation. Installation deletion cannot cascade away operation history.

## Limits

This is a synchronous local readiness operation, not an asynchronous provider execution framework. It does not establish an outbound connector protocol, a provider retry policy, delivery guarantees, or an external service health signal. Those require a later owner-specific task and explicit provider contract.
