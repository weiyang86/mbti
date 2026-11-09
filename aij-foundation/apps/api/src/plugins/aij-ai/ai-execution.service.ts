import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { AiExecutionFailureCategory, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { JobService } from "../../async-runtime/job.service";
import { RuntimeRegistry } from "../../async-runtime/registry";
import { SecretRefPort } from "../../secret-center/secret-ref";
import { AiExecutionTraceContext, AiExecutionTraceService } from "./ai-execution-trace.service";
import {
  AiCapabilityCode,
  AI_PLUGIN_CODE,
  AiBudgetExceededException,
  AiBudgetAdmissionPort,
  AiCapabilityPolicyPort,
  AiProviderConfigurationPort,
  AiProviderRegistry,
  AiProviderRequest,
  validateAiInvocation,
  validateAiProviderResult,
  validateAiProviderConfiguration
} from "./ai-provider";

export const AI_EXECUTION_JOB = "aij-ai.execute";
export const AI_EXECUTION_JOB_VERSION = 1;
const JOB_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

export type AiExecutionOptions = Readonly<{ idempotencyKey: string; timeoutMs?: number }>;
export type AiExecutionOutcome = Readonly<{ output: unknown; traceId?: string }>;

class AiExecutionFailure extends Error {
  constructor(readonly category: AiExecutionFailureCategory) {
    super("AI execution failed");
    this.name = "AiExecutionFailure";
  }
}

/** Internal application contract for future workers; there is no public model execution route in G15-01. */
@Injectable()
export class AiModelExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginAccess: PluginRuntimeAccessService,
    private readonly jobs: JobService,
    private readonly runtimeRegistry: RuntimeRegistry,
    private readonly capabilities: AiCapabilityPolicyPort,
    private readonly configuration: AiProviderConfigurationPort,
    private readonly budget: AiBudgetAdmissionPort,
    private readonly secrets: SecretRefPort,
    private readonly providers: AiProviderRegistry,
    private readonly traces: AiExecutionTraceService
  ) {}

  onModuleInit(): void {
    this.runtimeRegistry.registerOrchestratedJob(AI_EXECUTION_JOB, AI_EXECUTION_JOB_VERSION, async job => {
      if (!Number.isSafeInteger(job.attempt) || (job.attempt ?? 0) < 1) {
        throw new ServiceUnavailableException("AI execution attempt is unavailable");
      }
      const outcome = await this.execute(job.payload, job.signal, {
        jobId: job.id,
        attempt: job.attempt as number,
        correlationId: job.correlationId || job.id
      });
      return { resultReference: { executionId: job.id, traceId: outcome.traceId, outputStored: false } };
    });
  }

  async submit(input: unknown, options: AiExecutionOptions) {
    const request = validateAiInvocation(input);
    if (!options || typeof options !== "object" || Array.isArray(options) ||
        Object.keys(options).some(key => !["idempotencyKey", "timeoutMs"].includes(key)) ||
        typeof options.idempotencyKey !== "string" || !JOB_IDEMPOTENCY_KEY.test(options.idempotencyKey) ||
        options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 300_000)) {
      throw new BadRequestException("Invalid AI execution options");
    }
    const timeoutMs = options.timeoutMs ?? 30_000;

    try {
      return await this.prisma.$transaction(async tx => {
        const projectId = await this.pluginAccess.projectId(tx);
        // Keep capability/configuration/budget admission and durable enqueue in one
        // database transaction so a rejected request cannot leave a queued job.
        await this.prepareInTransaction(tx, projectId, request.capabilityCode);
        const job = await this.jobs.enqueueIdempotentInTransaction(tx, {
          type: AI_EXECUTION_JOB,
          version: AI_EXECUTION_JOB_VERSION,
          payload: request,
          scope: { type: "plugin", id: projectId, pluginCode: AI_PLUGIN_CODE },
          idempotencyKey: options.idempotencyKey,
          maxAttempts: 3,
          timeoutMs
        });
        return { id: job.id, status: job.status, idempotentReplay: job.idempotentReplay };
      // ReadCommitted lets a concurrent ON CONFLICT/skip-duplicate replay observe the
      // winning row in the next statement instead of hiding it behind a stale snapshot.
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException ||
          error instanceof NotFoundException || error instanceof ServiceUnavailableException || error instanceof AiBudgetExceededException) throw error;
      throw new ServiceUnavailableException("AI execution request is unavailable");
    }
  }

  async status(id: string) {
    if (typeof id !== "string" || !JOB_ID.test(id)) throw new BadRequestException("Invalid AI execution id");
    try {
      return await this.prisma.$transaction(async tx => {
        const projectId = await this.pluginAccess.projectId(tx);
        await this.pluginAccess.assertEnabledInTransaction(tx, projectId, AI_PLUGIN_CODE);
        return this.jobs.scopedStatusInTransaction(tx, {
          id, jobType: AI_EXECUTION_JOB, scope: "plugin", scopeId: projectId, pluginCode: AI_PLUGIN_CODE
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 3000 });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException ||
          error instanceof NotFoundException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("AI execution status is unavailable");
    }
  }

  async cancel(id: string) {
    if (typeof id !== "string" || !JOB_ID.test(id)) throw new BadRequestException("Invalid AI execution id");
    try {
      return await this.prisma.$transaction(async tx => {
        const projectId = await this.pluginAccess.projectId(tx);
        await this.pluginAccess.assertEnabledInTransaction(tx, projectId, AI_PLUGIN_CODE);
        return this.jobs.cancelScopedInTransaction(tx, {
          id, jobType: AI_EXECUTION_JOB, scope: "plugin", scopeId: projectId, pluginCode: AI_PLUGIN_CODE
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 3000 });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException ||
          error instanceof NotFoundException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("AI execution cancellation is unavailable");
    }
  }

  async execute(input: unknown, signal?: AbortSignal, traceContext?: AiExecutionTraceContext): Promise<AiExecutionOutcome> {
    const request = validateAiInvocation(input);
    let traceId: string | undefined;
    if (traceContext) {
      const projectId = await this.prisma.$transaction(tx => this.pluginAccess.projectId(tx), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 3000
      });
      const trace = await this.traces.start({ ...traceContext, projectId, capabilityCode: request.capabilityCode, input: request.payload });
      traceId = trace.id;
      if (trace.status === "succeeded") return { output: undefined, traceId };
      if (trace.status === "failed") throw new AiExecutionFailure(trace.failureCategory || AiExecutionFailureCategory.execution_error);
    }

    try {
      const prepared = await this.prepare(request.capabilityCode);
      if (traceId) await this.traces.setProvider(traceId, prepared.configuration.providerCode, prepared.configuration.modelCode);
      let credential: string;
      try {
        credential = await this.secrets.resolveTrustedForPlugin(AI_PLUGIN_CODE, prepared.configuration.credentialRef);
        if (typeof credential !== "string" || credential.length === 0) throw new Error("empty credential");
      } catch {
        if (traceId) throw new AiExecutionFailure(AiExecutionFailureCategory.credential_unavailable);
        throw new ServiceUnavailableException("AI provider credentials are unavailable");
      }

      const providerRequest: AiProviderRequest = Object.freeze({
        projectId: prepared.projectId,
        modelCode: prepared.configuration.modelCode,
        capabilityCode: request.capabilityCode,
        payload: request.payload,
        ...(traceId ? { traceId } : {}),
        ...(traceContext ? { correlationId: traceContext.correlationId } : {}),
        signal
      });
      let response: unknown;
      try {
        response = await prepared.provider.invoke(providerRequest, credential);
      } catch {
        if (traceId) throw new AiExecutionFailure(AiExecutionFailureCategory.provider_error);
        throw new ServiceUnavailableException("AI provider request failed");
      }
      if (signal?.aborted) throw new AiExecutionFailure(AiExecutionFailureCategory.timeout);
      let result;
      try {
        result = validateAiProviderResult(response);
      } catch {
        if (traceId) throw new AiExecutionFailure(AiExecutionFailureCategory.invalid_provider_response);
        throw new ServiceUnavailableException("AI provider response is invalid");
      }
      if (traceId) await this.traces.succeed(traceId, result);
      return { output: result.output, ...(traceId ? { traceId } : {}) };
    } catch (error) {
      if (traceId) {
        const category = classifyAiFailure(error, signal);
        await this.traces.fail(traceId, category);
        throw error instanceof AiExecutionFailure ? error : new AiExecutionFailure(category);
      }
      throw error;
    }
  }

  /** Validates the existing project/provider/SecretRef/budget owners before AI-owned work is queued. */
  async assertAvailable(capabilityCode: AiCapabilityCode): Promise<void> {
    await this.prepare(capabilityCode);
  }

  private async prepare(capabilityCode: Parameters<AiCapabilityPolicyPort["assertEnabled"]>[2]) {
    try {
      return await this.prisma.$transaction(async tx => {
        const projectId = await this.pluginAccess.projectId(tx);
        return this.prepareInTransaction(tx, projectId, capabilityCode);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException ||
          error instanceof ForbiddenException || error instanceof NotFoundException ||
          error instanceof ServiceUnavailableException || error instanceof AiBudgetExceededException) throw error;
      throw new ServiceUnavailableException("AI execution is unavailable");
    }
  }

  private async prepareInTransaction(
    tx: Prisma.TransactionClient,
    projectId: string,
    capabilityCode: Parameters<AiCapabilityPolicyPort["assertEnabled"]>[2]
  ) {
    await this.pluginAccess.assertEnabledInTransaction(tx, projectId, AI_PLUGIN_CODE);
    await this.capabilities.assertEnabled(tx, projectId, capabilityCode);
    const configuration = validateAiProviderConfiguration(
      await this.configuration.resolveActive(tx, projectId, capabilityCode)
    );
    const provider = this.providers.get(configuration.providerCode);
    const model = provider.models.find(candidate => candidate.modelCode === configuration.modelCode);
    if (!model || !model.capabilities.includes(capabilityCode)) {
      throw new ServiceUnavailableException("AI model capability is unavailable");
    }
    await this.budget.assertWithinBudget(tx, {
      projectId,
      providerCode: configuration.providerCode,
      modelCode: configuration.modelCode,
      capabilityCode
    });
    return { projectId, configuration, provider };
  }
}

function classifyAiFailure(error: unknown, signal?: AbortSignal): AiExecutionFailureCategory {
  if (signal?.aborted) return AiExecutionFailureCategory.timeout;
  if (error instanceof AiExecutionFailure) return error.category;
  if (error instanceof AiBudgetExceededException) return AiExecutionFailureCategory.budget_denied;
  if (error instanceof ServiceUnavailableException) {
    const message = error.message.toLowerCase();
    if (message.includes("credential")) return AiExecutionFailureCategory.credential_unavailable;
    if (message.includes("capability")) return AiExecutionFailureCategory.capability_unavailable;
    if (message.includes("provider")) return AiExecutionFailureCategory.provider_unavailable;
    return AiExecutionFailureCategory.configuration_unavailable;
  }
  return AiExecutionFailureCategory.execution_error;
}
