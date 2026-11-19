import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import test from "node:test";
import { assertPortAvailable, portProbeError } from "../port-availability.mjs";

test("a busy loopback port is refused without stopping its listener", async () => {
  const owner = createServer();
  owner.listen(0, "127.0.0.1");
  await once(owner, "listening");
  try {
    const port = owner.address().port;
    await assert.rejects(assertPortAvailable(port), (error) => {
      assert.match(error.message, /occupied/);
      assert.equal(error.cause.code, "EADDRINUSE");
      assert.equal(error.cause.syscall, "listen");
      assert.equal(error.cause.port, port);
      return true;
    });
    assert.equal(owner.listening, true);
  } finally {
    await new Promise((accept) => owner.close(accept));
  }
});

test("permission and address errors preserve the cause rather than claiming port occupancy", () => {
  for (const code of ["EACCES", "EADDRNOTAVAIL"]) {
    const cause = Object.assign(new Error("original socket error"), { code, syscall: "listen", address: "127.0.0.1", port: 3656 });
    const failure = portProbeError(3656, cause);
    assert.doesNotMatch(failure.message, /occupied/);
    assert.match(failure.message, new RegExp(code));
    assert.equal(failure.cause, cause);
    assert.match(failure.stack, /port-availability/);
  }
});
