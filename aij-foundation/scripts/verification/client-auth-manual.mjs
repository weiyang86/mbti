import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prepareAuthManual, stopAuthManual } from "./auth-manual.mjs";

export const prepareClientAuthManual = () => prepareAuthManual("AF-025-A");
export const stopClientAuthManual = () => stopAuthManual("AF-025-A");
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args = process.argv.slice(2); assert.equal(args.length, 1); assert.ok(["prepare", "stop"].includes(args[0]));
    console.log(JSON.stringify(await (args[0] === "prepare" ? prepareClientAuthManual() : stopClientAuthManual())));
  } catch { console.error("Owned client authentication preparation/stop rejected; no credential reset or force kill"); process.exitCode = 2; }
}
