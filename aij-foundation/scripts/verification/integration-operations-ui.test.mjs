import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("apps/web/app/auth/integrations/page.tsx", "utf8");
const component = readFileSync("apps/web/app/components/admin-integration-operations.tsx", "utf8");
const availability = readFileSync("apps/api/src/menus/menu-availability.service.ts", "utf8");

test("AF-101 integration operations route is backed by the same server permission and concrete APIs", () => {
  assert.match(page, /AdminShell permission="admin\.integration\.manage"/);
  assert.match(component, /admin\.integration\.manage/);
  assert.match(component, /\/operations\?page=/);
  assert.match(component, /\/operations\/\$\{encodeURIComponent\(operation\.id\)\}\/retry/);
  assert.match(component, /secret_reference_check/);
  assert.match(component, /不重放 webhook/);
  assert.match(availability, /"\/auth\/integrations"/);
});
