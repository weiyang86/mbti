import test from "node:test";
import { acceptanceTests } from "./migration-acceptance.support.mjs";

test("AF-010 protected development-instance acceptance database", { timeout: 55000 }, acceptanceTests("dev"));
