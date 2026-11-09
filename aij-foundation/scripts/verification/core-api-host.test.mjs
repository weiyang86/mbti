import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "./registry.mjs";

const requireApi = createRequire(join(repositoryRoot, "apps/api/package.json"));

test("the built Nest API consumes @aij/core correlation behavior over real loopback HTTP", { timeout: 30000 }, async () => {
  const { createApplication } = requireApi(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const app = await createApplication();
  try {
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0);
    const base = `http://127.0.0.1:${address.port}`;
    const supplied = "api-core-http-123";
    const accepted = await fetch(`${base}/api/health`, { headers: { "x-correlation-id": supplied } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get("x-correlation-id"), supplied);
    assert.equal((await accepted.json()).success, true);
    const rejected = await fetch(`${base}/api/health`, { headers: { "x-correlation-id": "bad id" } });
    assert.equal(rejected.status, 200);
    assert.match(rejected.headers.get("x-correlation-id") ?? "", /^[0-9a-f-]{36}$/);
  } finally {
    await app.close();
  }
});
