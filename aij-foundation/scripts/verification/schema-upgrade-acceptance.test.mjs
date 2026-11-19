import test from "node:test";
import { upgradeAcceptanceTests } from "./schema-upgrade-acceptance.support.mjs";

test("AF-075 upgrades a previous real migration version and preserves fail-closed diagnostics", { timeout: 360000 }, upgradeAcceptanceTests);
