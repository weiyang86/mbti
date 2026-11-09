import { BadRequestException } from '@nestjs/common';
import { validateWorkflowGraph, workflowKey } from './ai-personal-workflows-graph';

export type PersonalWorkflowLinearPlan = Readonly<{
  graphDigest: string; nodeId: string; agentId: string; agentRevision: number; inputFields: readonly string[];
}>;
/** Original canonical graph remains the sole digest truth. Never trims unsupported nodes. */
export function compilePersonalWorkflowLinearGraph(raw: unknown, inputFields: readonly string[]): PersonalWorkflowLinearPlan {
  try {
    const checked = validateWorkflowGraph(raw), g = checked.graph;
    const start = g.nodes.find(n => n.type === 'start'), agent = g.nodes.find(n => n.type === 'agent'), end = g.nodes.find(n => n.type === 'end');
    if (g.nodes.length !== 3 || g.edges.length !== 2 || !start || !agent || agent.type !== 'agent' || !end ||
      !g.edges.some(e => e.from === start.id && e.port === 'next' && e.to === agent.id && e.input === 'in') ||
      !g.edges.some(e => e.from === agent.id && e.port === 'next' && e.to === end.id && e.input === 'in')) throw new Error();
    if (!Array.isArray(inputFields) || Object.getPrototypeOf(inputFields) !== Array.prototype || inputFields.length > 20 ||
      Reflect.ownKeys(inputFields).length !== inputFields.length + 1 ||
      Array.from({ length: inputFields.length }, (_, i) => Object.getOwnPropertyDescriptor(inputFields, String(i))).some(d => !d?.enumerable || !('value' in d)) ||
      new Set(inputFields).size !== inputFields.length ||
      inputFields.some(k => workflowKey(k) !== k) || inputFields.length !== g.inputKeys.length || inputFields.some(k => !g.inputKeys.includes(k))) throw new Error();
    return Object.freeze({ graphDigest: checked.digest, nodeId: agent.id, agentId: agent.agentId, agentRevision: agent.revision,
      inputFields: Object.freeze([...g.inputKeys]) });
  } catch { throw new BadRequestException('Unsupported workflow publication graph'); }
}
