import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ConnectorOperationFailureCode, ConnectorOperationStatus, ConnectorOperationType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ManagementAccessService } from "../rbac/management-access.service";
import { SecretRefPort } from "../secret-center/secret-ref";
import { INTEGRATION_MANAGEMENT_PERMISSION } from "../../../../scripts/integration-policy.cjs";
import { requireConnectorManifest } from "./connector-manifest";
import { ConnectorOperationsQueryDto } from "./connector-operation.dto";

const MAX_ATTEMPTS = 5;
const operationSelect = {
  id: true, projectId: true, connectorCode: true, type: true, status: true, attemptCount: true,
  lastFailureCode: true, installationVersion: true, startedAt: true, completedAt: true, createdAt: true, updatedAt: true,
  attempts: { orderBy: { attempt: "asc" as const }, select: { attempt: true, status: true, failureCode: true, startedAt: true, completedAt: true, createdAt: true } }
} satisfies Prisma.ConnectorOperationSelect;

type SelectedOperation = Prisma.ConnectorOperationGetPayload<{ select: typeof operationSelect }>;

@Injectable()
export class ConnectorOperationsService {
  private readonly environment: string;

  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService,
    private readonly secrets: SecretRefPort, runtime: ConfigService) {
    this.environment = runtime.getOrThrow<string>("environment");
  }

  private async project(tx: Prisma.TransactionClient, code: string) {
    const project = await tx.projectProfile.findFirst({ where: { code, deletedAt: null, organization: { deletedAt: null } },
      select: { id: true, environment: true, status: true, organization: { select: { status: true } } } });
    if (!project) throw new NotFoundException("Project integration context unavailable");
    if (project.environment !== this.environment || project.status !== "active" || project.organization.status !== "active") {
      throw new ForbiddenException("Project integration context disabled");
    }
    return project;
  }

  private async installation(tx: Prisma.TransactionClient, projectId: string, connectorCode: string) {
    const manifest = requireConnectorManifest(connectorCode);
    if (manifest.protocol !== "webhook" || !manifest.scopes.includes("webhook:receive")) throw new NotFoundException("Connector operation unavailable");
    const row = await tx.connectorInstallation.findUnique({ where: { projectId_connectorCode: { projectId, connectorCode } } });
    if (!row || row.deletedAt || !["configured", "enabled"].includes(row.status) || !row.scopes.includes("webhook:receive")) {
      throw new NotFoundException("Connector operation unavailable");
    }
    return row;
  }

  private safe(row: SelectedOperation) {
    return {
      id: row.id, connectorCode: row.connectorCode, type: row.type, status: row.status,
      attemptCount: row.attemptCount, lastFailureCode: row.lastFailureCode,
      installationVersion: row.installationVersion, startedAt: row.startedAt, completedAt: row.completedAt,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
      attempts: row.attempts.map(attempt => ({ attempt: attempt.attempt, status: attempt.status,
        failureCode: attempt.failureCode, startedAt: attempt.startedAt, completedAt: attempt.completedAt, createdAt: attempt.createdAt }))
    };
  }

  list(projectCode: string, query: ConnectorOperationsQueryDto) {
    return this.access.database(() => this.prisma.$transaction(async tx => {
      const project = await this.project(tx, projectCode);
      const where: Prisma.ConnectorOperationWhereInput = { projectId: project.id,
        ...(query.status ? { status: query.status } : {}), ...(query.connectorCode ? { connectorCode: query.connectorCode } : {}) };
      const [total, rows] = await Promise.all([
        tx.connectorOperation.count({ where }),
        tx.connectorOperation.findMany({ where, select: operationSelect, skip: (query.page - 1) * query.pageSize,
          take: query.pageSize, orderBy: [{ createdAt: "desc" }, { id: "asc" }] })
      ]);
      return { items: rows.map(row => this.safe(row)), total, page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 3000 }));
  }

  detail(projectCode: string, operationId: string) {
    return this.access.database(() => this.prisma.$transaction(async tx => {
      const project = await this.project(tx, projectCode);
      const row = await tx.connectorOperation.findFirst({ where: { id: operationId, projectId: project.id }, select: operationSelect });
      if (!row) throw new NotFoundException("Connector operation not found");
      return this.safe(row);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 3000 }));
  }

  start(projectCode: string, connectorCode: string, type: "secret_reference_check", operatorId: string, correlationId?: string) {
    if (type !== ConnectorOperationType.secret_reference_check) throw new BadRequestException("Connector operation type is not supported");
    return this.access.write(operatorId, [INTEGRATION_MANAGEMENT_PERMISSION], async (tx, actor) => {
      const project = await this.project(tx, projectCode);
      const installation = await this.installation(tx, project.id, connectorCode);
      const outcome = await this.checkSecret(tx, installation.secretRef);
      const operation = await this.persistAttempt(tx, { projectId: project.id, connectorCode, type, installationVersion: installation.version,
        attempt: 1, outcome });
      await this.access.audit(tx, actor.id, operation.id, "connector_operation_attempted", "integration-center", "connector_operation", correlationId,
        ["connectorCode", "type", "status", "attemptCount", "failureCode"]);
      return this.safe(operation);
    });
  }

  retry(projectCode: string, operationId: string, operatorId: string, correlationId?: string) {
    return this.access.write(operatorId, [INTEGRATION_MANAGEMENT_PERMISSION], async (tx, actor) => {
      const project = await this.project(tx, projectCode);
      const current = await tx.connectorOperation.findFirst({ where: { id: operationId, projectId: project.id }, select: operationSelect });
      if (!current) throw new NotFoundException("Connector operation not found");
      if (current.type !== ConnectorOperationType.secret_reference_check || current.status !== ConnectorOperationStatus.failed) {
        throw new ConflictException("Only failed connector readiness operations can be retried");
      }
      if (current.attemptCount >= MAX_ATTEMPTS) throw new ConflictException("Connector operation retry limit reached");
      const installation = await this.installation(tx, project.id, current.connectorCode);
      const outcome = await this.checkSecret(tx, installation.secretRef);
      const operation = await this.persistAttempt(tx, { projectId: project.id, connectorCode: current.connectorCode, type: current.type,
        installationVersion: installation.version, attempt: current.attemptCount + 1, outcome, operationId: current.id });
      await this.access.audit(tx, actor.id, operation.id, "connector_operation_retried", "integration-center", "connector_operation", correlationId,
        ["connectorCode", "type", "status", "attemptCount", "failureCode"]);
      return this.safe(operation);
    });
  }

  private async checkSecret(tx: Prisma.TransactionClient, secretRef: string): Promise<{ status: ConnectorOperationStatus; failureCode: ConnectorOperationFailureCode | null }> {
    // Only a boolean crosses the SecretCenter port; provider calls and raw values are outside this local readiness operation.
    try { return await this.secrets.configuredTrusted(tx, secretRef) ? { status: ConnectorOperationStatus.succeeded, failureCode: null } :
      { status: ConnectorOperationStatus.failed, failureCode: ConnectorOperationFailureCode.secret_unavailable }; }
    catch { return { status: ConnectorOperationStatus.failed, failureCode: ConnectorOperationFailureCode.secret_unavailable }; }
  }

  private async persistAttempt(tx: Prisma.TransactionClient, input: { projectId: string; connectorCode: string; type: ConnectorOperationType;
    installationVersion: number; attempt: number; outcome: { status: ConnectorOperationStatus; failureCode: ConnectorOperationFailureCode | null }; operationId?: string }) {
    const now = new Date();
    if (!input.operationId) {
      const row = await tx.connectorOperation.create({ data: { projectId: input.projectId, connectorCode: input.connectorCode, type: input.type,
        status: input.outcome.status, attemptCount: 1, lastFailureCode: input.outcome.failureCode, installationVersion: input.installationVersion,
        startedAt: now, completedAt: now, attempts: { create: { attempt: 1, status: input.outcome.status, failureCode: input.outcome.failureCode, startedAt: now, completedAt: now } } }, select: operationSelect });
      return row;
    }
    const updated = await tx.connectorOperation.update({ where: { id: input.operationId, attemptCount: input.attempt - 1, status: ConnectorOperationStatus.failed },
      data: { status: input.outcome.status, attemptCount: input.attempt, lastFailureCode: input.outcome.failureCode,
        installationVersion: input.installationVersion, startedAt: now, completedAt: now,
        attempts: { create: { attempt: input.attempt, status: input.outcome.status, failureCode: input.outcome.failureCode, startedAt: now, completedAt: now } } }, select: operationSelect });
    return updated;
  }
}
