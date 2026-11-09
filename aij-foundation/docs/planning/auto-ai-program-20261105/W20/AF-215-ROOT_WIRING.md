# AF-215 root wiring

Candidate scope: composition adapter only. Frozen source `129aa515b5c7fd8a3269d97b3521136fc641f59d`; no pending AF191/AF203 implementation was read or imported. Actual candidate Task `task_349ebfa0d142`, Dispatch `ctx_af44a9fff04e`. Original completed I dependency `task_753e493b8c33`; W20 governance I `task_04ba27b7c5dd` (coordinator receipt `msg_34ecfcf52ed0`, root commit `82866f43bc20eb226ade6322d7c3e366602721dd`, AF212 formal report `.artifacts/verification/AF-212/run-ZrFl7B/report.json`). These are dependencies, not a claim that this candidate is CODE_VERIFIED.

## Shared owner hooks, exclusively root

1. Admit **exact AF-215** in original `workbench-sdk-target-runtime.mjs:validateRuntimeOptions`, `remaining-client-fixture.mjs`, `workbench-runtime-safe-fixture.mjs`, `client-auth-fixture.mjs`, `scripts/database/migration.mjs`, and `scripts/database/seed.mjs` finite task lists. Check original database environment/seed guards when registering; do not broaden task patterns or borrow AF191/AF198 lease IDs. Keep runtime's original root/dev/main-worktree/concurrency/fresh-lease guards. Run only root's protected fresh `aij_foundation_af215_test_<16hex>` lease. No source/permission/schema/SDK barrel changes are needed by the adapter.
2. In original runtime `close`, after restoring captured fetch/environment, add measured `environmentRestored`: compare all current environment key/value pairs to its pre-runtime `environment` snapshot. Keep original measured `applicationPools0`, `ownedSockets0`, and `fetchRestored`. Adapter requires all four **exact true** and the host's `ownedSockets === 0`; missing proof rejects. Do not substitute a constant true. Preserve existing cleanup failures and original transport method identities. Original runtime DB snapshot is returned intact: Job `completed`, Run `succeeded`, original `traces` and `trace`; no status translation.
3. Root owns package build/pack, outside npm install, a generic AF215 composition host, real PG/API/SDK assertions, formal registry/queue/execution records and exact-title integration commit. Consumer tests must use the original installed public SDK with the same actual Run; no provider/Job/Trace stubs in formal acceptance. Keep runtime close in root's `finally` if adapter construction fails before adopting it.

## Injection and usage

```js
const runtime = await startWorkbenchTargetRuntime({
  task: 'AF-215', transport: 'AiCenterHttpTransport:owned-loopback',
  concurrency: 1, freshLease: true
});
const adapter = await createWorkbenchTargetAdapter({
  runtime,
  packages: { sdkTgz, contractsTgz }, // absolute real root pack paths
  mountConsumer, // async ({consumer,handler,route}) => {origin,close}
  // Omit nativeDriver for AF215 non-native composition validation.
});
try {
  await adapter.mountConsumer({consumer, handler, route: '/af191-consumer/'});
  // Root's real assertions: SDK same-Run, original POST/Job/Trace counts,
  // permissions/other member/workspace/role/session/transport refusals.
  // adapter.native(...) must reject AF215_NATIVE_DRIVER_REQUIRED here.
  const evidence = await adapter.evidence({consumer, runId, native: [], matrix, sourceFiles});
  // evidence.native is NOT_RUN; it is a descriptor collection, not PASS.
} finally {
  const closed = await adapter.close();
  // closed.evidence is the hash-bound `closed` descriptor; append it to
  // the root's final evidence only after this await succeeds.
}
```

`mountConsumer` is a trusted root callback. It is invoked once, after full consumer verification, with the exact supplied handler, consumer object and `/af191-consumer/`. It must return an exact `http://127.0.0.1:PORT` origin and async `close()` returning a measured `{ownedSockets:0}`. It owns any acquisition cleanup when it throws before returning a binding. If a returned binding has a close method but an invalid origin, adapter retains it for cleanup. Root must always call adapter.close after a failed mount. Adapter joins in-flight operations, attempts host then runtime even if either fails, and caches the successful or rejected close promise. It never deletes the consumer or controls another process. Duplicate adoption of a runtime, duplicate mount, and calls after close reject.

Original counters/databaseSnapshot/pumpJobs/request/fetchAsActor methods are delegated without replacing the owner. Optional original auth/transport helpers are delegated when present. `request` executes once and returns the original result; an unknown POST error propagates with no retry/replay. HTTP evidence stores only method, pathname without query, actor, status and response-body SHA256. Request's hash basis is explicitly `JSON.stringify-returned-body`; fetchAsActor uses actual response bytes from a bounded clone and preserves the original caller body. No cookies, headers, request bodies, output, environment or credentials enter these JSON artifacts.

## Outside consumer and package evidence

The original root consumer/handler is supplied; there is no product consumer UI in this card. The real directory must be outside the repository **and every git worktree**, and canonical paths/files must have no symlink components. AF215 marker `.aij-target-consumer-owned.json` is exactly `{schemaVersion:1,task:'AF-215',acceptanceId:runtime.acceptanceId}`. Only an actual AF191 runtime may use legacy `.af191-owned` bytes `AF-191\n`.

Consumer shape:

```js
{
  directory,
  packages: {sdk:{version,sha256}, contracts:{version,sha256}},
  installedHashes: { // complete package.json + recursive dist graph
    'node_modules/@aij/sdk/package.json': sha256,
    'node_modules/@aij/sdk/dist/index.mjs': sha256,
    // every reachable emitted runtime/declaration file, both packages
  },
  lockSha256
}
```

Files are `sdk.tgz`, `contracts.tgz`, `package-lock.json` and independently installed `node_modules/@aij/{sdk,contracts}`. Use local npm dependencies `file:sdk.tgz`/`file:contracts.tgz`; lockfile v2/v3 records must have those normalized resolved paths, correct SHA512 integrity and exact versions/dependencies. Source `workspace:*` becomes the actual contracts version in the packed SDK. No nested replacement @aij owner, symlink install or missing/unlisted dist file is accepted. Actual tgz bytes, their copies, declared SHA256, installed metadata, complete installed/runtime/declaration graph and current source dist are compared without a historical file count. Tar link/PAX/special entries reject; root's ordinary pnpm package archives must contain regular ustar files/directories. Unexpected archive formats fail rather than falling back.

Matrix is exactly four actual root process receipts, with distinct `name` values `esm`, `cjs`, `esm-types`, `cjs-types`:

```js
{name, command: [executable, ...args], cwd: consumer.directory,
 exitCode: 0, startedAt, finishedAt, stdoutPath, stderrPath}
```

Root executes real module assertions/type commands and captures actual stdout/stderr bytes under the same artifact directory; times must fall after lease creation. Adapter hashes those bytes and command, retaining no raw output/arguments in evidence. A generated PASS JSON or mode-name array is rejected as a receipt. Process receipts describe root execution; they do not replace root assertions or prove that a process ran merely because a caller supplied an object. Browser importmap is deliberately not admitted by this non-native matrix; later browser proof requires a separately reviewed real execution hook.

`evidence()` rechecks ready same-task ownership from `.local-data/postgres/acceptance/<id>.json`, pack/install/lock graph, current original DB identity and counters; outputs a narrow DB projection with BigInt amounts serialized to decimal strings. It copies actual packed/installed/lock bytes into a new private ignored artifact subdirectory and hashes actual descriptor files. It does not persist the complete ownership record, raw DB output, process logs or private response bodies. `sourceFiles` are distinct repository-relative source paths (maximum128), hashes only. Descriptor base is `{path,kind,sha256,task,acceptanceId,observedAt}` with repo-relative paths. No overall success certificate is generated.

## Future native driver, still NOT_RUN

Canonical exported `requiredNativeCases` is exactly:

`desktop-workbench-submit`, `desktop-workbench-read`, `desktop-consumer-read`, `mobile390-workbench-read`, `mobile390-consumer-read`, `anonymous`, `no-permission`, `other-member`, `scope-change`, `role-change`, `session-change`, `blur`, `document-hidden`, `unmount`.

Optional async driver signature is `(caseName,args,{runtime,consumer,hostOrigin,artifactDirectory}) => receipt`. Without driver, native rejects `AF215_NATIVE_DRIVER_REQUIRED` before any mount/native fallback. With driver, an approved case and mounted consumer are required. Receipt is `{task,acceptanceId,case,native:true,runId,observedAt,viewportWidth,screenshot:{path,sha256},...caseFields}`. Its task/lease and optional args.runId must match; original DB must bind Run/Job/Trace to current project/workspace/member/agent. Screenshot must be an actual absolute regular PNG beneath this ignored runtime directory, same invocation timestamp/mtime, hash, valid PNG signature/IHDR/IEND, width1440 or390 for mobile cases. No fallback screenshot or native:true construction occurs in the adapter.

Submit requires queued/status, submissionUnconfirmedObserved/recoveryGetObserved true and postCount1. Reads require succeeded/status and output in RAM; evidence retains only its SHA256. Remaining cases require privateContentCleared true, correct API status401/403/404 for the six refusal cases, and document-hidden additionally requires hiddenObserved true. Native calls bind to the first observed actual Run; later different Run arguments/receipts reject. Evidence accepts only the exact receipts returned by this adapter's driver calls, revalidates bytes/fields and rejects mutation/duplicates/cross-Run reuse. PNG checks include chunk CRCs, IDAT decompression and actual scanline lengths (8-bit, noninterlaced screenshot encoding); unsupported/corrupt screenshots reject. Synthetic unit collaborators exercise these branches but provide no native target proof. Later AF191 full native14 needs the real completed I215 dependency and original target harness; AF203 OS download acceptance remains separate.

## Required root formal run and manual review

Run root's AF215 registered verify:task with fresh protected PG, unchanged original transport, actual Job/Trace and independently installed public SDK. Assert one actual POST/execution and original Run/Job/Trace identity/status, transport fence, anonymous401/no-permission403/other-member404/workspace404/current role403/session401 with unchanged counters, absent-native rejection, exact byte descriptors and measured host/runtime closure/restoration. Exercise root failure cleanup, including missing environment proof. Review source for sensitive body retention and confirm no UI/theme/global dependency changes. There is no worker-started access URL or manual browser page to inspect.

Worker checks are composition-only lint, checkJs, targeted units and two small package builds. Root PG/App/HTTP/outside npm install/formal registry/native/GUI/full build/Linux/Docker/vendor checks are **NOT_RUN** here. All40 targets remain NOT_RUN_TARGET_ACCEPTANCE; vendor DEFERRED_NOT_PASSED; owner PENDING. Root owns any budget remaining within the four-hour card cap.
