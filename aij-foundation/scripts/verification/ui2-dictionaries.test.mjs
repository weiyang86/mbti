import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prepareUi1, stopUi1 } from "./ui1-manual.mjs";
import { browserSession, call, queryFor, origin } from "./ui2-support.mjs";

test("AF-035 dictionary page uses the existing API, permission menu and audited database owner", { timeout: 180000 }, async t => {
  let state;
  try {
    state = await prepareUi1("AF-035");
    const manager = await browserSession(state, "ui2-dictionary-manager");
    const reader = await browserSession(state, "ui2-reader");
    const empty = await browserSession(state, "ui2-empty");
    const query = queryFor(state);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const dictCode = "custom.af035." + suffix;
    const secondCode = dictCode + ".secondary";
    let dictId, itemOne, itemTwo;

    await t.test("real page route and backend menu are limited to the dictionary grant", async () => {
      const page = await fetch(origin + "/auth/dictionaries", { headers: { cookie: manager.cookie }, signal: AbortSignal.timeout(8000) });
      assert.equal(page.status, 200); assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      const granted = await call(manager, "/admin/menus/my");
      assert.deepEqual(granted.map(node => node.path), ["/auth/dictionaries"]);
      assert.deepEqual(await call(empty, "/admin/menus/my"), []);
      assert.ok((await call(reader, "/admin/menus/my")).every(node => node.path !== "/auth/dictionaries"));
    });

    await t.test("direct category writes remain protected and duplicate codes are rejected", async () => {
      await call(null, "/admin/dicts", 401);
      await call(reader, "/admin/dicts", 403);
      await call(empty, "/admin/dicts", 403);
      await call(reader, "/admin/dicts", 403, "POST", { dictCode, dictName: "unauthorized" });
      dictId = (await call(manager, "/admin/dicts", 201, "POST", { dictCode, dictName: "AF-035 synthetic", isPublic: true, sortOrder: 2 })).id;
      await call(manager, "/admin/dicts", 409, "POST", { dictCode, dictName: "duplicate" });
      await call(manager, "/admin/dicts", 201, "POST", { dictCode: secondCode, dictName: "AF-035 second", isPublic: false, sortOrder: 1 });
      const firstPage = await call(manager, "/admin/dicts?q=" + encodeURIComponent("custom.af035." + suffix) + "&page=1&pageSize=1");
      const secondPage = await call(manager, "/admin/dicts?q=" + encodeURIComponent("custom.af035." + suffix) + "&page=2&pageSize=1");
      assert.equal(firstPage.total, 2); assert.equal(firstPage.items.length, 1); assert.equal(secondPage.items.length, 1);
      assert.equal(firstPage.items[0].sortOrder, 1); assert.equal(secondPage.items[0].sortOrder, 2);
    });

    await t.test("item pagination, duplicate rejection and disabled category behavior match the API contract", async () => {
      itemOne = (await call(manager, "/admin/dicts/" + dictId + "/items", 201, "POST", { itemValue: "inactive", itemLabel: "Inactive", sortOrder: 1 })).id;
      itemTwo = (await call(manager, "/admin/dicts/" + dictId + "/items", 201, "POST", { itemValue: "ready", itemLabel: "Ready", sortOrder: 2 })).id;
      await call(manager, "/admin/dicts/" + dictId + "/items", 409, "POST", { itemValue: "ready", itemLabel: "Duplicate" });
      const first = await call(manager, "/admin/dicts/" + dictId + "/items?page=1&pageSize=1");
      const second = await call(manager, "/admin/dicts/" + dictId + "/items?page=2&pageSize=1");
      assert.equal(first.total, 2); assert.equal(first.items[0].id, itemOne); assert.equal(second.items[0].id, itemTwo);
      const publicBefore = await call(null, "/dictionaries/" + dictCode + "/items");
      assert.deepEqual(publicBefore.items.map(row => row.itemValue), ["inactive", "ready"]);
      await call(manager, "/admin/dict-items/" + itemTwo, 200, "PATCH", { status: "disabled" });
      assert.deepEqual((await call(null, "/dictionaries/" + dictCode + "/items")).items.map(row => row.itemValue), ["inactive"]);
      await call(manager, "/admin/dicts/" + dictId, 200, "PATCH", { status: "disabled" });
      assert.equal((await call(null, "/dictionaries/" + dictCode + "/items")).total, 0);
      await call(manager, "/admin/dicts/" + dictId + "/items", 409, "POST", { itemValue: "blocked", itemLabel: "Blocked" });
    });

    await t.test("referenced category deletion is rejected; soft-deletion and audit remain in the existing DB owner", async () => {
      await call(manager, "/admin/dicts/" + dictId, 409, "DELETE");
      await call(manager, "/admin/dict-items/" + itemOne, 200, "DELETE");
      await call(manager, "/admin/dict-items/" + itemTwo, 200, "DELETE");
      await call(manager, "/admin/dicts/" + dictId, 200, "DELETE");
      const rows = await query(client => client.query("SELECT action,resource_id FROM public.audit_log WHERE module='dictionaries' AND resource_id = ANY($1::text[])", [[dictId, itemOne, itemTwo]]));
      const actions = rows.rows.map(row => row.action);
      assert.ok(actions.includes("dict_created")); assert.ok(actions.includes("dict_item_created"));
      assert.ok(actions.includes("dict_updated")); assert.ok(actions.includes("dict_deleted"));
      assert.ok(actions.includes("dict_item_updated")); assert.ok(actions.includes("dict_item_deleted"));
      assert.ok(rows.rows.every(row => [dictId, itemOne, itemTwo].includes(row.resource_id)));
    });
  } finally {
    if (state) await stopUi1("AF-035");
  }
});
