import { PersonalDocumentRunOriginPort, documentGenerationObject, documentGenerationClaims, documentGenerationMarker, parseDocumentGenerationRef, makeDocumentGenerationOrigin, documentGenerationRequestHash, type DocumentGenerationRef, type DocumentSectionRef } from './ai-personal-document-run-origin.service';
import { BadRequestException, ConflictException, GoneException, HttpException, Inject, Injectable, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AiAgentRun } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AiCenterCatalog } from '@aij/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceContextService } from '../../client-workspaces/workspace-context.service';
import { CLIENT_WORKSPACE_PERMISSION as P } from '../../client-workspaces/client-workspace-permissions';
import { PluginRuntimeAccessService } from '../../plugin-runtime/plugin-runtime-access.service';
import { SecretRefPort } from '../../secret-center/secret-ref';
import { JobService } from '../../async-runtime/job.service';
import { RuntimeRegistry, type JobHandler } from '../../async-runtime/registry';
import { LocalStorageAdapter } from '../../files/local-storage.adapter';
import { FileContentService } from '../../files/file-content.service';
import { AiCenterConfigurationService } from './ai-center-configuration.service';
import { AiCenterProviderService, compileAgent, type AiAgentSnapshot } from './ai-center-provider';
import { AiCenterBudgetService } from './ai-center-budget.service';
import { AiExecutionTraceService } from './ai-execution-trace.service';
import { AiPersonalAgentSnapshotsService } from './ai-personal-agent-snapshots.service';
import { AiPersonalAgentMemoryContextService, type PersonalAgentMemoryContext } from './ai-personal-agent-memory-context.service';
import { AI_CENTER_CONFIG_KEY } from './ai-center-policy';
import { personalAgentId, personalAgentObject, personalAgentRevision } from './ai-personal-agents.dto';
import { redactAiExternalText } from './deepseek-provider';
import type { ClientClaims } from '../../client-auth/client-auth.security';
import { PersonalWorkflowRunOriginPort, assertWorkflowSnapshot, workflowClaims, workflowMarker, workflowRef, workflowRequestHash, type WorkflowOrigin } from './ai-personal-workflow-run-origin.service';
import { workflowPublicationId } from './ai-personal-workflow-publication.dto';
export const AI_AGENT_JOB = 'aij-ai.agent-execute';
export const AI_SCRIPT_RETENTION = Symbol('AI_SCRIPT_RETENTION');
type AgentJob = Parameters<JobHandler>[0];
const CLEANUP = 'aij-ai.agent-retention';
const RETENTION = 7 * 86400000;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export type AiRunRecoveryReference = Pick<AiAgentRun, 'id' | 'agentCode' | 'status' | 'budgetStatus' | 'createdAt' | 'expiresAt'> & { contentAvailable: boolean };
@Injectable()
export class AiCenterRunService implements OnModuleInit {
    constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspaceContextService, private readonly plugins: PluginRuntimeAccessService, private readonly configuration: AiCenterConfigurationService, private readonly provider: AiCenterProviderService, private readonly budget: AiCenterBudgetService, private readonly secrets: SecretRefPort, private readonly jobs: JobService, private readonly registry: RuntimeRegistry, private readonly traces: AiExecutionTraceService, private readonly storage: LocalStorageAdapter, private readonly content: FileContentService, private readonly config: ConfigService, @Optional() private readonly personalSnapshots?: AiPersonalAgentSnapshotsService, @Optional() private readonly personalMemories?: AiPersonalAgentMemoryContextService, @Optional() private readonly workflowOrigins?: PersonalWorkflowRunOriginPort, @Optional() @Inject(AI_SCRIPT_RETENTION) private readonly scriptRetention?: { purgeExpiredInputs(): Promise<number> }, @Optional() private readonly documentOrigins?: PersonalDocumentRunOriginPort) { }
    onModuleInit() {
        this.registry.registerOrchestratedJob(AI_AGENT_JOB, 1, job => this.execute(job));
        this.registry.registerOrchestratedJob(CLEANUP, 1, async () => ({ resultReference: { cleaned: await this.cleanup() } }));
        this.registry.registerSchedule({ code: CLEANUP, intervalMs: 3600000, job: now => ({ type: CLEANUP, version: 1, payload: { scheduledAt: now.toISOString() }, scope: { type: 'global', id: 'aij-ai' }, idempotencyKey: 'agent-retention:' + now.toISOString(), maxAttempts: 3, timeoutMs: 30000 }) });
    }
    private async context(memberId: string, workspaceId: string, permission: string) { const member = await this.prisma.memberUser.findFirst({ where: { id: memberId, status: "active", deletedAt: null }, select: { id: true } });
        if (!member) throw new NotFoundException("AI member unavailable");
        await this.workspaces.resolve(memberId, workspaceId, [permission]); await this.plugins.assertEnabled('aij-ai'); }
    private snapshot(c: AiCenterCatalog, agentCode: string): AiAgentSnapshot {
        const agent = c.agents.find(a => a.code === agentCode && a.enabled && a.published);
        const model = c.models.find(m => m.code === agent?.modelCode && m.enabled);
        const provider = c.providers.find(p => p.code === model?.providerCode && p.enabled);
        if (!agent || !model || !provider)
            throw new NotFoundException('AI Agent unavailable');
        const skills = agent.skillCodes.map(code => c.skills.find(s => s.code === code && s.enabled));
        if (skills.some(s => !s))
            throw new NotFoundException('AI Skill unavailable');
        return { agent, model, provider, skills: skills as AiAgentSnapshot['skills'] };
    }
    async agents(memberId: string, workspaceId: string) { await this.context(memberId, workspaceId, P.aiExecute); return this.prisma.$transaction(async (tx) => { const c = await this.configuration.current(tx); return c.catalog.agents.filter(a => a.enabled && a.published).map(a => { const s = this.snapshot(c.catalog, a.code); return { code: a.code, name: a.name, revision: a.revision, inputFields: a.inputFields, outputFormat: a.outputFormat, capability: s.model.capability, maximumEstimatedCostNanos: this.budget.estimate(s.model).toString() }; }); }); }
    /** Lifecycle, identity and grant locks live in the SAME admission/dispatch transaction. */
    private async admissionContext(tx: Prisma.TransactionClient, member: string, workspace: string, personal: boolean, workflow = false, permission: string = P.aiExecute) {
        const project = await this.plugins.projectId(tx);
        await this.plugins.assertEnabledInTransaction(tx, project, 'aij-ai');
        const projects = await tx.$queryRaw<{ id: string }[]>`SELECT p.id FROM public.project_profile p
          JOIN public.organization_profile o ON o.id=p.organization_id WHERE p.id=${project}
          AND p.status='active' AND p.deleted_at IS NULL AND o.status='active' AND o.deleted_at IS NULL FOR SHARE OF p,o`;
        const installations = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.plugin_installation
          WHERE project_id=${project} AND plugin_code='aij-ai' AND status='enabled' FOR SHARE`;
        if (!projects.length || !installations.length) throw new NotFoundException('Plugin capability unavailable');
        await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, permission);
        if (personal) await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, P.aiAssetsRead);
        if (workflow) await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, P.workflowsExecute);
        await tx.$queryRaw`SELECT id FROM public.scoped_config WHERE scope='project' AND scope_id=${project}
          AND plugin_code='aij-ai' AND config_key=${AI_CENTER_CONFIG_KEY} FOR SHARE`;
        const c = await this.configuration.current(tx);
        if (c.projectId !== project) throw new ConflictException('AI project changed');
        return c;
    }
    submit(memberId: string, workspaceId: string, agentCode: string, raw: unknown, correlationId?: string) {
        return this.submitSource(memberId, workspaceId, agentCode, raw, correlationId);
    }
    submitPersonal(memberId: string, workspaceId: string, id: string, raw: unknown, correlationId?: string) {
        personalAgentId(id);
        const b = personalAgentObject(raw, ['input', 'idempotencyKey', 'expectedRevision'], ['input', 'idempotencyKey', 'expectedRevision']);
        return this.submitSource(memberId, workspaceId, id, { input: b.input, idempotencyKey: b.idempotencyKey }, correlationId, personalAgentRevision(b.expectedRevision));
    }
    /** Trusted server entry: claims come from the original Guard, never a DTO. */
    submitWorkflow(memberId: string, workspaceId: string, raw: unknown, claims: ClientClaims, correlationId?: string) {
        const b = personalAgentObject(raw, ['publicationId', 'input', 'idempotencyKey'], ['publicationId', 'input', 'idempotencyKey']);
        const publicationId = workflowPublicationId(b.publicationId), identity = workflowClaims(memberId, claims);
        if (!this.workflowOrigins) throw new ServiceUnavailableException('Workflow execution unavailable');
        return this.submitSource(memberId, workspaceId, '', { input: b.input, idempotencyKey: b.idempotencyKey }, correlationId, undefined, { publicationId, claims: identity });
    }
    private async documentOperation<T>(operation: () => Promise<T>): Promise<T> {
        try { if (!this.documentOrigins) throw new ServiceUnavailableException('Document generation unavailable'); return await operation(); }
        catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException('Document generation unavailable'); }
    }
    private documentSelector(ref: DocumentSectionRef) {
        return { documentId: ref.documentId, expectedRevision: ref.revision, bodySha256: ref.bodySha256, sectionId: ref.sectionId };
    }
    private documentInstruction(raw: unknown): string {
        if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000) throw new BadRequestException('Invalid document generation request');
        return raw;
    }
    /** Private preview only; source/Agent/Memory/config/cost all share the original transaction. */
    previewDocumentGeneration(memberId: string, workspaceId: string, raw: unknown, claims: ClientClaims) {
        const b = documentGenerationObject(raw, ['documentId', 'expectedRevision', 'bodySha256', 'sectionId', 'agentId', 'agentRevision', 'instruction']);
        const agentId = personalAgentId(b.agentId), revision = personalAgentRevision(b.agentRevision), instruction = this.documentInstruction(b.instruction);
        const identity = documentGenerationClaims(memberId, claims);
        return this.documentOperation(() => this.prisma.$transaction(async tx => {
            const c = await this.admissionContext(tx, memberId, workspaceId, true, false, P.aiRead);
            const resolved = await this.documentOrigins!.resolveSource(tx, { projectId: c.projectId, workspaceId, memberId },
                { documentId: b.documentId as string, expectedRevision: b.expectedRevision as number, bodySha256: b.bodySha256 as string, sectionId: b.sectionId as string }, identity, 'read');
            if (!this.personalSnapshots || !this.personalMemories) throw new ServiceUnavailableException('Document generation unavailable');
            const memory = await this.personalMemories.select(tx, memberId, workspaceId, agentId);
            const snapshot = await this.personalSnapshots.resolve(tx, c, memberId, workspaceId, agentId, revision);
            const created = makeDocumentGenerationOrigin(resolved, snapshot, instruction, this.budget.estimate(snapshot.model).toString(), c.version);
            compileAgent(snapshot, created.input, memory?.context);
            let configured = false;
            try { this.provider.assertLive(snapshot, this.configuration.approvedBases()); configured = this.config.get<string>('AI_CENTER_CLIENT_EXECUTION_ENABLED') === 'true' && await this.secrets.configuredTrusted(tx, snapshot.provider.credentialRef); }
            catch (error) { if (!(error instanceof ServiceUnavailableException)) throw error; }
            return { origin: created.ref, inputFields: ['source', 'instruction'], modelExecutionConfigured: configured };
        }, { maxWait: 5000, timeout: 10000 }));
    }
    async submitDocumentGeneration(memberId: string, workspaceId: string, raw: unknown, claims: ClientClaims, correlationId?: string) {
        const b = documentGenerationObject(raw, ['origin', 'instruction', 'idempotencyKey']);
        const ref = parseDocumentGenerationRef(b.origin), instruction = this.documentInstruction(b.instruction), identity = documentGenerationClaims(memberId, claims);
        documentGenerationRequestHash(ref, instruction);
        return this.documentOperation(async () => {
            const run = await this.submitSource(memberId, workspaceId, ref.agentId, { input: { instruction }, idempotencyKey: b.idempotencyKey }, correlationId, ref.agentRevision, undefined, { ref, instruction, claims: identity });
            const after = await this.locateDocumentGeneration(memberId, workspaceId, { id: run.id }, identity, 'execute');
            if (!isDeepStrictEqual(after.origin, ref) || run.agentCode !== 'personal:' + ref.agentId) throw new ConflictException('Document generation origin changed');
            return { run, origin: after.origin };
        });
    }
    private locateDocumentGeneration(memberId: string, workspaceId: string, reference: { id: string } | { idempotencyKey: string }, claims: ClientClaims, purpose: 'metadata' | 'read' | 'execute') {
        return this.prisma.$transaction(async tx => {
            const c = await this.admissionContext(tx, memberId, workspaceId, true, false, P.aiRead);
            const row = await tx.aiAgentRun.findFirst({ where: { ...reference, projectId: c.projectId, workspaceId, memberId } });
            if (!row) throw new NotFoundException('Document generation unavailable');
            const inspected = await this.documentOrigins!.inspectOrigin(tx, row, claims);
            if (purpose !== 'metadata') {
                if (row.contentPurgedAt || row.expiresAt.getTime() <= Date.now()) throw new GoneException('AI run content expired');
                if (!row.snapshot || !row.input) throw new ConflictException('Document generation origin changed');
                if (purpose === 'execute') {
                    const source = await this.documentOrigins!.resolveSource(tx, { projectId: c.projectId, workspaceId, memberId }, this.documentSelector(inspected.origin.document), claims, 'execute');
                    if (!isDeepStrictEqual(source.ref, inspected.origin.document)) throw new ConflictException('Document generation origin changed');
                }
                await this.validateSnapshot(tx, c, row, row.snapshot as unknown as AiAgentSnapshot, claims);
            }
            return { runId: row.id, ...inspected };
        }, { maxWait: 5000, timeout: 10000 });
    }
    async readDocumentGeneration(memberId: string, workspaceId: string, rawId: unknown, claims: ClientClaims) {
        if (typeof rawId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(rawId)) throw new BadRequestException('Invalid document generation request');
        const identity = documentGenerationClaims(memberId, claims);
        return this.documentOperation(async () => {
            const before = await this.locateDocumentGeneration(memberId, workspaceId, { id: rawId }, identity, 'read');
            const run = await this.read(memberId, workspaceId, rawId);
            const after = await this.locateDocumentGeneration(memberId, workspaceId, { id: rawId }, identity, 'read');
            if (run.id !== after.runId || !isDeepStrictEqual(before.origin, after.origin)) throw new ConflictException('Document generation origin changed');
            return { run, origin: after.origin };
        });
    }
    async recoverDocumentGeneration(memberId: string, workspaceId: string, rawKey: unknown, claims: ClientClaims) {
        if (typeof rawKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(rawKey)) throw new BadRequestException('Invalid document generation request');
        const identity = documentGenerationClaims(memberId, claims);
        return this.documentOperation(async () => {
            const before = await this.locateDocumentGeneration(memberId, workspaceId, { idempotencyKey: rawKey }, identity, 'metadata');
            const request = await this.recoverRequest(memberId, workspaceId, rawKey);
            const after = await this.locateDocumentGeneration(memberId, workspaceId, { idempotencyKey: rawKey }, identity, 'metadata');
            if (request.id !== after.runId || !isDeepStrictEqual(before.origin, after.origin)) throw new ConflictException('Document generation origin changed');
            return { request, origin: after.origin, documentCurrent: after.documentCurrent };
        });
    }
    private async submitSource(memberId: string, workspaceId: string, sourceId: string, raw: unknown, correlationId?: string, revision?: number,
        workflow?: { publicationId: string; claims: ClientClaims }, document?: { ref: DocumentGenerationRef; instruction: string; claims: ClientClaims }) {
        const b = personalAgentObject(raw, ['input', 'idempotencyKey'], ['input', 'idempotencyKey']);
        if (typeof b.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(b.idempotencyKey)) throw new BadRequestException('Invalid Agent request');
        const inputObject = personalAgentObject(b.input, Object.keys((b.input && typeof b.input === 'object') ? b.input : {}));
        if (Object.keys(inputObject).length > 20 || Object.entries(inputObject).some(([k, v]) => !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k) ||
            ['__proto__', 'constructor', 'prototype'].includes(k) || typeof v !== 'string' || !v.trim() || v.length > 2000)) throw new BadRequestException('Invalid Agent input');
        const body = { idempotencyKey: b.idempotencyKey, input: inputObject as Record<string, string> };
        // Keep legacy catalog hashes unchanged. Personal source + revision can never alias them.
        const canonical = Object.entries(body.input).sort(([a], [b]) => a.localeCompare(b));
        const legacyRequestHash = hash(revision === undefined ? [sourceId, canonical] : ['personal-agent-v1', sourceId, revision, canonical]);
        return this.prisma.$transaction(async tx => {
            const c = await this.admissionContext(tx, memberId, workspaceId, revision !== undefined || !!workflow, !!workflow);
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ai-agent-submit:' + c.projectId + ':' + workspaceId + ':' + memberId + ':' + body.idempotencyKey}))`;
            // Existing document retries acquire original Job -> Run before Document, matching execution/reconciliation.
            const priorDocument = document ? await tx.aiAgentRun.findUnique({ where: { projectId_workspaceId_memberId_idempotencyKey: { projectId: c.projectId, workspaceId, memberId, idempotencyKey: body.idempotencyKey } } }) : undefined;
            if (priorDocument) await this.lockRun(tx, priorDocument.id);
            const documentSource = document ? await this.documentOrigins!.resolveSource(tx, { projectId: c.projectId, memberId, workspaceId }, this.documentSelector(document.ref.document), document.claims, 'execute') : undefined;
            const origin: WorkflowOrigin | undefined = workflow ? await this.workflowOrigins!.resolveOrigin(tx,
                { projectId: c.projectId, memberId, workspaceId }, workflow.publicationId, workflow.claims) : undefined;
            const requestHash = document ? documentGenerationRequestHash(document.ref, document.instruction) : origin ? workflowRequestHash(origin.ref, body.input) : legacyRequestHash;
            const previous = priorDocument ?? await tx.aiAgentRun.findUnique({ where: { projectId_workspaceId_memberId_idempotencyKey: { projectId: c.projectId, workspaceId, memberId, idempotencyKey: body.idempotencyKey } } });
            if (previous) {
                if (previous.requestHash !== requestHash) throw new ConflictException('AI idempotency key conflicts');
                if (document) {
                    if (previous.contentPurgedAt || previous.expiresAt.getTime() <= Date.now()) throw new GoneException('AI run content expired');
                    if (!previous.snapshot || !previous.input || !documentSource) throw new ConflictException('Document generation origin changed');
                    const snapshot = previous.snapshot as unknown as AiAgentSnapshot;
                    await this.validateSnapshot(tx, c, previous, snapshot, document.claims);
                    const actual = makeDocumentGenerationOrigin(documentSource, snapshot, document.instruction, this.budget.estimate(snapshot.model).toString(), c.version);
                    if (!isDeepStrictEqual(actual.ref, document.ref) || !isDeepStrictEqual(documentGenerationMarker(previous.snapshot), document.ref)) throw new ConflictException('Document generation origin changed');
                }
                if (origin) {
                    await this.workflowOrigins!.assertOriginCurrent(tx, previous);
                    if (!this.personalSnapshots) throw new ServiceUnavailableException('Workflow execution unavailable');
                    // Replay is still current authorization; it never reserves or queues again.
                    const current = await this.personalSnapshots.resolve(tx, c, memberId, workspaceId, origin.ref.agentId, origin.ref.agentRevision);
                    if (!current.source) throw new ConflictException('Workflow origin changed');
                    current.source = { ...current.source, workflowOrigin: workflowRef(origin.ref) };
                    assertWorkflowSnapshot(current, origin.ref, origin.inputFields);
                }
                return this.publicRun(previous);
            }
            const agentId = origin?.ref.agentId ?? sourceId, agentRevision = origin?.ref.agentRevision ?? revision;
            if (agentRevision !== undefined && (!this.personalSnapshots || !this.personalMemories)) throw new ServiceUnavailableException('Personal Agent execution unavailable');
            // Memory -> grants -> Agent, matching AF163 CRUD; bodies stay in this TX's RAM.
            const memory = agentRevision === undefined ? undefined : await this.personalMemories!.select(tx, memberId, workspaceId, agentId);
            const s = agentRevision === undefined ? this.snapshot(c.catalog, sourceId) : await this.personalSnapshots!.resolve(tx, c, memberId, workspaceId, agentId, agentRevision);
            if (memory?.refs.length) {
                if (!s.source) throw new ServiceUnavailableException('Personal Agent execution unavailable');
                s.source = { ...s.source, memoryRefs: memory.refs };
            }
            if (origin) {
                if (!s.source) throw new ConflictException('Workflow origin changed');
                s.source = { ...s.source, workflowOrigin: workflowRef(origin.ref) };
                assertWorkflowSnapshot(s, origin.ref, origin.inputFields);
            }
            let admittedDocument: DocumentGenerationRef | undefined;
            if (document) {
                if (!documentSource || !s.source) throw new ConflictException('Document generation origin changed');
                const created = makeDocumentGenerationOrigin(documentSource, s, document.instruction, this.budget.estimate(s.model).toString(), c.version);
                if (!isDeepStrictEqual(created.ref, document.ref)) throw new ConflictException('Document generation origin changed');
                admittedDocument = created.ref; body.input = created.input;
                s.source = { ...s.source, documentOrigin: created.ref };
            }
            if (!isDeepStrictEqual(Object.keys(body.input).sort(), [...s.agent.inputFields].sort())) throw new BadRequestException('Agent input fields do not match');
            const input = Object.fromEntries(Object.entries(body.input).map(([k, v]) => [k, redactAiExternalText(v)]));
            compileAgent(s, input, memory?.context);
            this.provider.assertLive(s, this.configuration.approvedBases());
            if (!await this.secrets.configuredTrusted(tx, s.provider.credentialRef)) throw new ServiceUnavailableException('AI credentials unavailable');
            const id = randomUUID(), jobId = randomUUID();
            const amount = await this.budget.reserve(tx, c.projectId, workspaceId, id, c.catalog, s.model);
            if (admittedDocument && amount.toString() !== admittedDocument.maximumEstimatedCostNanos) throw new ConflictException('Document generation cost changed');
            await this.jobs.enqueueInTransaction(tx, { id: jobId, type: AI_AGENT_JOB, version: 1, payload: { runId: id }, scope: { type: 'plugin', id: c.projectId, pluginCode: 'aij-ai' }, workspaceId, idempotencyKey: 'agent:' + id, maxAttempts: 1, timeoutMs: 180000, correlationId });
            const run = await tx.aiAgentRun.create({ data: { id, projectId: c.projectId, workspaceId, memberId, agentCode: s.agent.code, agentRevision: s.agent.revision, catalogVersion: c.version, jobId, idempotencyKey: body.idempotencyKey, requestHash, snapshot: json(s), input: json(input), estimatedCostNanos: amount, expiresAt: new Date(Date.now() + RETENTION) } });
            if (origin) await this.workflowOrigins!.recordOrigin(tx, run, origin, workflow!.claims);
            if (admittedDocument) await this.documentOrigins!.recordOrigin(tx, run, admittedDocument, document!.claims);
            return this.publicRun(run);
        }, { maxWait: 5000, timeout: 10000 });
    }
    private publicRun(r: AiAgentRun) { return { id: r.id, agentCode: r.agentCode, status: r.status, output: r.output, failureCode: r.failureCode, estimatedCostNanos: r.estimatedCostNanos.toString(), budgetStatus: r.budgetStatus, imageAssetId: r.imageAssetId, createdAt: r.createdAt, expiresAt: r.expiresAt }; }
    /** Public legacy routes cannot project workflow rows without workflow/session authorization.
     * Keep the internal driver unchanged: the workflow owner wraps it with current pre/post checks.
     * The durable relation remains authoritative after retention has purged the snapshot marker.
     */
    private async assertLegacyRun(memberId: string, workspaceId: string, reference: { id: string } | { idempotencyKey: string }) {
        await this.context(memberId, workspaceId, P.aiRead);
        const projectId = await this.prisma.$transaction(tx => this.plugins.projectId(tx));
        const row = await this.prisma.aiAgentRun.findFirst({
            where: { ...reference, projectId, workspaceId, memberId }, select: { id: true, snapshot: true }
        });
        if (!row) throw new NotFoundException('AI run unavailable');
        const source = row.snapshot && typeof row.snapshot === 'object' && !Array.isArray(row.snapshot) ? row.snapshot.source : undefined;
        const markerPresent = source && typeof source === 'object' && !Array.isArray(source) && (Object.hasOwn(source, 'workflowOrigin') || Object.hasOwn(source, 'documentOrigin'));
        if (markerPresent || await this.prisma.aiPersonalWorkflowRunOrigin.findUnique({ where: { runId: row.id }, select: { runId: true } }) || await this.prisma.aiPersonalDocumentRunOrigin.findUnique({ where: { runId: row.id }, select: { runId: true } }))
            throw new NotFoundException('AI run unavailable');
    }
    async readLegacy(memberId: string, workspaceId: string, id: string) {
        await this.assertLegacyRun(memberId, workspaceId, { id });
        return this.read(memberId, workspaceId, id);
    }
    async recoverLegacyRequest(memberId: string, workspaceId: string, key: string) {
        if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new BadRequestException('Invalid AI request key');
        await this.assertLegacyRun(memberId, workspaceId, { idempotencyKey: key });
        return this.recoverRequest(memberId, workspaceId, key);
    }
    async imageLegacy(memberId: string, workspaceId: string, id: string) {
        await this.assertLegacyRun(memberId, workspaceId, { id });
        return this.image(memberId, workspaceId, id);
    }
    /** Observe the original request without reconciling or admitting any execution. */
    async recoverRequest(memberId: string, workspaceId: string, key: unknown): Promise<AiRunRecoveryReference> {
        await this.context(memberId, workspaceId, P.aiRead);
        if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(key))
            throw new BadRequestException('Invalid AI request key');
        const projectId = await this.prisma.$transaction(tx => this.plugins.projectId(tx));
        const row = await this.prisma.aiAgentRun.findUnique({
            where: { projectId_workspaceId_memberId_idempotencyKey: { projectId, workspaceId, memberId, idempotencyKey: key } },
            select: { id: true, agentCode: true, status: true, budgetStatus: true, createdAt: true, expiresAt: true, contentPurgedAt: true }
        });
        if (!row) throw new NotFoundException('AI run unavailable');
        return { id: row.id, agentCode: row.agentCode, status: row.status, budgetStatus: row.budgetStatus, createdAt: row.createdAt, expiresAt: row.expiresAt, contentAvailable: row.contentPurgedAt === null && row.expiresAt.getTime() > Date.now() };
    }
    async read(memberId: string, workspaceId: string, id: string) {
        await this.context(memberId, workspaceId, P.aiRead);
        const projectId = await this.prisma.$transaction(tx => this.plugins.projectId(tx));
        let row = await this.prisma.aiAgentRun.findFirst({ where: { id, projectId, workspaceId, memberId } });
        if (!row)
            throw new NotFoundException('AI run unavailable');
        await this.reconcile(row);
        row = await this.prisma.aiAgentRun.findUniqueOrThrow({ where: { id } });
        if (row.expiresAt.getTime() <= Date.now())
            throw new GoneException('AI run content expired');
        return this.publicRun(row);
    }
    private async reconcile(row: AiAgentRun) {
        if (['queued', 'running'].includes(row.status)) await this.finishFailure(row.id, false, 'RUNTIME_TERMINATED');
    }
    /** Lock order is always Job -> Run -> settlement. No DB lock spans credential/HTTP/storage IO. */
    private async lockRun(tx: Prisma.TransactionClient, id: string, job?: AgentJob) {
        const reference = await tx.aiAgentRun.findUniqueOrThrow({ where: { id }, select: { jobId: true } });
        if (job && (reference.jobId !== job.id || typeof job.leaseOwner !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(job.leaseOwner) ||
            !Number.isSafeInteger(job.attempt) || job.attempt! < 1 || typeof job.leaseNonce !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(job.leaseNonce))) throw new Error('AI_LEASE_INVALID');
        const rows = job ? await tx.$queryRaw<{ id: string; status: string; scope_id: string; workspace_id: string }[]>`
          SELECT id,status,scope_id,workspace_id FROM public.runtime_job WHERE id=${job.id} AND status='running'
          AND job_type=${AI_AGENT_JOB} AND job_version=1 AND scope='plugin' AND plugin_code='aij-ai'
          AND lease_owner=${job.leaseOwner!} AND attempts=${job.attempt!} AND lease_nonce=${job.leaseNonce!}::uuid
          AND lease_expires_at > clock_timestamp() AND deleted_at IS NULL FOR UPDATE` :
          await tx.$queryRaw<{ id: string; status: string; scope_id: string; workspace_id: string }[]>`
          SELECT id,status,scope_id,workspace_id FROM public.runtime_job WHERE id=${reference.jobId} FOR UPDATE`;
        if (!rows[0]) throw new Error('AI_LEASE_LOST');
        await tx.$queryRaw`SELECT id FROM public.ai_agent_run WHERE id=${id} FOR UPDATE`;
        const run = await tx.aiAgentRun.findUniqueOrThrow({ where: { id } });
        if (job && (run.jobId !== job.id || rows[0].scope_id !== run.projectId || rows[0].workspace_id !== run.workspaceId)) throw new Error('AI_JOB_SCOPE_INVALID');
        return { run, jobStatus: rows[0].status };
    }
    private async failLocked(tx: Prisma.TransactionClient, row: AiAgentRun, attempted: boolean, code: string) {
        if (!['queued', 'running'].includes(row.status)) return;
        const uncertain = attempted || !!row.attemptedAt;
        if (!uncertain) await this.budget.settle(tx, row.id, 0n);
        const traces = await tx.aiExecutionTrace.findMany({ where: { jobId: row.jobId, status: 'running' }, select: { id: true } });
        for (const trace of traces) await this.traces.fail(trace.id, 'execution_error', tx);
        await tx.aiAgentRun.update({ where: { id: row.id }, data: { status: uncertain ? 'unknown' : 'failed', failureCode: code, completedAt: new Date(), ...(uncertain ? {} : { estimatedCostNanos: 0n, budgetStatus: 'released' }) } });
    }
    private async finishFailure(id: string, attempted: boolean, code: string, job?: AgentJob) {
        await this.prisma.$transaction(async tx => {
            const { run, jobStatus } = await this.lockRun(tx, id, job);
            // Read reconciliation may only settle terminal runtime jobs; retention may expire content.
            if (!job && !['dead', 'failed', 'cancelled'].includes(jobStatus) && run.expiresAt.getTime() > Date.now()) return;
            await this.failLocked(tx, run, attempted, code);
        });
    }
    /** Called only inside authorized TXs, after Job -> Run and before any Agent lock. */
    private async validateSnapshot(tx: Prisma.TransactionClient, current: { version: number; catalog: AiCenterCatalog }, run: AiAgentRun, s: AiAgentSnapshot, readClaims?: ClientClaims): Promise<PersonalAgentMemoryContext | undefined> {
        const marker = workflowMarker(run.snapshot);
        const documentMarker = documentGenerationMarker(run.snapshot);
        if (this.documentOrigins) await this.documentOrigins.assertOriginCurrent(tx, run, readClaims);
        else if (documentMarker || await tx.aiPersonalDocumentRunOrigin.findUnique({ where: { runId: run.id }, select: { runId: true } }))
            throw new ServiceUnavailableException('Document generation unavailable');
        if (this.workflowOrigins) await this.workflowOrigins.assertOriginCurrent(tx, run);
        else if (marker || await tx.aiPersonalWorkflowRunOrigin.findUnique({ where: { runId: run.id }, select: { runId: true } }))
            throw new ServiceUnavailableException('Workflow execution unavailable');
        if (!s.source) {
            if (!isDeepStrictEqual(this.snapshot(current.catalog, run.agentCode), s)) throw new Error('AI_CONFIGURATION_CHANGED');
            return undefined;
        }
        if (!this.personalSnapshots || s.source.type !== 'personal' || s.source.revision !== run.agentRevision || run.agentCode !== 'personal:' + s.source.agentId ||
            !Number.isInteger(s.source.publicationVersion) || s.source.publicationVersion < 1)
            throw new Error('AI_CONFIGURATION_CHANGED');
        if (s.source.memoryRefs !== undefined && !this.personalMemories) throw new Error('AI_CONFIGURATION_CHANGED');
        const memory = this.personalMemories ? await this.personalMemories.revalidate(tx, run.memberId, run.workspaceId, s.source.agentId, s.source.memoryRefs) : undefined;
        const actual = await this.personalSnapshots.resolve(tx, current, run.memberId, run.workspaceId, s.source.agentId, s.source.revision);
        // Remove ONLY this known extension. All other Agent/Skill/provenance data must match exactly.
        const base = { ...s, source: { ...s.source } };
        delete base.source.memoryRefs;
        // Origin was verified above; remove exactly this known extension and no others.
        if (marker) delete base.source.workflowOrigin;
        if (documentMarker) delete base.source.documentOrigin;
        if (!isDeepStrictEqual(actual, base)) throw new Error('AI_CONFIGURATION_CHANGED');
        return memory;
    }
    private async execute(job: AgentJob) {
        if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload) || Object.keys(job.payload).join() !== 'runId' || typeof (job.payload as Record<string, unknown>).runId !== 'string') throw new Error('AI_AGENT_JOB_INVALID');
        const id = (job.payload as { runId: string }).runId;
        let attempted = false, objectKey: string | undefined, assetCommitted = false;
        try {
            const reference = await this.prisma.aiAgentRun.findUniqueOrThrow({ where: { id } });
            const started = await this.prisma.$transaction(async tx => {
                const current = await this.admissionContext(tx, reference.memberId, reference.workspaceId, !!(reference.snapshot as unknown as AiAgentSnapshot | null)?.source, !!workflowMarker(reference.snapshot));
                const { run } = await this.lockRun(tx, id, job);
                if (['succeeded', 'failed', 'unknown'].includes(run.status)) return null;
                if (run.status === 'running') {
                    await this.failLocked(tx, run, !!run.attemptedAt, 'PREVIOUS_ATTEMPT_UNCERTAIN');
                    return null;
                }
                if (current.projectId !== run.projectId || run.expiresAt.getTime() <= Date.now() || !run.input || !run.snapshot) throw new Error('AI_CONFIGURATION_CHANGED');
                const s = run.snapshot as unknown as AiAgentSnapshot;
                const memory = await this.validateSnapshot(tx, current, run, s);
                compileAgent(s, run.input as Record<string, string>, memory);
                this.provider.assertLive(s, this.configuration.approvedBases());
                // The same already-held Job/Run locks are rechecked after potentially waiting on Memory/Agent.
                await this.lockRun(tx, id, job);
                await tx.aiAgentRun.update({ where: { id }, data: { status: 'running' } });
                // Adapt the SAME Trace owner to this fenced transaction, so start/provider writes
                // cannot escape the Job lock (the generic Core Trace API remains unchanged).
                const traceOwner = new AiExecutionTraceService(tx as PrismaService);
                const trace = await traceOwner.start({ jobId: job.id, attempt: job.attempt!, correlationId: job.correlationId || job.id, projectId: run.projectId, capabilityCode: s.model.capability === 'image' ? 'image.generate' : 'text.generate', input: run.input });
                await traceOwner.setProvider(trace.id, s.provider.code, s.model.code);
                return { run, s, trace };
            }, { maxWait: 5000, timeout: 10000 });
            if (!started) return { resultReference: { runId: id } };
            const { run, s, trace } = started;
            const credential = await this.secrets.resolveTrusted(s.provider.credentialRef);
            const signal = AbortSignal.any([job.signal, AbortSignal.timeout(170000)]);
            signal.throwIfAborted();
            const memory = await this.prisma.$transaction(async tx => {
                // Recheck dependencies after credential IO, immediately before entering transport.
                const current = await this.admissionContext(tx, run.memberId, run.workspaceId, !!s.source, !!workflowMarker(s));
                const { run: r } = await this.lockRun(tx, id, job);
                if (r.status !== 'running' || r.attemptedAt || r.expiresAt.getTime() <= Date.now()) throw new Error('AI_RUN_NO_LONGER_WRITABLE');
                if (current.projectId !== run.projectId || !isDeepStrictEqual(r.snapshot, s)) throw new Error('AI_CONFIGURATION_CHANGED');
                const context = await this.validateSnapshot(tx, current, r, s);
                compileAgent(s, r.input as Record<string, string>, context);
                this.provider.assertLive(s, this.configuration.approvedBases());
                await this.lockRun(tx, id, job);
                signal.throwIfAborted();
                await tx.aiAgentRun.update({ where: { id }, data: { attemptedAt: new Date() } });
                return context;
            });
            attempted = true;
            const result = await this.provider.invoke(s, run.input as Record<string, string>, credential, signal, memory);
            signal.throwIfAborted();
            let asset: Prisma.FileAssetUncheckedCreateInput | undefined;
            if (result.bytes) {
                objectKey = randomUUID();
                const stored = await this.storage.write(objectKey, result.bytes), assetId = randomUUID();
                asset = { id: assetId, originalName: 'generated-avatar.png', filename: objectKey + '.png', mimeType: 'image/png', size: stored.size, path: stored.path, url: '/api/client/ai/runs/' + id + '/image', storageType: 'local', objectKey, checksum: createHash('sha256').update(result.bytes).digest('hex'), projectId: run.projectId, workspaceId: run.workspaceId, pluginCode: 'aij-ai', ownerType: 'ai-run', ownerId: id, uploaderId: run.memberId, status: 'active' };
            }
            const amount = this.budget.estimate(s.model, result.usage);
            await this.prisma.$transaction(async tx => {
                // Revalidate current eligibility after provider/storage IO, before settlement.
                const current = await this.admissionContext(tx, run.memberId, run.workspaceId, !!s.source, !!workflowMarker(s));
                const { run: r } = await this.lockRun(tx, id, job);
                if (r.status !== 'running' || r.expiresAt.getTime() <= Date.now()) throw new Error('AI_RUN_NO_LONGER_WRITABLE');
                if (current.projectId !== run.projectId || !isDeepStrictEqual(r.snapshot, s)) throw new Error('AI_CONFIGURATION_CHANGED');
                await this.validateSnapshot(tx, current, r, s);
                await this.lockRun(tx, id, job);
                signal.throwIfAborted();
                if (asset) await tx.fileAsset.create({ data: asset });
                await this.budget.settle(tx, id, amount);
                await this.traces.succeed(trace.id, { output: result.output, usage: result.usage }, tx);
                await tx.aiAgentRun.update({ where: { id }, data: { status: 'succeeded', output: json(result.output), estimatedCostNanos: amount, budgetStatus: 'settled', imageAssetId: asset?.id ?? null, completedAt: new Date() } });
            });
            assetCommitted = true;
            return { resultReference: { runId: id, status: 'succeeded' } };
        } catch {
            if (objectKey && !assetCommitted) await this.storage.remove(objectKey).catch(() => undefined);
            // A stale/malformed/missing lease cannot mutate even failure or budget state.
            await this.finishFailure(id, attempted, attempted ? 'UPSTREAM_RESULT_UNCERTAIN' : 'AI_EXECUTION_DENIED', job);
            return { resultReference: { runId: id, status: attempted ? 'unknown' : 'failed' } };
        }
    }
    async image(memberId: string, workspaceId: string, id: string) {
        await this.context(memberId, workspaceId, P.aiRead);
        const projectId = await this.prisma.$transaction(tx => this.plugins.projectId(tx));
        const run = await this.prisma.aiAgentRun.findFirst({ where: { id, projectId, workspaceId, memberId, status: 'succeeded' } });
        const file = run?.imageAssetId ? await this.prisma.fileAsset.findFirst({ where: { id: run.imageAssetId, projectId, workspaceId, pluginCode: 'aij-ai', ownerType: 'ai-run', ownerId: id, uploaderId: memberId, status: 'active', deletedAt: null } }) : null;
        if (!file)
            throw new NotFoundException('AI image unavailable');
        return { bytes: await this.content.read(file), mimeType: file.mimeType };
    }
    async cleanup(now = new Date()) {
        const rows = await this.prisma.aiAgentRun.findMany({ where: { contentPurgedAt: null, expiresAt: { lte: now } }, take: 100, orderBy: { expiresAt: 'asc' } });
        for (const row of rows) {
            if (['queued', 'running'].includes(row.status))
                await this.finishFailure(row.id, !!row.attemptedAt, 'RETENTION_EXPIRED');
            await this.prisma.aiAgentRun.update({ where: { id: row.id }, data: { input: Prisma.DbNull, output: Prisma.DbNull, snapshot: Prisma.DbNull, contentPurgedAt: now } });
        }
        return rows.length + (await this.scriptRetention?.purgeExpiredInputs() ?? 0);
    }
}
