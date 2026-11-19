# Customer Workspace Schema

## Owner and boundary

`ClientWorkspace*` is the customer-tenant data owner. It is distinct from the AIJ project-organization models `OrganizationProfile` / `ProjectProfile` and from administrator RBAC (`SysRole` / `SysPermission`). Customer identity attaches through `MemberUser`; no administrator user or role is a Workspace member.

The G10-01 schema adds five models:

| Model | Responsibility | Key constraints |
| --- | --- | --- |
| `ClientWorkspace` | Customer tenant identity, creator and creation idempotency | Unique code; unique creator + idempotency key |
| `ClientWorkspaceRole` | Tenant-local role definition | Unique workspace + code; unique workspace + id for composite membership FK |
| `ClientWorkspacePermission` | Separate customer permission directory | Unique code; never aliases `SysPermission` |
| `ClientWorkspaceRolePermission` | Role-to-customer-permission grants | Unique role + permission pair |
| `ClientWorkspaceMembership` | Member's tenant membership, state and session version | Unique workspace + member; composite FK requires role from the same workspace |

All hard references use `ON DELETE RESTRICT`. Role removal, membership suspension, membership removal, and tenant lifecycle behavior belong to the later service/API card; the schema does not cascade-delete membership, grants, member identity, or tenant data.

## Scope of this card

The initial additive migration is `20261029030000_client_workspace`. It contains only the five customer-tenant models and their indexes/constraints. It does not add invitations or role-history records because NEXT-06 G10-01 through G10-04 do not implement those flows. No enterprise profile, IP, diagnosis, order, entitlement, prompt, source customer, or source Workspace rows were migrated. Project organization remains separate and is not a tenant authorization boundary.

G10-02 adds `GET /api/client/workspaces/context`, guarded by the client session and `WorkspaceContextGuard`. The client selects a context with `x-aij-workspace-id`; the server treats that value only as a lookup selector and rechecks the authenticated member's active Membership, Workspace, Role, and required active Permission in PostgreSQL on every request. The route requires the explicit `workspace.context.read` permission. Role and permission headers, query parameters, or other self-reported identity fields are ignored. Missing route permission metadata, inactive or missing membership, inactive Workspace/Role/Permission, and cross-Workspace selection fail closed. The response is limited to the selected Workspace identity, role code, and active permission codes, with `Cache-Control: private, no-store`.

The resolver has no authorization cache, so membership state, role grants, and permission status changes take effect on the next request. Client session signature, issuer, audience, project/environment scope, session row, member state, and expiry are still owned by the existing `ClientAuthGuard` and are validated before workspace resolution. G10-03 adds Workspace list/create/update, tenant-local role/member reads, membership add/reactivation, role assignment, status changes, and leave operations. Creating a Workspace atomically creates generic OWNER/MEMBER roles, required customer permission grants, the creator's OWNER membership, and an audit row. Create retries use a creator-scoped idempotency key. Role grants must be within the actor's database-resolved permission set; the last active OWNER cannot be demoted, suspended, removed, or leave. Transaction-scoped PostgreSQL advisory locking serializes concurrent owner membership changes. Mutating calls require the configured Web origin and reject cross-site fetches. No invitation, UI, business data, or default seeded Workspace is added. G10-04 owns the combined HTTP and cross-tenant regression.

## Verification

`pnpm run verify:task -- AF-053` validates/generates Prisma, builds the API, applies the full local migration chain to a new random AF-053 logical test database, repeats deploy and checks status, then exercises unique keys, the same-workspace role foreign key, and delete restrictions with synthetic rows. It never resets or drops a database. The test target is selected only after `db:check -- test` confirms this repository's `127.0.0.1:55433/aij_foundation_test` identity.

G10-01 evidence and its exact exit-code ledger are in [AF-053](../execution/AF-053.md) and `.artifacts/verification/AF-053/`. G10-02's real HTTP/database context authorization evidence is in [AF-054](../execution/AF-054.md) and `.artifacts/verification/AF-054/`.

G10-03's real HTTP/PostgreSQL CRUD, role delegation, state transition, final-owner concurrency and audit evidence is in [AF-055](../execution/AF-055.md), `.artifacts/verification/AF-055/run-dzoswo/report.json` and `.artifacts/af-055/workspace-management-6c36766f8529c21d.json`. It uses the repository's protected test target only to create a random AF-055 logical acceptance database and synthetic customer records; it does not reset or seed the shared test database.

G10-04's real HTTP/PostgreSQL tenant-isolation and identity-confusion evidence is in [AF-056](../execution/AF-056.md), `.artifacts/verification/AF-056/run-6P4KKP/report.json` and `.artifacts/af-056/workspace-isolation-53c38c268373df84.json`. Active customer access succeeds only for database-backed Workspace memberships; foreign selectors and cross-Workspace mutation reject, and administrator/client cookies and tokens are not interchangeable. No production schema or API implementation changed in this regression card.
