import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prepareAuthManual, stopAuthManual } from "./auth-manual.mjs";

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args = process.argv.slice(2); assert.ok([1, 3].includes(args.length)); assert.ok(["prepare", "stop"].includes(args[0]));
    const task = args.length === 1 ? "AF-015" : args[2];
    if (args.length === 3) { assert.equal(args[1], "--task"); assert.ok(["AF-015", "AF-018"].includes(task)); }
    console.log(JSON.stringify(await (args[0] === "prepare" ? prepareAuthManual(task) : stopAuthManual(task))));
  } catch { console.error(JSON.stringify({ status: "REJECTED", reason: "Owned administrator preparation/stop failed; no credential reset or force kill" })); process.exitCode = 2; }
}
