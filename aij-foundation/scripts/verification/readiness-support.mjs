import assert from "node:assert/strict";
import { acceptanceRecord, readDatabaseEnvironment, withDatabase } from "../database/connection.mjs";

export function readinessEnvironment(id, task = "AF-011") {
  const record = acceptanceRecord("test", id);
  assert.equal(record.task, task);
  return {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
    RUNTIME_PROFILE: "host", PROJECT_ID: "aij-foundation", APP_ENV: "test", NODE_ENV: "test",
    DATABASE_ENABLED: "true", DATABASE_ACCEPTANCE_ID: id, AUTH_ENABLED: "false", STORAGE_ENABLED: "false", ENABLED_PLUGINS: "",
    WEB_PORT: "3655", API_PORT: "3656", WEB_URL: "http://localhost:3655", NEXT_PUBLIC_API_URL: "http://localhost:3656/api",
    JWT_ISSUER: "urn:aij:aij-foundation:test:api", COOKIE_PREFIX: "aij_foundation_test", LOCAL_STORAGE_ROOT: ".local-data/aij-foundation/test/storage"
  };
}
export async function setTaskDatabaseConnections(id, enabled, task = "AF-011") {
  assert.ok(["AF-011", "AF-013", "AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-025-A", "AF-026", "AF-027", "AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-039", "AF-040", "AF-041", "AF-043", "AF-044", "AF-046", "AF-047", "AF-048", "AF-049", "AF-050", "AF-051", "AF-052"].includes(task));
  const record = acceptanceRecord("test", id); assert.equal(record.task, task);
  return withDatabase("test", readDatabaseEnvironment("test"), async (client) => {
    // Close/reopen only this fresh logical database, never the shared PostgreSQL process.
    await client.query('ALTER DATABASE "' + record.database + '" ALLOW_CONNECTIONS ' + (enabled ? "true" : "false"));
    const { rows: [state] } = await client.query("SELECT datname,datallowconn FROM pg_database WHERE datname=$1", [record.database]);
    assert.equal(state.datallowconn, enabled); return state;
  });
}
export async function applicationSessions(id, task = "AF-011") {
  assert.ok(["AF-011", "AF-013", "AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-025-A", "AF-026", "AF-027", "AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-039", "AF-040", "AF-041", "AF-043", "AF-044", "AF-046", "AF-047", "AF-048", "AF-049", "AF-050", "AF-051", "AF-052", "AF-151"].includes(task));
  const record = acceptanceRecord("test", id); assert.equal(record.task, task);
  return withDatabase("test", readDatabaseEnvironment("test"), async (client) =>
    (await client.query("SELECT pid,application_name AS application,state FROM pg_stat_activity WHERE datname=$1 AND application_name LIKE 'aij-api:%' ORDER BY pid", [record.database])).rows);
}
export async function response(path, expected) {
  const result = await fetch("http://127.0.0.1:3656/api/" + path, { signal: AbortSignal.timeout(8000), headers: { "x-correlation-id": "af011-real-http-probe" } });
  assert.equal(result.status, expected); assert.equal(result.headers.get("x-correlation-id"), "af011-real-http-probe");
  return result.json();
}
export async function waitReady(baseUrl = "http://127.0.0.1:3656") {
  const readyUrl = baseUrl.replace(/\/$/, "") + "/api/ready";
  const deadline=Date.now()+12000;
  while(Date.now()<deadline) {
    try { const r=await fetch(readyUrl,{signal:AbortSignal.timeout(3000)});if(r.status===200)return r.json(); } catch { /* bounded recovery/startup observation */ }
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error("Readiness did not recover");
}
