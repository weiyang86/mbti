import { createPersonalDocumentsClient, createPersonalDocumentExportsClient, ClientRequestFailure, type ClientApi } from "@aij/sdk";
import type { DocumentScope } from "./client-document-manager";

const same = (a: DocumentScope | null, b: DocumentScope | null) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/** One instance per mounted library; callbacks only execute on explicit SDK operations, never during render. */
export function createDocumentAccess(raw: ClientApi) {
  let scope: DocumentScope | null = null, generation = 0, selected = "";
  let verifier: (workspace: string, signal?: AbortSignal) => Promise<DocumentScope> = async () => { throw new ClientRequestFailure(503); };
  let failure: (error: unknown) => void = () => {};
  const invalidations = new Set<() => void>();
  const invalidate = () => { generation++; for (const notify of invalidations) notify(); };
  const guarded: ClientApi = async <T,>(path: string, options: Parameters<ClientApi>[1] = {}) => {
    const expected = scope, ticket = generation;
    const me = path === "/client/auth/me" && (options.method ?? "GET").toUpperCase() === "GET" && options.workspaceId === undefined;
    if (!expected || !me && options.workspaceId !== expected.workspaceId) throw new ClientRequestFailure(403);
    const verify = async () => {
      try {
        const fresh = await verifier(expected.workspaceId, options.signal ?? undefined);
        if (ticket !== generation || !same(expected, scope) || !same(expected, fresh)) throw new ClientRequestFailure(403);
      } catch (error) { if (ticket === generation && same(expected, scope)) failure(error); throw error instanceof ClientRequestFailure && error.status === 404 ? new ClientRequestFailure(403) : error; }
    };
    await verify();
    let result: T | undefined, refusal: unknown;
    try { result = await raw<T>(path, options); } catch (error) { refusal = error; }
    try { await verify(); }
    catch (error) {
      // Binary bytes must not survive a late scope/session/permission failure.
      if (options.responseKind === "binary" && result && typeof result === "object" && "bytes" in result && result.bytes instanceof Uint8Array) result.bytes.fill(0);
      // A committed mutation followed by access loss has an unknown outcome, not a safe retry.
      if (options.method && !["GET", "HEAD"].includes(options.method.toUpperCase()) &&
        !(refusal instanceof ClientRequestFailure && [400, 403, 404, 409].includes(refusal.status))) throw new ClientRequestFailure(503);
      throw error;
    }
    if (refusal) {
      if (ticket === generation && same(expected, scope) && refusal instanceof ClientRequestFailure && [401, 403, 404].includes(refusal.status)) failure(refusal);
      throw refusal;
    }
    return result as T;
  };
  return {
    request: guarded,
    subscribeInvalidation(notify: () => void) { invalidations.add(notify); return () => { invalidations.delete(notify); }; },
    api: createPersonalDocumentsClient(guarded),
    exportsApi: createPersonalDocumentExportsClient(guarded),
    getScope: () => scope, getGeneration: () => generation, getSelected: () => selected,
    clear() { scope = null; invalidate(); },
    setScope(value: DocumentScope) { const changed = scope !== null && !same(scope, value); scope = value; if (changed) invalidate(); },
    select(value: string) { selected = value; },
    setHandlers(validate: typeof verifier, denied: typeof failure) { verifier = validate; failure = denied; }
  };
}
