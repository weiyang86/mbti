import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ManagementAccessService } from "../rbac/management-access.service";
import { SecretRefPort } from "../secret-center/secret-ref";
import { assertOwnedRef, SecretIdentity } from "../secret-center/secret-ref";
import { ConfigureConnectorDto, ConnectorLifecycleAction, ConnectorLifecycleDto } from "./connector.dto";
import { connectorCatalog, requireConnectorManifest, validateGrantedScopes } from "./connector-manifest";
import { INTEGRATION_MANAGEMENT_PERMISSION } from "../../../../scripts/integration-policy.cjs";

@Injectable()
export class IntegrationCenterService {
  private readonly secretIdentity: SecretIdentity;

  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService,
    private readonly secrets: SecretRefPort, runtime: ConfigService) {
    this.secretIdentity = { projectId: runtime.getOrThrow<string>("projectId"), environment: runtime.getOrThrow<string>("environment"),
      namespace: runtime.getOrThrow<string>("namespace"), repositoryRoot: runtime.getOrThrow<string>("repositoryRoot") };
  }

  private async project(tx: Prisma.TransactionClient, code: string) {
    const project = await tx.projectProfile.findFirst({ where: { code, deletedAt: null, organization: { deletedAt: null } }, include: { organization: true } });
    if (!project) throw new NotFoundException("Project integration context unavailable");
    if (project.environment !== this.secretIdentity.environment || project.status !== "active" || project.organization.status !== "active") {
      throw new ForbiddenException("Project integration context disabled");
    }
    return project;
  }

  private async safe(row: { id: string; connectorCode: string; manifestVersion: string; scopes: string[]; secretRef: string; status: string; version: number; updatedAt: Date }, tx: Prisma.TransactionClient) {
    const manifest = requireConnectorManifest(row.connectorCode);
    return { id: row.id, connectorCode: row.connectorCode, manifestVersion: row.manifestVersion, scopes: row.scopes,
      secretRef: row.secretRef, secretConfigured: await this.secrets.configuredTrusted(tx, row.secretRef), status: row.status,
      version: row.version, updatedAt: row.updatedAt, protocol: manifest.protocol };
  }

  catalog() { return connectorCatalog().map(manifest => ({ ...manifest, scopes: [...manifest.scopes], secretProviders: [...manifest.secretProviders] })); }

  list(projectCode: string) {
    return this.access.database(() => this.prisma.$transaction(async tx => {
      const project = await this.project(tx, projectCode);
      const rows = await tx.connectorInstallation.findMany({ where: { projectId: project.id, deletedAt: null }, orderBy: [{ connectorCode: "asc" }] });
      return Promise.all(rows.filter(row => connectorCatalog().some(manifest => manifest.code === row.connectorCode)).map(row => this.safe(row, tx)));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 2000 }));
  }

  configure(projectCode: string, connectorCode: string, dto: ConfigureConnectorDto, operatorId: string, correlationId?: string) {
    // Syntax is safe to validate here; permission enforcement and all project/DB probes remain inside the guarded write.
    const parsedRef = assertOwnedRef(dto.secretRef, this.secretIdentity);
    return this.access.write(operatorId, [INTEGRATION_MANAGEMENT_PERMISSION], async (tx, actor) => {
      const project = await this.project(tx, projectCode);
      const manifest = requireConnectorManifest(connectorCode);
      if (!manifest.secretProviders.includes(parsedRef.provider)) throw new BadRequestException("Connector secret provider is not supported");
      const scopes = validateGrantedScopes(manifest, dto.scopes);
      if (!await this.secrets.configuredTrusted(tx, parsedRef.ref)) throw new BadRequestException("Configured SecretRef unavailable");

      const unique = { projectId_connectorCode: { projectId: project.id, connectorCode } };
      const before = await tx.connectorInstallation.findUnique({ where: unique });
      if (before?.deletedAt) throw new ConflictException("Connector installation is unavailable");
      const currentVersion = before?.version ?? 0;
      if (currentVersion !== dto.expectedVersion) throw new ConflictException("Connector configuration version conflict");
      const updatedAt = new Date(Math.max(Date.now(), before?.updatedAt.getTime() ? before.updatedAt.getTime() + 1 : 0));
      const data = { manifestVersion: manifest.version, scopes, secretRef: parsedRef.ref, status: before?.status === "disabled" ? "disabled" : "configured", version: currentVersion + 1, updatedAt };
      const row = before
        ? await tx.connectorInstallation.update({ where: { id: before.id, version: dto.expectedVersion }, data })
        : await tx.connectorInstallation.create({ data: { ...data, projectId: project.id, connectorCode } });
      const audit = await this.access.audit(tx, actor.id, row.id, "connector_configured", "integration-center", "connector_installation", correlationId,
        ["connectorCode", "manifestVersion", "scopes", "secretRef", "version"]);
      await tx.configurationChange.create({ data: { scope: "project", scopeId: project.id, pluginCode: connectorCode, configKey: "integration.connector",
        operatorId: actor.id, auditLogId: audit.id, eventType: "connector_configured", changeMetadata: { connectorCode, scopes, secretRefId: (await tx.secretReference.findUniqueOrThrow({ where: { ref: parsedRef.ref }, select: { id: true } })).id, version: row.version } } });
      return this.safe(row, tx);
    });
  }

  setLifecycle(projectCode: string, connectorCode: string, dto: ConnectorLifecycleDto, operatorId: string, correlationId?: string) {
    return this.access.write(operatorId, [INTEGRATION_MANAGEMENT_PERMISSION], async (tx, actor) => {
      const project = await this.project(tx, projectCode);
      const manifest = requireConnectorManifest(connectorCode);
      const unique = { projectId_connectorCode: { projectId: project.id, connectorCode } };
      const before = await tx.connectorInstallation.findUnique({ where: unique });
      if (!before || before.deletedAt) throw new NotFoundException("Connector installation unavailable");
      if (before.version !== dto.expectedVersion) throw new ConflictException("Connector configuration version conflict");

      let status: "disabled" | "enabled";
      if (dto.action === ConnectorLifecycleAction.disable) {
        if (!(["configured", "enabled"] as string[]).includes(before.status)) throw new ConflictException("Connector is not active");
        status = "disabled";
      } else {
        if (dto.action !== ConnectorLifecycleAction.enable || before.status !== "disabled") throw new ConflictException("Connector is not disabled");
        const parsedRef = assertOwnedRef(before.secretRef, this.secretIdentity);
        if (!manifest.secretProviders.includes(parsedRef.provider)) throw new ConflictException("Connector secret provider is unavailable");
        validateGrantedScopes(manifest, before.scopes);
        if (!await this.secrets.configuredTrusted(tx, parsedRef.ref)) throw new ConflictException("Connector secret reference is unavailable");
        status = "enabled";
      }

      const updatedAt = new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1));
      const row = await tx.connectorInstallation.update({
        where: { id: before.id, version: dto.expectedVersion },
        data: { status, version: { increment: 1 }, updatedAt }
      });
      const eventType = status === "disabled" ? "connector_disabled" : "connector_enabled";
      const audit = await this.access.audit(tx, actor.id, row.id, eventType, "integration-center", "connector_installation", correlationId,
        ["connectorCode", "status", "version"]);
      await tx.configurationChange.create({ data: {
        scope: "project", scopeId: project.id, pluginCode: connectorCode, configKey: "integration.connector.lifecycle",
        operatorId: actor.id, auditLogId: audit.id, eventType,
        changeMetadata: { connectorCode, previousStatus: before.status, status: row.status, version: row.version }
      } });
      return this.safe(row, tx);
    });
  }
}
