import { BadRequestException } from "@nestjs/common";
import { workflowObject, workflowAssetId, workflowRevision, workflowLabel, validateWorkflowGraph } from "./ai-personal-workflows-graph";
export function workflowRequest<T>(parse: () => T): T {
  try { return parse(); } catch { throw new BadRequestException("Invalid personal workflow request"); }
}
export const personalWorkflowObject = (raw: unknown, allowed: string[], required: string[] = []) => workflowRequest(() => workflowObject(raw, allowed, required));
export const personalWorkflowId = (v: unknown) => workflowRequest(() => workflowAssetId(v));
export const personalWorkflowRevision = (v: unknown) => workflowRequest(() => workflowRevision(v));
function content(b: Record<string, unknown>) {
  return { name: workflowLabel(b.name), ...validateWorkflowGraph(b.graph) };
}
export function createPersonalWorkflowDto(raw: unknown) {
  return workflowRequest(() => {
    const b = workflowObject(raw, ["code", "name", "graph"]);
    if (typeof b.code !== "string" || b.code.length < 2 || b.code.length > 63 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(b.code)) throw new Error();
    return { code: b.code, ...content(b) };
  });
}
export function updatePersonalWorkflowDto(raw: unknown) {
  return workflowRequest(() => { const b = workflowObject(raw, ["expectedRevision", "name", "graph"]); return { expectedRevision: workflowRevision(b.expectedRevision), ...content(b) }; });
}
export function deletePersonalWorkflowDto(raw: unknown) {
  return workflowRequest(() => { const b = workflowObject(raw, ["expectedRevision"]); return { expectedRevision: workflowRevision(b.expectedRevision) }; });
}
function queryInt(v: unknown, max: number): number {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,9}$/.test(v) || Number(v) > max) throw new Error();
  return Number(v);
}
export const personalWorkflowRevisionParam = (v: unknown) => workflowRequest(() => queryInt(v, 2147483647));
export function personalWorkflowPage(raw: unknown, versions = false) {
  return workflowRequest(() => {
    const b = workflowObject(raw, ["limit", versions ? "beforeRevision" : "afterId"], []);
    return { limit: b.limit === undefined ? 20 : queryInt(b.limit, 20), afterId: b.afterId === undefined ? "" : workflowAssetId(b.afterId),
      beforeRevision: b.beforeRevision === undefined ? 2147483648 : queryInt(b.beforeRevision, 2147483647) };
  });
}
