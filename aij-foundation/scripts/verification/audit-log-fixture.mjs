// Own AF-024 synthetic observation row only; existing AuditLog remains the sole record owner.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { acceptanceRecord, readDatabaseEnvironment, withDatabase } from "../database/connection.mjs";
export async function prepareAuditObservation(id) {
  assert.equal(acceptanceRecord("test", id).task, "AF-024");
  return withDatabase("test", readDatabaseEnvironment("test", process.env, id), async client => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('aij-af024-observation'))");
      const existing = (await client.query("SELECT id,request_summary FROM public.audit_log WHERE module='auth' AND action='login_failed' AND resource_id='af024-manual-observation'")).rows;
      assert.ok(existing.length <= 1);
      if (existing.length) { assert.equal(existing[0].request_summary.fixtureVersion, "AF-024-v1"); await client.query("COMMIT"); return { id: existing[0].id, preserved: true }; }
      const auditId = randomUUID(), data = { fixtureVersion: "AF-024-v1", correlationId: "af024-observation", password: "AF024_SYNTHETIC_PASSWORD_MARKER", nested: { apiKey: "AF024_SYNTHETIC_KEY_MARKER" } };
      await client.query("INSERT INTO public.audit_log (id,module,action,resource_type,resource_id,status,request_summary,before_data,after_data,error_message) VALUES ($1,'auth','login_failed','admin-auth','af024-manual-observation','failed',$2::jsonb,$2::jsonb,$2::jsonb,'AF024_SYNTHETIC_ERROR_MARKER')", [auditId, JSON.stringify(data)]);
      await client.query("COMMIT"); return { id: auditId, preserved: false };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }, { acceptanceId: id });
}
