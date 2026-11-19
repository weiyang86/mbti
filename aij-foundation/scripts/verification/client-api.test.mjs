import assert from "node:assert/strict";
import test from "node:test";
import { ClientRequestFailure, clientApi, clientRequestMessage } from "../../apps/web/app/components/client-api.mjs";

test("clientApi keeps the client session cookie, cache and workspace selector contract", async t => {
  const originalFetch = globalThis.fetch, originalBase = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:4567/api";
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalBase;
  });

  await t.test("uses credentialed no-store HTTP and passes workspace selection only as a server selector", async () => {
    let observed;
    globalThis.fetch = async (url, options) => {
      observed = { url, options };
      return new Response(JSON.stringify({ success: true, data: { workspaceId: "ws-owned" }, message: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await clientApi("/client/workspaces/context", { workspaceId: "ws-owned" });
    assert.deepEqual(result, { workspaceId: "ws-owned" });
    assert.equal(observed.url, "http://127.0.0.1:4567/api/client/workspaces/context");
    assert.equal(observed.options.credentials, "include");
    assert.equal(observed.options.cache, "no-store");
    assert.equal(new Headers(observed.options.headers).get("x-aij-workspace-id"), "ws-owned");
  });

  await t.test("propagates server denials without turning them into an empty authorized result", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: { statusCode: 403 } }), { status: 403 });
    await assert.rejects(() => clientApi("/client/workspaces/context", { workspaceId: "foreign" }), error => {
      assert.ok(error instanceof ClientRequestFailure);
      assert.equal(error.status, 403);
      assert.match(clientRequestMessage(error), /无权访问/);
      return true;
    });
  });
});
