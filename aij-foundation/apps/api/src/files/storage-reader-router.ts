import type { StorageReaderPort } from "./storage-reader.port";

// These identifiers describe server-owned metadata, never a URL, path, provider
// hint or credential. Profile creation/authorization belongs to a trusted host.
function validStorageType(value: unknown): value is string {
  if (value === "local") return true;
  if (typeof value !== "string" || value.length > 90) return false;
  const match = /^qiniu:([a-z][a-z0-9]*(?:-[a-z0-9]+)*):v([1-9][0-9]{0,15})$/.exec(value);
  return !!match && match[0] === value && match[1].length <= 64 && Number.isSafeInteger(Number(match[2]));
}

/** Constructor-only trusted composition. Copy the mapping and keep its Map in a
 * private slot so input mutation and Object.freeze's Map limitations cannot
 * change a running registry. Adapters keep ownership of bytes and errors.
 */
export class StorageReaderRouter {
  readonly #readers: ReadonlyMap<string, StorageReaderPort>;

  constructor(entries: readonly (readonly [string, StorageReaderPort])[]) {
    const readers = new Map<string, StorageReaderPort>();
    for (const [storageType, reader] of entries) {
      if (!validStorageType(storageType) || readers.has(storageType) || !reader || typeof reader.read !== "function") {
        throw new TypeError("Invalid storage reader registration");
      }
      readers.set(storageType, reader);
    }
    this.#readers = readers;
    Object.freeze(this);
  }

  resolve(storageType: unknown): StorageReaderPort | undefined {
    return validStorageType(storageType) ? this.#readers.get(storageType) : undefined;
  }
}
