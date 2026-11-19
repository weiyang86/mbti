import type { ClientApi, createPersonalScriptExecutionClient, createPersonalSkillsClient, ScriptRef, ScriptRun, ScriptCapability } from "@aij/sdk";
export type PersonalScriptScope = {
    memberId: string;
    workspaceId: string;
    skillId: string;
    revision: number;
    name: string;
    instructions: string;
};
export type PersonalScriptPending = {
    kind: "version" | "run";
    memberId: string;
    workspaceId: string;
    skillId: string;
    revision: number;
    scriptVersionId?: string;
    key?: string;
    runId?: string;
};
export type PersonalScriptState = {
    scope: PersonalScriptScope | null;
    auth: {
        memberId: string;
        workspaceId: string;
        workspaceCode: string;
        roleId: string;
        roleCode: string;
        sessionGeneration: string;
        permissions: string[];
    } | null;
    capability: ScriptCapability | null;
    source: string;
    input: string;
    versionId: string;
    runId: string;
    ref: ScriptRef | null;
    run: ScriptRun | null;
    output: string;
    download: {
        url: string;
        filename: string;
    } | null;
    versionReview: {
        revision: number;
    } | null;
    busy: boolean;
    locked: boolean;
    pending: PersonalScriptPending | null;
    confirmation: "version" | "run" | null;
    issue: {
        status: number;
        message: string;
    } | null;
    notice: string;
};
export declare function samePersonalScriptScope(_a: PersonalScriptScope | null, _b: PersonalScriptScope | null): boolean;
export declare function validPersonalScriptSource(_value: string): boolean;
export declare function parsePersonalScriptInput(_raw: string): unknown;
export declare function personalScriptIssue(_error: unknown): {
    status: number;
    message: string;
};
export declare function createPersonalScriptState(_options: {
    request: ClientApi;
    scriptsClientFactory: typeof createPersonalScriptExecutionClient;
    skillsClientFactory: typeof createPersonalSkillsClient;
    onSkillChanged?: () => void;
    makeKey?: () => string;
    makeObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
    now?: () => number;
    timeoutMs?: number;
}): {
    getSnapshot(): PersonalScriptState;
    subscribe(_listener: () => void): () => void;
    setScope(_scope: PersonalScriptScope | null): void;
    setRequest(_request: ClientApi): void;
    setOnSkillChanged(_callback: () => void): void;
    suspend(): void;
    refresh(): Promise<void>;
    setField(_field: "source" | "input" | "versionId" | "runId", _value: string): void;
    canCreate(): boolean;
    canSubmit(): boolean;
    canResolveRun(): boolean;
    requestConfirmation(_kind: "version" | "run"): void;
    cancelConfirmation(): void;
    confirmVersion(): Promise<void>;
    confirmSubmit(): Promise<void>;
    readVersion(): Promise<void>;
    readRun(): Promise<void>;
    recover(): Promise<void>;
    download(): Promise<void>;
    reviewVersionWrite(): Promise<void>;
    acknowledgeVersionWrite(): Promise<void>;
    resolveRun(): Promise<void>;
};
