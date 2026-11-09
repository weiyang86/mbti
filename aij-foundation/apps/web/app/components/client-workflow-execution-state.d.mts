import type { ClientApi, createPersonalWorkflowExecutionClient, createPersonalWorkflowsClient, PublicationMetadata, Preview, RunEnvelope, RecoveryEnvelope } from "@aij/sdk";

export type WorkflowExecutionScope = { memberId: string; workspaceId: string; workflowId: string; revision: number; graphDigest: string };
type Auth = { memberId: string; workspaceId: string; workspaceCode: string; roleId: string; roleCode: string; sessionGeneration: string; permissions: string[] };
type Owner = Pick<WorkflowExecutionScope, "memberId" | "workspaceId" | "workflowId">;
type Pending = Owner & ({ kind: "publication" } | { kind: "run"; publicationId: string; key: string; runId?: string });
export type WorkflowExecutionState = {
  scope: WorkflowExecutionScope | null; auth: Auth | null; publication: PublicationMetadata | null; preview: Preview | null;
  singleAgent: boolean; input: string; runId: string; result: RunEnvelope | null; recovery: RecoveryEnvelope | null;
  review: PublicationMetadata | null; confirmation: "publish" | "unpublish" | "run" | null;
  busy: boolean; issue: { status: number; message: string } | null; notice: string; locked: boolean; pending: Pending | null;
};
export declare function sameWorkflowExecutionScope(a: WorkflowExecutionScope | null, b: WorkflowExecutionScope | null): boolean;
export declare function parseWorkflowExecutionInput(raw: string, approvedKeys: string[]): Record<string, string>;
export declare function workflowExecutionIssue(error: unknown): { status: number; message: string };
declare function snapshot(): WorkflowExecutionState;
declare function subscribe(listener: VoidFunction): VoidFunction;
declare function setScope(value: WorkflowExecutionScope | null): void;
declare function setRequest(value: ClientApi): void;
declare function setChanged(value: VoidFunction): void;
declare function action(): Promise<void>;
declare function allowed(): boolean;
declare function confirmation(kind: "publish" | "unpublish" | "run"): void;
declare function setField(field: "input" | "runId", value: string): void;
export type WorkflowExecutionStore = {
  getSnapshot: typeof snapshot; subscribe: typeof subscribe; setScope: typeof setScope; suspend: VoidFunction;
  setRequest: typeof setRequest; setOnWorkflowChanged: typeof setChanged; setOnScopeRejected(value?: VoidFunction): void;
  verifyAccess: typeof action; readPublication: typeof action; preview: typeof action; canPublish: typeof allowed; canUnpublish: typeof allowed; canSubmit: typeof allowed;
  requestConfirmation: typeof confirmation; cancelConfirmation: VoidFunction; confirmPublication: typeof action; confirmSubmit: typeof action;
  readRun: typeof action; recover: typeof action; canResolveRun: typeof allowed; resolveRun: typeof action;
  reviewPublicationWrite: typeof action; acknowledgePublicationWrite: typeof action; setField: typeof setField;
};
export declare function createWorkflowExecutionState(options: {
  request: ClientApi; executionClientFactory: typeof createPersonalWorkflowExecutionClient; workflowsClientFactory: typeof createPersonalWorkflowsClient;
  onWorkflowChanged?: VoidFunction; onScopeRejected?: VoidFunction; makeKey?: () => string; timeoutMs?: number;
}): WorkflowExecutionStore;
