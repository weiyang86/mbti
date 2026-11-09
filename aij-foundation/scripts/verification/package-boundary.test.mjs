import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the G12 package map gives each current capability one real owner and host", async () => {
  const boundaries = await read("docs/development/PACKAGE_BOUNDARIES.md");
  const api = await read("apps/api/src/common/interceptors/correlation.interceptor.ts");
  const apiTransform = await read("apps/api/src/common/interceptors/transform.interceptor.ts");
  const webClient = await read("apps/web/app/components/client-api.mjs");
  const webConsumer = await read("apps/web/app/components/client-workspaces.tsx");
  const uiPackage = await read("packages/ui/src/index.ts");
  const runtimePackage = await read("packages/runtime-contracts/src/index.ts");
  const runtimeHost = await read("apps/api/src/async-runtime/job.service.ts");
  const currentCore = await read("packages/core/src/index.ts").catch(() => api);
  const currentContracts = await read("packages/contracts/src/index.ts").catch(() => apiTransform);
  const currentSdk = await read("packages/sdk/src/index.ts").catch(() => webClient);

  const ownerRows = boundaries.split("\n").filter((line) => /^\| `@aij\//.test(line));
  assert.equal(ownerRows.length, 5);
  for (const name of ["@aij/core", "@aij/contracts", "@aij/sdk", "@aij/runtime-contracts", "@aij/ui"]) {
    assert.equal(ownerRows.filter((line) => line.startsWith(`| \`${name}\``)).length, 1, `${name} has exactly one owner row`);
  }
  assert.match(currentCore, /export function resolveCorrelationId/);
  assert.match(currentContracts, /createSuccessEnvelope|success: true/);
  assert.match(currentSdk, /credentials: "include"/);
  assert.match(api, /@aij\/core/);
  assert.match(apiTransform, /@aij\/contracts/);
  assert.match(webClient, /@aij\/sdk/);
  assert.doesNotMatch(webClient, /await fetch\(|new Headers\(/);
  assert.match(webConsumer, /from "\.\/client-api\.mjs"/);
  assert.match(webConsumer, /from "@aij\/ui"/);
  assert.match(uiPackage, /export function PageHeading/);
  assert.match(runtimePackage, /export interface QueueAdapter|export type QueueAdapter/);
  assert.match(runtimeHost, /implements QueueAdapter/);
  assert.match(boundaries, /apps\/api\/src\/bootstrap\.ts/);
  assert.match(boundaries, /apps\/web\/app\/components\/client-workspaces\.tsx/);
  assert.match(boundaries, /`@aij\/ui`/);
  assert.doesNotMatch(boundaries, /CompanyProfile|QingqiWorkspace|merchant/i);
});

test("source rights and descriptor dispositions are recorded without publish claims", async () => {
  const provenance = await read("docs/governance/SOURCE_PROVENANCE.md");
  const boundaries = await read("docs/development/PACKAGE_BOUNDARIES.md");
  assert.match(provenance, /cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb/);
  assert.match(provenance, /Copyright \(c\) weiyang86\. All rights reserved\./);
  assert.match(provenance, /source root has no LICENSE\/COPYING\/NOTICE/i);
  assert.match(provenance, /not copied/);
  assert.match(boundaries, /private, local-only, and marked `UNLICENSED`/);
  assert.match(boundaries, /no publish, public registry, OSS-license, or redistribution authorization is inferred/i);
});

test("workspace dependencies audited at baseline include apps and packages only", async () => {
  const workspace = await read("pnpm-workspace.yaml");
  const rootManifest = JSON.parse(await read("package.json"));
  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
  assert.equal(rootManifest.private, true);
  assert.match(await read("docs/development/PACKAGE_BOUNDARIES.md"), /neither app depended on an `@aij\/\*` workspace package/);
});
