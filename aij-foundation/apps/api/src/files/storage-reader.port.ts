import type { StorageAdapter } from "@aij/runtime-contracts";

// Read capability only; storage implementations and errors keep their existing owner.
export type StorageReaderPort = Pick<StorageAdapter, "read">;
export const STORAGE_READER = Symbol("STORAGE_READER");
