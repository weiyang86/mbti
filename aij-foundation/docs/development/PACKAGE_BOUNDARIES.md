# AIJ workspace package boundaries

## Current audit and ownership decision

This document is the G12-01 audit for the repository state at `dev@41561c1f6f5d74cb9152f8246b705701dd30d091` (2026-10-30 Asia/Shanghai). The root workspace already includes `apps/*` and `packages/*`, but `packages/` did not exist at the audit baseline and neither app depended on an `@aij/*` workspace package. Package names below are assigned to real existing behavior and consumers; they are not generic architecture placeholders.

| Package | Single capability owner | Existing implementation audited | Real host consumer | Public entry intent |
| --- | --- | --- | --- | --- |
| `@aij/core` | Node-side correlation identity utilities | `apps/api/src/common/interceptors/correlation.interceptor.ts` | Nest API request middleware in `apps/api/src/bootstrap.ts` | `resolveCorrelationId`, `correlateRequest`; no Nest dependency |
| `@aij/contracts` | Shared API success-envelope runtime/type contract | Actual response projection in `apps/api/src/common/interceptors/transform.interceptor.ts` and validation in the existing Web client API module | API response interceptor and `@aij/sdk` response parser | `SuccessEnvelope`, `createSuccessEnvelope`, `isSuccessEnvelope` |
| `@aij/sdk` | Browser-side HTTP client and safe error-message mapping | `apps/web/app/components/client-api.mjs` and its declaration | `apps/web/app/components/client-workspaces.tsx` | `ClientRequestFailure`, `createClientApi`, `clientRequestMessage` |
| `@aij/runtime-contracts` | Public runtime event/job, queue/storage adapter and storage-error contracts; API retains runtime behavior | Existing runtime and storage implementations in `apps/api/src/async-runtime/` and `apps/api/src/files/local-storage.adapter.ts` | Nest API (`apps/api`) | `RuntimeScope`, `RuntimeEvent`, `RuntimeJobInput`, `QueueAdapter`, `StorageAdapter`, `OutboxTransaction`, `LocalStorageError` |
| `@aij/ui` | Shared presentational page-heading component; Web retains page data, permissions, actions and styling | Repeated page-heading markup in existing admin and client workspace components | Web (`apps/web`) | `PageHeading`, `PageHeadingProps`; React is a peer dependency |

`apps/api` and `apps/web` remain composition hosts. The old Web helper will become a thin environment adapter only; request construction, response validation, and safe error mapping must have one implementation in `@aij/sdk`. The API interceptor retains Nest wiring only; correlation policy must have one implementation in `@aij/core`. The success-envelope shape and builder/parser must have one implementation in `@aij/contracts`.

## Source, license, and dependency audit

- Read-only source repository snapshot: `dev@cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`, clean working tree. Targeted source files, manifest hashes, and the exact package LICENSE hashes inspected are recorded in `docs/governance/SOURCE_PROVENANCE.md` under “NEXT-08 package audit”.
- The source `packages/foundation-core` and `packages/foundation-contracts` exports are small descriptor/contract starters, not the API/Web runtime implementations above. `packages/plugin-sdk` is a real plugin-manifest validator, but NEXT-08 has no installed plugin consumer; it is not copied or assigned an unused package in this batch. Its lifecycle consumer belongs to the later plugin-runtime work.
- The inspected source package LICENSE files state `Copyright (c) weiyang86. All rights reserved.`. The source repository has no root LICENSE/COPYING/NOTICE and does not establish `apps/api` or `apps/web` package rights. Existing package prototypes are therefore not copied. The target packages must remain private, local-only, and marked `UNLICENSED`; no publish, public registry, OSS-license, or redistribution authorization is inferred. Rights review remains an owner decision before any publication.
- Target baseline direct dependencies: root tooling is pnpm 10 / Node 24 / TypeScript 5.9.3; API is Nest 11 / Prisma 6.19 with no shared package; Web is Next 16 / React 19 with no shared package. `@aij/core` must have no Nest dependency; `@aij/contracts` must have no framework dependency; `@aij/sdk` may depend only on `@aij/contracts` and browser platform APIs. No source lockfile or `node_modules` is reused.

## Boundary rules for this batch

1. Move only explicitly audited responsibilities; do not add framework service layers, business models, database ownership, plugin descriptors, or UI components without a real host consumer.
2. A package is complete only when its actual host imports the package entry and the real host build/runtime check consumes it.
3. Build output is generated from one package source owner. ESM and CommonJS outputs are distribution formats, not separately maintained implementations.
4. `pnpm pack` smoke tests are local artifact checks. They do not publish packages or establish permission to distribute them.

## G12-02 result: `@aij/core`

`packages/core/src/index.ts` is now the only owner of correlation ID validation and request/response propagation. It has no Nest dependency. `apps/api` declares `@aij/core: workspace:*`; its Nest interceptor is a thin adapter that imports/re-exports the package function. The package exports ESM, CommonJS and declarations generated from this one TypeScript source. Generated output remains ignored build output. The built API was started on a task-owned OS-assigned loopback port and returned the caller's valid correlation ID while replacing an invalid one with a UUID.

G12-02 code verification is recorded in [AF-060](../execution/AF-060.md).

## G12-03 implementation: contracts and browser SDK

`@aij/contracts` now owns the typed success envelope and its runtime validator. The Nest transform interceptor calls `createSuccessEnvelope`; it no longer defines a second inline envelope implementation.

`@aij/sdk` now owns browser request construction, response-envelope validation, credentialed no-store fetch behavior, workspace selector header handling, and safe request-error messages. It depends only on the workspace `@aij/contracts` package and browser platform APIs. The Web `client-api.mjs` module is a thin adapter that supplies `NEXT_PUBLIC_API_URL`; existing pages continue through that adapter, while its declaration resolves the public SDK types.

Both packages are private, local-only, and `UNLICENSED`. Their ESM, CommonJS, and type entry points are generated from one TypeScript owner with the workspace builder. Generated output is ignored. No package is published and no source prototype was copied. Build/typecheck/consumer evidence is recorded in [AF-061](../execution/AF-061.md); packed-tarball and ESM/CJS consumer verification completed under [AF-062](../execution/AF-062.md).

## G12-04 result: packed exports and consumer compatibility

AF-062 verified `@aij/core`, `@aij/contracts`, and `@aij/sdk` through actual `pnpm pack` tarballs. Each packed manifest retains `private: true`, `UNLICENSED`, `files: ["dist"]`, and import/require runtime plus declaration conditions. The tarballs contain ESM, CommonJS, `.d.ts`, `.d.mts`, and `.d.cts` entry files.

An isolated consumer installed the local tarballs offline, executed ESM and CommonJS imports, and compiled separate `.mts` and `.cts` consumers with NodeNext resolution. The SDK's packed dependency on contracts was overridden to the local contracts tarball inside that isolated consumer; no registry publish or external lookup was used. The packed consumer passed 5/5 subtests, package ownership regression passed 3/3, and the API/Web builds and lint/typecheck passed. Full details and failure repairs are recorded in [AF-062](../execution/AF-062.md).

These checks establish local archive and consumer compatibility only. The packages remain unpublished and private; rights to distribute source-derived material remain unresolved and are not inferred from passing pack tests.

## G12-05 result: runtime contracts and API host consumption

`@aij/runtime-contracts` is a private, `UNLICENSED`, dependency-free TypeScript package. The package is the single owner for the reusable runtime event/job types, `QueueAdapter`, `StorageAdapter`, `OutboxTransaction` structural port, and `LocalStorageError` contract. Its builder generates ESM, CommonJS and declaration entry points from that source. The Nest API consumes it through a real `workspace:*` dependency.

The existing API remains the single owner of execution and persistence behavior: `JobService implements QueueAdapter`, `LocalStorageAdapter implements StorageAdapter`, and the runtime registry and helper functions consume/re-export the contract types without duplicating their definitions. The task's real filesystem test confirms writes, private file modes, duplicate-key rejection, read/remove and symlink traversal refusal. A separate isolated PostgreSQL/Nest HTTP test confirms job and Outbox persistence, database unique-key rejection, transaction rollback and payload-safe HTTP projection. No business foreign keys were added.

`pnpm run verify:task -- AF-063` passed with exit 0; the report and per-step counts are in [AF-063](../execution/AF-063.md) and `.artifacts/verification/AF-063/run-jxXERr/report.json`. API consumes the CommonJS package condition; the test checks its class identity against that same condition and separately checks the ESM export. Cross-format `instanceof` identity between separately built ESM and CommonJS module instances is not part of the package contract. G12-07 will perform local packed-tarball installation and isolated consumer type-resolution checks for the new packages; AF-063 does not claim that deferred packed-consumer gate has passed.

Four random AF-063 logical acceptance databases were created on this repository's existing test instance during the verified and repaired runs; three completed the runtime persistence test, and one retained only its synthetic Seed after an early fixture-init failure. All owner records, synthetic data and ignored credentials are retained. The task adds only its exact AF-063 acceptance, Seed, runtime-environment and auth-fixture allowlist entries; it does not weaken dev/test target guards or change Schema/migrations. No source database was accessed. Packages remain local-only and unpublished; the source license limitations recorded above still apply.

## G12-06 implementation: shared UI heading and Web host consumption

`@aij/ui` owns one stateless `PageHeading` component and its ReactNode prop contract. It emits the current host class names while `apps/web` continues to own CSS, page copy, API calls, permissions and actions. Nine existing Web admin/client-workspace heading instances now consume the package export; the prior inline heading markup is not retained in those consumers. The package has React as a peer dependency, is `private` and `UNLICENSED`, and has no API, database, or business dependencies.

The workspace package builder emits ESM, CommonJS and declaration entry points from `packages/ui/src/index.ts`. The Web host resolves it through `workspace:*`; local production builds use an isolated `.next-af064` directory and restore Next-generated `tsconfig` and `next-env.d.ts` mutations. G12-07 will still validate local packed-tarball installation and an isolated consumer; this card does not claim the packed consumer gate is complete. No package is published.

## G12-07 result: workspace and packed consumers

AF-065 verifies all five package exports through the actual API/Web workspace links and five local `pnpm pack` artifacts. The temporary consumer installs only local package tarballs plus React peer links into an AF-065 isolated pnpm store with offline mode; it executes ESM and CommonJS imports and typechecks both `.mts`/`.cts` declaration conditions. The UI package's React peer is satisfied from the existing Web workspace dependency. All packages remain private and `UNLICENSED`.

The registered `pnpm run verify:task -- AF-065` passed with 9/9 effective tests (workspace/packed consumer 6/6, package ownership/source-rights regression 3/3), five package builds, API build, isolated production Web build, lint, explicit package lint and typecheck. Evidence is recorded in [AF-065](../execution/AF-065.md) and `.artifacts/verification/AF-065/run-vJBboP/report.json`. This validates local consumption only; no publish or redistribution authorization is inferred.

## G12-08 result: cross-workspace and packed consumer compatibility

AF-066 verifies two separate synthetic consumers against all five existing packages. The workspace consumer is installed with real `workspace:*` dependencies; the isolated packed consumer installs local `pnpm pack` tarballs offline from a task-owned store. Both execute the public ESM and CommonJS exports and compile `.mts` and `.cts` consumers through the package declaration exports. The matrix compares package versions, dependency declarations, export conditions, packed file allowlists, and the `@aij/ui` React peer. pnpm rejects a synthetic `@aij/core@workspace:^99.0.0` consumer with `ERR_PNPM_NO_MATCHING_VERSION_INSIDE_WORKSPACE`.

Filtered workspace installation can recalculate the root hoisted dependency tree. The test therefore removes its temporary workspace members and restores dependencies with `pnpm install --offline --frozen-lockfile` in `finally`; it confirms root React declarations are present and `pnpm-lock.yaml` remains byte-identical. Consumer test 4/4, package-owner regression 3/3, all five package builds, API/Web production builds, lint and typecheck passed. Full command evidence is in [AF-066](../execution/AF-066.md) and `.artifacts/verification/AF-066/run-99DMlC/report.json`.

This proves local install and host compatibility only. Every package remains `private` and `UNLICENSED`; source rights and redistribution authorization remain unresolved. No package was published.

## G13-04A / AF-077: local private `@aij/base` pack

AF-077 adds one local-only package owner at `scripts/distribution/aij-base`. `pnpm pack` creates a private tarball containing a curated, tracked project template and an installer; a separate synthetic consumer installs that tarball offline and exercises the public ESM, CommonJS, and type exports. The CLI materializes a new target and refuses an existing target or unsafe archive entries. It does not resolve runtime code from the source checkout after installation.

`pnpm run verify:task -- AF-077` passed with 6/6 consumer tests; lint and typecheck passed. Evidence is in [AF-077](../execution/AF-077.md) and `.artifacts/verification/AF-077/run-Tt4722/report.json`. The package remains `private`, version `0.1.0`, and local-only. This card does not establish an independently running API/Web host, database readiness, upgrade, or backup/restore; those gates remain assigned to AF-078/079 and parent AF-076. No publish, deployment, public distribution, license, or supported-platform decision is implied.
