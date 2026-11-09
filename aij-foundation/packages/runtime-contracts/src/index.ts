export type RuntimeScope = {
  type: "global" | "organization" | "project" | "plugin";
  id: string;
  pluginCode?: string;
};

export type RuntimeEvent<T = unknown> = {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  producer: string;
  scope: RuntimeScope;
  correlationId?: string;
  causationId?: string;
  idempotencyKey: string;
  payload: T;
};

export type RuntimeJobInput<T = unknown> = {
  id?: string;
  type: string;
  version: number;
  payload: T;
  scope: RuntimeScope;
  workspaceId?: string;
  idempotencyKey: string;
  dedupeKey?: string;
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
  timeoutMs?: number;
  correlationId?: string;
};

export interface QueueAdapter {
  enqueue(input: RuntimeJobInput): Promise<{ id: string }>;
}

export interface StorageAdapter {
  relativePath(objectKey: string): string;
  write(objectKey: string, bytes: Uint8Array): Promise<{ path: string; size: number }>;
  read(objectKey: string): Promise<Uint8Array>;
  remove(objectKey: string): Promise<void>;
  exists(objectKey: string): Promise<boolean>;
}

export type LocalStorageErrorCode =
  | "STORAGE_ROOT_INVALID"
  | "STORAGE_PATH_UNSAFE"
  | "STORAGE_ROOT_PERMISSIONS"
  | "OBJECT_KEY_INVALID"
  | "OBJECT_EXISTS"
  | "OBJECT_MISSING"
  | "OBJECT_INVALID"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_READ_FAILED"
  | "STORAGE_DELETE_FAILED";

export class LocalStorageError extends Error {
  constructor(readonly code: LocalStorageErrorCode) {
    super(code);
    this.name = "LocalStorageError";
  }
}

export type OutboxTransaction = {
  runtimeOutbox: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};
