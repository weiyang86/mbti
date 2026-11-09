import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prepareAuthManual, stopAuthManual } from "./auth-manual.mjs";
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args = process.argv.slice(2); assert.equal(args.length, 1); assert.ok(["prepare", "stop"].includes(args[0]));
    console.log(JSON.stringify(await (args[0] === "prepare" ? prepareAuthManual("AF-020") : stopAuthManual("AF-020"))));
  } catch { console.error(JSON.stringify({ status: "REJECTED", reason: "Owned menu preparation/stop failed; no credential reset or force kill" })); process.exitCode = 2; }
}
