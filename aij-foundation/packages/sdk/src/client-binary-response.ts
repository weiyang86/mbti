/** Invoked inside the original ClientApi fetch branch. Never performs another fetch. */
export type ClientBinaryResponse = { bytes: Uint8Array; headers: Headers };
export const CLIENT_BINARY_LIMIT = 5 * 1024 * 1024;
export async function readClientBinaryResponse(response: Response, maxResponseBytes = CLIENT_BINARY_LIMIT, signal?: AbortSignal): Promise<ClientBinaryResponse> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bytes: Uint8Array | undefined;
  let completed = false;
  const abort = () => { void reader?.cancel().catch(() => {}); };
  try {
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > CLIENT_BINARY_LIMIT || !response.ok || !response.body) throw Error();
    const length = response.headers.get('content-length');
    if (!length || !/^[1-9][0-9]{0,6}$/.test(length) || Number(length) > maxResponseBytes || response.headers.has('content-encoding')) throw Error();
    reader = response.body.getReader();
    bytes = new Uint8Array(Number(length));
    let offset = 0;
    signal?.addEventListener('abort', abort, { once: true });
    while (true) {
      if (signal?.aborted) throw Error();
      const { done, value } = await reader.read();
      if (signal?.aborted) throw Error();
      if (done) break;
      if (!(value instanceof Uint8Array) || offset + value.length > bytes.length) throw Error();
      bytes.set(value, offset); offset += value.length;
    }
    if (offset !== bytes.length) throw Error();
    completed = true;
    return { bytes, headers: new Headers(response.headers) };
  } catch { throw new TypeError('Invalid document export response'); }
  finally {
    signal?.removeEventListener('abort', abort);
    if (!completed) { bytes?.fill(0); try { if (reader) await reader.cancel(); else await response.body?.cancel(); } catch { /* safely discarded */ } }
    reader?.releaseLock();
  }
}
