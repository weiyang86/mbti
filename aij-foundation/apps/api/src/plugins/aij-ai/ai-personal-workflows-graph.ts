import { createHash } from "node:crypto";

export type WorkflowPredicate = Readonly<{ key: string; op: "exists" }> |
  Readonly<{ key: string; op: "eq" | "neq"; valueType: "string" | "number" | "boolean" | "null"; value: string | number | boolean | null }>;
export type WorkflowNode = Readonly<{ id: string; label?: string }> & (
  { type: "start" | "end" | "human-approval" } |
  { type: "agent"; agentId: string; revision: number } |
  { type: "condition"; predicate: WorkflowPredicate; joinId: string } |
  { type: "parallel"; branches: string[]; joinId: string } |
  { type: "join"; forkId: string } |
  { type: "loop"; maxIterations: number; body: WorkflowBody });
export type WorkflowEdge = Readonly<{ from: string; port: string; to: string; input: string }>;
export type WorkflowBody = Readonly<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] }>;
export type WorkflowGraph = WorkflowBody & Readonly<{ schemaVersion: 1; inputKeys: string[] }>;
export class WorkflowGraphError extends Error {
  constructor() { super("Invalid workflow draft graph"); this.name = "WorkflowGraphError"; }
}
function reject(): never { throw new WorkflowGraphError(); }
const SAFE = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const BAD = ["constructor", "prototype", "__proto__"];
export function workflowKey(v: unknown): string {
  if (typeof v !== "string" || !SAFE.test(v) || BAD.includes(v)) reject();
  return v;
}
export function workflowObject(raw: unknown, allowed: readonly string[], required = allowed): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) reject();
  const d = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).some(k => typeof k !== "string" || !allowed.includes(k) || !d[k]?.enumerable || !("value" in d[k])) ||
    required.some(k => !Object.hasOwn(raw, k))) reject();
  return raw as Record<string, unknown>;
}
function array(raw: unknown, max: number): unknown[] {
  if (!Array.isArray(raw) || raw.length > max || Object.getPrototypeOf(raw) !== Array.prototype ||
    Reflect.ownKeys(raw).length !== raw.length + 1) reject();
  for (let i = 0; i < raw.length; i++) if (!Object.getOwnPropertyDescriptor(raw, String(i))?.enumerable ||
    !("value" in Object.getOwnPropertyDescriptor(raw, String(i))!)) reject();
  return raw;
}
export function workflowRevision(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 2147483647) reject();
  return v;
}
export function workflowAssetId(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v) || BAD.includes(v)) reject();
  return v;
}
function unsafeText(v: string): boolean {
  return [...v].some(c => { const n = c.codePointAt(0)!; return n < 32 || n === 127 || n >= 0xd800 && n <= 0xdfff; });
}
export function workflowLabel(v: unknown): string {
  if (typeof v !== "string" || !v.trim() || v !== v.trim() || v.length > 100 || unsafeText(v)) reject();
  return v;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function predicate(raw: unknown, keys: string[]): WorkflowPredicate {
  const b = workflowObject(raw, ["key", "op", "valueType", "value"], ["key", "op"]);
  const key = workflowKey(b.key);
  if (!keys.includes(key)) reject();
  if (b.op === "exists") { workflowObject(raw, ["key", "op"]); return { key, op: "exists" }; }
  if (b.op !== "eq" && b.op !== "neq") reject();
  workflowObject(raw, ["key", "op", "valueType", "value"]);
  const v = b.value;
  if (!(b.valueType === "null" && v === null || b.valueType === "boolean" && typeof v === "boolean" ||
    b.valueType === "number" && typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e12 ||
    b.valueType === "string" && typeof v === "string" && v.length <= 200 && !unsafeText(v))) reject();
  return { key, op: b.op, valueType: b.valueType as "string" | "number" | "boolean" | "null", value: v as string | number | boolean | null };
}
/** Callable structural check only. No execution, instructions, providers or trusted caller snapshots. */
export function validateWorkflowGraph(raw: unknown) {
  const root = workflowObject(raw, ["schemaVersion", "inputKeys", "nodes", "edges"]);
  if (root.schemaVersion !== 1) reject();
  const keys = array(root.inputKeys, 20).map(workflowKey);
  if (new Set(keys).size !== keys.length) reject();
  const ids = new Set<string>(); let nodeCount = 0, edgeCount = 0;
  const agentRefs: { nodeId: string; agentId: string; revision: number }[] = [];
  function body(rawBody: unknown, depth: number, isRoot = false): WorkflowBody {
    if (depth > 4) reject();
    const b = workflowObject(rawBody, isRoot ? ["schemaVersion", "inputKeys", "nodes", "edges"] : ["nodes", "edges"]);
    const rawNodes = array(b.nodes, 64), rawEdges = array(b.edges, 128);
    nodeCount += rawNodes.length; edgeCount += rawEdges.length;
    if (nodeCount > 64 || edgeCount > 128) reject();
    const nodes: WorkflowNode[] = rawNodes.map(rawNode => {
      const n = workflowObject(rawNode, ["id", "type", "label", "agentId", "revision", "predicate", "joinId", "branches", "forkId", "maxIterations", "body"], ["id", "type"]);
      const id = workflowKey(n.id);
      if (ids.has(id)) reject(); ids.add(id);
      const common = { id, ...(n.label === undefined ? {} : { label: workflowLabel(n.label) }) };
      const fields = ["id", "type", "label"];
      const exact = (extra: string[]) => workflowObject(rawNode, [...fields, ...extra], ["id", "type", ...extra]);
      switch (n.type) {
        case "start": case "end": case "human-approval": exact([]); return { ...common, type: n.type };
        case "agent": {
          exact(["agentId", "revision"]); const agentId = workflowAssetId(n.agentId), revision = workflowRevision(n.revision);
          agentRefs.push({ nodeId: id, agentId, revision }); return { ...common, type: "agent", agentId, revision };
        }
        case "condition": exact(["predicate", "joinId"]); return { ...common, type: "condition", predicate: predicate(n.predicate, keys), joinId: workflowKey(n.joinId) };
        case "parallel": {
          exact(["branches", "joinId"]); const branches = array(n.branches, 8).map(workflowKey);
          if (branches.length < 2 || new Set(branches).size !== branches.length) reject();
          return { ...common, type: "parallel", branches: branches.sort(compare), joinId: workflowKey(n.joinId) };
        }
        case "join": exact(["forkId"]); return { ...common, type: "join", forkId: workflowKey(n.forkId) };
        case "loop": {
          exact(["maxIterations", "body"]);
          if (typeof n.maxIterations !== "number" || !Number.isInteger(n.maxIterations) || n.maxIterations < 1 || n.maxIterations > 20) reject();
          return { ...common, type: "loop", maxIterations: n.maxIterations, body: body(n.body, depth + 1) };
        }
        default: return reject();
      }
    });
    const edges: WorkflowEdge[] = rawEdges.map(rawEdge => {
      const e = workflowObject(rawEdge, ["from", "port", "to", "input"]);
      return { from: workflowKey(e.from), port: workflowKey(e.port), to: workflowKey(e.to), input: workflowKey(e.input) };
    });
    const byId = new Map(nodes.map(n => [n.id, n]));
    const incoming = new Map(nodes.map(n => [n.id, [] as WorkflowEdge[]])), outgoing = new Map(nodes.map(n => [n.id, [] as WorkflowEdge[]]));
    const seen = new Set<string>();
    for (const e of edges) {
      const key = JSON.stringify([e.from, e.port, e.to, e.input]);
      if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to || seen.has(key)) reject();
      seen.add(key); incoming.get(e.to)!.push(e); outgoing.get(e.from)!.push(e);
    }
    if (nodes.filter(n => n.type === "start").length !== 1 || nodes.filter(n => n.type === "end").length !== 1) reject();
    const branches = (n: WorkflowNode) => n.type === "parallel" ? n.branches : n.type === "condition" ? ["false", "true"] : [];
    for (const n of nodes) {
      const ins = incoming.get(n.id)!, outs = outgoing.get(n.id)!;
      const ports = n.type === "end" ? [] : n.type === "parallel" || n.type === "condition" ? branches(n) : ["next"];
      if (outs.length !== ports.length || new Set(outs.map(e => e.port)).size !== outs.length || outs.some(e => !ports.includes(e.port))) reject();
      if (n.type === "join") {
        const fork = byId.get(n.forkId);
        if (!fork || !(fork.type === "parallel" || fork.type === "condition") || fork.joinId !== n.id) reject();
        const required = branches(fork);
        if (ins.length !== required.length || new Set(ins.map(e => e.input)).size !== ins.length || ins.some(e => !required.includes(e.input))) reject();
      } else if (n.type === "start" ? ins.length !== 0 : ins.length !== 1 || ins[0].input !== "in") reject();
      if (n.type === "parallel" || n.type === "condition") {
        const join = byId.get(n.joinId);
        if (!join || join.type !== "join" || join.forkId !== n.id) reject();
      }
    }
    // Topological token stacks prove single-entry, single-exit nested branch regions.
    // A join consumes exactly its own branch token at its matching input port.
    const remaining = new Map(nodes.map(n => [n.id, incoming.get(n.id)!.length]));
    const queue = nodes.filter(n => n.type === "start"); const contexts = new Map<WorkflowEdge, string[]>(); let visited = 0;
    while (queue.length) {
      const n = queue.shift()!; visited++;
      const ins = incoming.get(n.id)!, outs = outgoing.get(n.id)!;
      let stack: string[] = [];
      if (n.type === "join") {
        const popped = ins.map(e => {
          const s = contexts.get(e)!;
          if (s.at(-1) !== n.forkId + ":" + e.input) reject();
          return s.slice(0, -1);
        });
        if (popped.some(s => JSON.stringify(s) !== JSON.stringify(popped[0]))) reject(); stack = popped[0];
      } else if (ins.length) stack = contexts.get(ins[0])!;
      if (n.type === "end" && stack.length) reject();
      for (const e of outs) {
        contexts.set(e, n.type === "parallel" || n.type === "condition" ? [...stack, n.id + ":" + e.port] : [...stack]);
        const count = remaining.get(e.to)! - 1; remaining.set(e.to, count);
        if (!count) queue.push(byId.get(e.to)!);
      }
    }
    if (visited !== nodes.length) reject(); // Unreachable islands and every raw cycle fail.
    return { nodes: nodes.sort((a, b) => compare(a.id, b.id)), edges: edges.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))) };
  }
  const graph: WorkflowGraph = { schemaVersion: 1, inputKeys: keys.sort(compare), ...body(raw, 1, true) };
  const canonical = JSON.stringify(graph);
  if (Buffer.byteLength(canonical, "utf8") > 65536) reject();
  return { graph, canonical, digest: createHash("sha256").update(canonical).digest("hex"),
    status: "DRAFT" as const, structuralValidity: "VALID" as const, nodeCount, edgeCount,
    agentRefs: agentRefs.sort((a, b) => compare(a.nodeId, b.nodeId)) };
}

/** Use before JSON middleware on this route: preserves duplicate keys as a rejection. */
export function parseWorkflowJson(raw: string): unknown {
  if (Buffer.byteLength(raw, "utf8") > 98304) reject();
  let i = 0;
  const ws = () => { while (/[\x20\t\r\n]/.test(raw[i] ?? "x")) i++; };
  function string(): string {
    const start = i++;
    while (i < raw.length) { const c = raw[i++]; if (c === '"') return JSON.parse(raw.slice(start, i)); if (c === "\\") i++; }
    return reject();
  }
  function value(depth: number): void {
    if (depth > 40) reject(); ws();
    if (raw[i] === "{") {
      i++; ws(); const keys = new Set<string>();
      if (raw[i] === "}") { i++; return; }
      while (true) {
        ws(); if (raw[i] !== '"') reject(); const key = string();
        if (keys.has(key) || BAD.includes(key)) reject(); keys.add(key); ws(); if (raw[i++] !== ":") reject(); value(depth + 1); ws();
        if (raw[i] === "}") { i++; return; } if (raw[i++] !== ",") reject();
      }
    }
    if (raw[i] === "[") {
      i++; ws(); if (raw[i] === "]") { i++; return; }
      while (true) { value(depth + 1); ws(); if (raw[i] === "]") { i++; return; } if (raw[i++] !== ",") reject(); }
    }
    if (raw[i] === '"') { string(); return; }
    const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(i));
    if (!m) reject(); i += m[0].length;
  }
  try { value(0); ws(); if (i !== raw.length) reject(); return JSON.parse(raw); } catch { return reject(); }
}
