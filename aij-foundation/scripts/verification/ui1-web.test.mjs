import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { prepareUi1, stopUi1 } from "./ui1-manual.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { inspectApi } from "./readiness-manual.mjs";

test("UI1 real production Web, API and owned process lifecycle", { timeout: 90000 }, async t => {
  let state;
  try {
    state = await prepareUi1("AF-028");
    await t.test("login and session entry serve built Next HTML and actual JavaScript assets", async () => {
      for (const path of ["/login", "/admin"]) {
        const response = await fetch("http://127.0.0.1:3655" + path); assert.equal(response.status, 200);
        const html = await response.text(); assert.ok(html.includes("AIJ")); assert.ok(!html.includes("aij-admin"), "No administrator data in anonymous HTML");
        const scripts = [...html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)].map(m => m[1]); assert.ok(scripts.length > 0);
        for (const script of scripts) { assert.ok(script.startsWith("/_next/")); const asset = await fetch("http://127.0.0.1:3655" + script); assert.equal(asset.status, 200); assert.ok((await asset.text()).length > 0); }
      }
      const health = await fetch("http://127.0.0.1:3656/api/ready"); assert.equal(health.status, 200);
    });
    await t.test("repeat prepare reuses owned processes and never resets initial credentials", async () => {
      const before = createHash("sha256").update(readFileSync(state.initialPasswordFile)).digest("hex");
      const again = await prepareUi1("AF-028"); assert.equal(again.process.pid, state.process.pid); assert.equal(again.apiPid, state.apiPid); assert.equal(again.database, state.database);
      assert.equal(createHash("sha256").update(readFileSync(state.initialPasswordFile)).digest("hex"), before);
      assert.equal(again.process.command, process.execPath + " " + join(repositoryRoot, "scripts/verification/ui1-web-host.mjs"));
    });
    await t.test("precisely owned shutdown closes both listeners and database pool", async () => {
      await stopUi1("AF-028"); assert.equal(inspectApi(state.process.pid), undefined); assert.equal(inspectApi(state.apiPid), undefined);
      assert.deepEqual(await applicationSessions(state.acceptanceId, "AF-028"), []); state = undefined;
    });
  } finally { if (state) await stopUi1("AF-028"); }
});
