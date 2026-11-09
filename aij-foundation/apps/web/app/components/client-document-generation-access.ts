import {
  ClientRequestFailure, createPersonalDocumentsClient, createPersonalDocumentSectionsClient,
  createPersonalAgentsClient, createPersonalAgentPublicationsClient, createPersonalAgentRunPreviewsClient,
  createPersonalDocumentGenerationClient, type ClientApi, type PersonalDocument, type PersonalDocumentSectionIndex
} from '@aij/sdk';
import type { AuthPin, SourcePin, VerifiedSource, Owner, ScopePort, AssetsPort, Availability } from './client-document-generation-state.mjs';

const READ = ['workspace.documents.read', 'workspace.ai.read', 'workspace.ai.assets.read'];
const EXECUTE = [...READ, 'workspace.documents.manage', 'workspace.ai.execute'];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function refuse(status: 403 | 409): never { throw new ClientRequestFailure(status); }
function auth(value: AuthPin | null): AuthPin {
  if (!value || !/^[a-f0-9]{64}$/.test(value.sessionGeneration) ||
    [value.memberId, value.workspaceId, value.roleId, value.roleCode].some(v => !/^[A-Za-z0-9_-]{1,128}$/.test(v)) ||
    !Array.isArray(value.permissions) || value.permissions.some(v => typeof v !== 'string') || new Set(value.permissions).size !== value.permissions.length) refuse(403);
  return Object.freeze({ memberId: value.memberId, workspaceId: value.workspaceId, roleId: value.roleId, roleCode: value.roleCode,
    sessionGeneration: value.sessionGeneration, permissions: Object.freeze([...value.permissions].sort()), validationKey: value.validationKey });
}
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');

/** Only constructs a pin for already-decoded original document/index snapshots; never grants authority. */
export async function buildDocumentGenerationSource(identity: AuthPin, document: PersonalDocument, index: PersonalDocumentSectionIndex, sectionId: string): Promise<VerifiedSource> {
  const a = auth(identity), d = Object.freeze({ ...document }), i = Object.freeze({ ...index, sections: Object.freeze(index.sections.map(s => Object.freeze({ ...s }))) });
  const section = i.sections.find(s => s.id === sectionId);
  if (!section || i.documentId !== d.id || i.revision !== d.revision || i.bodyLength !== d.body.length ||
    i.bodyByteLength !== new TextEncoder().encode(d.body).length || i.bodyByteLength > 65536 ||
    section.end - section.start > 2000 || !d.body.slice(section.start, section.end).trim()) refuse(409);
  const [bodySha256, sectionSha256] = await Promise.all([digest(d.body), digest(d.body.slice(section.start, section.end))]);
  if (bodySha256 !== i.bodySha256) refuse(409);
  return Object.freeze({ pin: Object.freeze({ ...a, documentId: d.id, revision: d.revision, bodySha256, sectionId,
    start: section.start, end: section.end, sectionSha256 }), document: d, index: i });
}

/** Actual public SDK composition over the parent's original guarded ClientApi. No persistence or polling. */
export function createDocumentGenerationAccess({ request, peekAuth, peekSaved, isActive = () => true, onScopeRejected }: {
  request: ClientApi; peekAuth: () => AuthPin | null; peekSaved: () => VerifiedSource | null;
  isActive?: () => boolean; onScopeRejected: (status: 401 | 403 | 404) => void;
}) {
  const current = (expected?: AuthPin) => {
    if (!isActive()) refuse(403);
    const value = auth(peekAuth());
    if (expected && !same(value, expected)) refuse(403);
    return value;
  };
  const transport = (signal: AbortSignal, expected: AuthPin): ClientApi => async <T,>(path: string, options: Parameters<ClientApi>[1] = {}) => {
    signal.throwIfAborted(); current(expected);
    const value = await request<T>(path, { ...options, signal, cache: 'no-store' });
    signal.throwIfAborted(); current(expected); return value;
  };
  async function verifyRecovery(owner: Owner, signal: AbortSignal): Promise<AuthPin> {
    const expected = current();
    if (expected.memberId !== owner.memberId || expected.workspaceId !== owner.workspaceId) refuse(403);
    const api = transport(signal, expected);
    const principal = await api<{ id: string }>('/client/auth/me');
    const context = await api<{ workspaceId: string; roleId: string; roleCode: string; sessionGeneration: string; permissions: string[] }>('/client/workspaces/context', { workspaceId: owner.workspaceId });
    const actual = auth({ memberId: principal.id, workspaceId: context.workspaceId, roleId: context.roleId, roleCode: context.roleCode,
      sessionGeneration: context.sessionGeneration, permissions: context.permissions,
      validationKey: JSON.stringify([context.roleId, context.roleCode, [...context.permissions].sort()]) });
    if (!same(actual, expected) || READ.some(p => !actual.permissions.includes(p))) refuse(403);
    current(expected); return actual;
  }
  const scope: ScopePort = Object.freeze({ active: isActive, peekAuth, peekSaved, verifyRecovery, onScopeRejected,
    async verifySource(expected: SourcePin, mode: 'preview' | 'execute' | 'read', signal: AbortSignal) {
      const before = await verifyRecovery({ memberId: expected.memberId, workspaceId: expected.workspaceId }, signal);
      const required = mode === 'execute' ? EXECUTE : READ;
      if (required.some(p => !before.permissions.includes(p))) refuse(403);
      if (!same(peekSaved()?.pin, expected)) refuse(409);
      const api = transport(signal, before), docs = createPersonalDocumentsClient(api), sections = createPersonalDocumentSectionsClient(api);
      const document = await docs.get(before.workspaceId, expected.documentId, signal);
      if (document.revision !== expected.revision) refuse(409);
      const index = await sections.get(before.workspaceId, document.id, document.revision, signal);
      const result = await buildDocumentGenerationSource(before, document, index, expected.sectionId);
      signal.throwIfAborted(); current(before);
      const after = await verifyRecovery({ memberId: before.memberId, workspaceId: before.workspaceId }, signal);
      if (!same(before, after) || !same(result.pin, expected) || !same(peekSaved()?.pin, expected)) refuse(409);
      return result;
    }
  });
  const assets: AssetsPort = Object.freeze({
    async list(owner: Owner, afterId: string | null, signal: AbortSignal) {
      const identity = await verifyRecovery(owner, signal), api = transport(signal, identity);
      const page = await createPersonalAgentsClient(api).list(owner.workspaceId, { limit: 50, ...(afterId ? { afterId } : {}) });
      await verifyRecovery(owner, signal);
      return Object.freeze({ items: Object.freeze(page.items.map(a => Object.freeze({ id: a.id, revision: a.revision, name: a.name }))), nextCursor: page.nextCursor });
    },
    async inspect(owner: Owner, id: string, signal: AbortSignal) {
      const identity = await verifyRecovery(owner, signal), api = transport(signal, identity), agents = createPersonalAgentsClient(api);
      const agent = await agents.get(owner.workspaceId, id), publication = await createPersonalAgentPublicationsClient(api).get(owner.workspaceId, id);
      let availability: Availability = 'ready';
      if (!agent.enabled || !publication.dependencyReadiness.ready) availability = 'unavailable';
      else if (!publication.published || publication.revision !== agent.revision || publication.publishedRevision !== agent.revision) availability = 'unpublished';
      else if (agent.outputFormat !== 'text' || !Array.isArray(agent.inputFields) || [...agent.inputFields].sort().join() !== 'instruction,source' || agent.inputFields.length !== 2) availability = 'incompatible';
      else {
        // The legacy run-preview route requires ai.execute. Read-only document preview
        // uses the original read-capable model options; generation.preview is authoritative.
        const models = await agents.modelOptions(owner.workspaceId);
        if (models.catalogVersion !== agent.catalogVersion || !models.items.some(m => m.code === agent.modelCode && m.revision === agent.modelRevision && m.capability === 'text')) availability = 'unavailable';
        if (availability === 'ready' && identity.permissions.includes('workspace.ai.execute')) {
          const preview = await createPersonalAgentRunPreviewsClient(api).preview(owner.workspaceId, id, agent.revision);
          if (preview.personalAgentId !== id || preview.revision !== agent.revision || preview.capability !== 'text' || preview.outputFormat !== 'text' ||
            preview.modelCode !== agent.modelCode || preview.modelRevision !== agent.modelRevision || preview.catalogVersion !== agent.catalogVersion ||
            preview.inputFields.length !== 2 || [...preview.inputFields].sort().join() !== 'instruction,source') availability = 'incompatible';
        }
      }
      await verifyRecovery(owner, signal);
      return Object.freeze({ agent: Object.freeze({ id: agent.id, revision: agent.revision, name: agent.name }), availability });
    }
  });
  return Object.freeze({ scope, assets, api: createPersonalDocumentGenerationClient(request) });
}
