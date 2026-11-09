import test from "node:test";
import { acceptanceTests } from "./migration-acceptance.support.mjs";

test("AF-010 protected test-instance acceptance database", { timeout: 55000 }, acceptanceTests("test"));
