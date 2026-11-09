# Integration webhook contract

The generic inbound endpoint is owned by `IntegrationCenter` and uses the existing project connector installation and `SecretRef` owners. It does not call a third-party service and has no outbound URL configuration.

## Request

`POST /api/integrations/webhooks/{projectCode}/{connectorCode}` accepts `application/json` and requires these headers:

- `X-AIJ-Webhook-Timestamp`: Unix seconds, within five minutes of server time.
- `X-AIJ-Webhook-Idempotency-Key`: 8–128 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, and `-`.
- `X-AIJ-Webhook-Signature`: `v1=` followed by 64 lowercase hexadecimal characters.

The HMAC-SHA256 input is the UTF-8 bytes `v1\n{projectCode}\n{connectorCode}\n{timestamp}\n{idempotency-key}\n` followed by the exact raw HTTP body bytes. The server compares the digest in constant time, then parses a JSON object. The project and connector route identity are signed, so a request cannot be replayed at another project/connector path even if deployments accidentally configure the same key value. The raw body is limited to 65,536 bytes. The signature key is resolved from the configured `SecretRef` only on the server; neither the request log nor API response returns it.

The connector must be registered, belong to an active project in the current environment, have `webhook:receive`, and not be disabled or failed. The endpoint is public at the HTTP authentication layer; possession of the configured HMAC key is the request authenticator. Admin JWT/RBAC is not used as webhook authentication.

## Replay and persistence

An accepted event stores the project/connector identity, idempotency key, SHA-256 digest of the body, event timestamp, and connector configuration version. It never stores the raw body, signature, or signing key. The database unique key is `(project_id, connector_code, idempotency_key)`.

The same key and same body digest inside the time window returns `202` with `duplicate: true` and creates no additional row. Reusing a key with different content returns `409`. Invalid signatures or timestamps are rejected before inserting an event. This contract does not promise delivery/retry scheduling; that is a later card.

## Connector rotation and lifecycle

An administrator with `admin.integration.manage` can change the connector's `SecretRef` through the existing versioned configuration route and can pause/resume it through `PATCH /api/admin/integrations/projects/{projectCode}/connectors/{connectorCode}/lifecycle` with `{ "action": "disable" | "enable", "expectedVersion": n }`. Each transition increments the installation version and writes a redacted audit/configuration-change record. Stale versions, repeated invalid transitions, and unknown request fields are rejected. Resuming a disabled connector requires its current reference to resolve from the local SecretCenter and its stored scopes to remain valid; rotating its reference while disabled does not resume it.

Webhook verification resolves the currently stored reference for every request. After signature verification, the persistence transaction re-reads installation status, version, reference, project state, scope, and active reference. If a request is in flight while an administrator disables or reconfigures the installation, that request is rejected and no receipt/idempotency row is committed. A receipt already committed before the transition is immutable digest metadata; disabling does not delete it or schedule replay. No secret value is stored in installation, event, audit, configuration-change, response, or error records.
