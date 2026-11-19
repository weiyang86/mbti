import type { ClientApi } from './index.js';

export type PersonalAgentPublicationMutation = Readonly<{ expectedAgentRevision: number; expectedPublicationVersion: number }>;
export type PersonalAgentPublicationReadiness = Readonly<{ ready: boolean; reason: 'ready' | 'disabled' | 'dependencies_unavailable' | 'validator_unavailable' }>;
export type PersonalAgentPublication = Readonly<{ agentId: string; revision: number; publishedRevision: number | null;
  publicationVersion: number; published: boolean; dependencyReadiness: PersonalAgentPublicationReadiness }>;
export type PersonalAgentPublicationsClient = Readonly<{
  get(workspaceId: string, agentId: string): Promise<PersonalAgentPublication>;
  publish(workspaceId: string, agentId: string, input: PersonalAgentPublicationMutation): Promise<PersonalAgentPublication>;
  unpublish(workspaceId: string, agentId: string, input: PersonalAgentPublicationMutation): Promise<PersonalAgentPublication>;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function invalid(): never { throw new TypeError('Invalid personal Agent publication data'); }
function object(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Reflect.ownKeys(raw).length !== keys.length || keys.some(k => !Object.hasOwn(raw, k)) ||
    Reflect.ownKeys(raw).some(k => typeof k !== 'string' || !keys.includes(k) || !('value' in Object.getOwnPropertyDescriptor(raw, k)!))) invalid();
  return raw as Record<string, unknown>;
}
function counter(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > 2147483647) invalid();
  return value;
}
function mutation(raw: unknown): PersonalAgentPublicationMutation {
  const b = object(raw, ['expectedAgentRevision', 'expectedPublicationVersion']);
  return { expectedAgentRevision: counter(b.expectedAgentRevision, 1), expectedPublicationVersion: counter(b.expectedPublicationVersion) };
}
export function parsePersonalAgentPublication(raw: unknown, expectedAgentId: string): PersonalAgentPublication {
  const b = object(raw, ['agentId', 'revision', 'publishedRevision', 'publicationVersion', 'published', 'dependencyReadiness']);
  if (!UUID.test(expectedAgentId) || b.agentId !== expectedAgentId) invalid();
  const revision = counter(b.revision, 1), publicationVersion = counter(b.publicationVersion);
  const publishedRevision = b.publishedRevision === null ? null : counter(b.publishedRevision, 1);
  if ((publishedRevision !== null && publishedRevision !== revision) || typeof b.published !== 'boolean' || b.published !== (publishedRevision === revision) || (b.published && publicationVersion === 0)) invalid();
  const r = object(b.dependencyReadiness, ['ready', 'reason']);
  if (typeof r.ready !== 'boolean' || !['ready', 'disabled', 'dependencies_unavailable', 'validator_unavailable'].includes(r.reason as string) ||
    r.ready !== (r.reason === 'ready')) invalid();
  return Object.freeze({ agentId: expectedAgentId, revision, publishedRevision, publicationVersion, published: b.published,
    dependencyReadiness: Object.freeze({ ready: r.ready, reason: r.reason as PersonalAgentPublicationReadiness['reason'] }) });
}
/** Stateless private metadata port; validates BOTH directions, never retries a committed write. */
export function createPersonalAgentPublicationsClient(api: ClientApi): PersonalAgentPublicationsClient {
  function request(workspaceId: string, agentId: string, action?: 'publish' | 'unpublish', input?: PersonalAgentPublicationMutation) {
    if (typeof workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId) || typeof agentId !== 'string' || !UUID.test(agentId)) invalid();
    const body = action ? mutation(input) : undefined;
    return api<unknown>('/client/ai/personal-agents/' + encodeURIComponent(agentId) + '/publication' + (action ? '/' + action : ''),
      { method: action ? 'POST' : 'GET', workspaceId, ...(body ? { body: JSON.stringify(body) } : {}) })
      .then(raw => {
        const result = parsePersonalAgentPublication(raw, agentId);
        if (action && body && (result.revision !== body.expectedAgentRevision || result.published !== (action === 'publish') ||
          ![body.expectedPublicationVersion, body.expectedPublicationVersion + 1].includes(result.publicationVersion))) invalid();
        return result;
      });
  }
  return { get: (w, id) => request(w, id), publish: (w, id, b) => request(w, id, 'publish', b), unpublish: (w, id, b) => request(w, id, 'unpublish', b) };
}
