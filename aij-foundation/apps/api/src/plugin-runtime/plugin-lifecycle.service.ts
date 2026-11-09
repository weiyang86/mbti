import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { comparePluginVersions, satisfiesVersion } from "./plugin-manifest";
import { PluginCatalog } from "./plugin-catalog";
import { MAX_PLUGIN_OPERATION_ATTEMPTS, publicPluginFailureReason, safePluginFailureReason } from "./plugin-operation-policy";
import { PLUGIN_MANAGEMENT_PERMISSION } from "../../../../scripts/plugin-policy.cjs";
import { PrismaService } from "../prisma/prisma.service";
import { ManagementAccessService } from "../rbac/management-access.service";

const actions = ["install", "upgrade", "enable", "disable"] as const;
export type PluginLifecycleAction = typeof actions[number];
const validCode = (code: string) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code);

@Injectable()
export class PluginLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ManagementAccessService,
    private readonly runtime: ConfigService,
    private readonly catalog: PluginCatalog
  ) {}

  private async projectId(tx: Prisma.TransactionClient): Promise<string> {
    const projectCode = this.runtime.getOrThrow<string>("projectId") + "-" + this.runtime.getOrThrow<string>("environment");
    const project = await tx.projectProfile.findFirst({
      where: { code: projectCode, status: "active", deletedAt: null, organization: { status: "active", deletedAt: null } },
      select: { id: true }
    });
    if (!project) throw new ServiceUnavailableException("Active project context unavailable");
    return project.id;
  }

  private trusted(pluginCode: string, requestedVersion?: string) {
    if (!validCode(pluginCode)) throw new BadRequestException("Invalid plugin code");
    const registration = this.catalog.get(pluginCode);
    const version = registration.manifest.version;
    if (requestedVersion !== undefined && requestedVersion !== version) throw new BadRequestException("Requested plugin version is not in the trusted catalog");
    return registration;
  }

  private async lock(tx: Prisma.TransactionClient, projectId: string, pluginCode: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"plugin-lifecycle:" + projectId + ":" + pluginCode}))`;
  }

  private async lockMany(tx: Prisma.TransactionClient, projectId: string, pluginCodes: readonly string[]) {
    for (const code of [...new Set(pluginCodes)].sort()) await this.lock(tx, projectId, code);
  }

  private async assertRuntimeDependencies(tx: Prisma.TransactionClient, projectId: string, pluginCode: string, action: "install" | "upgrade" | "enable") {
    const manifest = this.catalog.manifest(pluginCode);
    const required = Object.entries(manifest.dependencies);
    const optional = Object.entries(manifest.optionalDependencies).filter(([code]) => this.catalog.has(code));
    const dependencyCodes = [...required, ...optional].map(([code]) => code);
    if (!dependencyCodes.length) return;
    const installed = await tx.pluginInstallation.findMany({
      where: { projectId, pluginCode: { in: dependencyCodes } },
      select: { pluginCode: true, version: true, status: true }
    });
    const byCode = new Map(installed.map(row => [row.pluginCode, row]));
    for (const [dependencyCode, range] of required) {
      const dependency = byCode.get(dependencyCode);
      const acceptableStatus = dependency && (action === "enable" ? dependency.status === "enabled" : ["installed", "enabled"].includes(dependency.status));
      if (!dependency || !acceptableStatus) throw new ConflictException(`Required plugin dependency ${dependencyCode} is not ${action === "enable" ? "enabled" : "installed"}`);
      if (!satisfiesVersion(dependency.version, range)) throw new ConflictException(`Required plugin dependency ${dependencyCode} has an incompatible installed version`);
    }
    for (const [dependencyCode, range] of optional) {
      const dependency = byCode.get(dependencyCode);
      if (dependency && !satisfiesVersion(dependency.version, range)) {
        throw new ConflictException(`Optional plugin dependency ${dependencyCode} has an incompatible installed version`);
      }
    }
  }

  private async assertNoEnabledDependents(tx: Prisma.TransactionClient, projectId: string, pluginCode: string) {
    const dependentCodes = this.catalog.dependentsOf(pluginCode).map(manifest => manifest.code);
    if (!dependentCodes.length) return;
    const enabled = await tx.pluginInstallation.findMany({
      where: { projectId, pluginCode: { in: dependentCodes }, status: "enabled" },
      select: { pluginCode: true }
    });
    if (enabled.length) throw new ConflictException(`Cannot disable a plugin while required dependents are enabled: ${enabled.map(row => row.pluginCode).sort().join(", ")}`);
  }

  private async assertUpgradeCompatibleWithDependents(tx: Prisma.TransactionClient, projectId: string, pluginCode: string, targetVersion: string) {
    const dependents = this.catalog.dependentsOf(pluginCode);
    const installed = await tx.pluginInstallation.findMany({
      where: { projectId, pluginCode: { in: dependents.map(manifest => manifest.code) }, status: { in: ["installed", "enabled"] } },
      select: { pluginCode: true }
    });
    for (const row of installed) {
      const range = this.catalog.manifest(row.pluginCode).dependencies[pluginCode];
      if (range && !satisfiesVersion(targetVersion, range)) {
        throw new ConflictException(`Upgrade would make installed dependent ${row.pluginCode} incompatible`);
      }
    }
  }

  private async operation(tx: Prisma.TransactionClient, installation: { id: string; pluginCode: string; version: string }, action: PluginLifecycleAction, owner: string, operatorId: string, at: Date, previousVersion: string | null = null) {
    await tx.pluginOperation.create({ data: {
      installationId: installation.id, action, version: installation.version, previousVersion, owner,
      status: "succeeded", operatorId, startedAt: at, finishedAt: at
    } });
  }

  private async audit(tx: Prisma.TransactionClient, operatorId: string, installationId: string, action: PluginLifecycleAction, correlationId?: string) {
    await this.access.audit(tx, operatorId, installationId, action, "plugin-runtime", "plugin-installation", correlationId, ["pluginCode", "version", "status"]);
  }

  private publicOperation(record: { id: string; installationId: string; action: string; version: string; previousVersion: string | null; retryOfOperationId: string | null; owner: string; status: string; failureReason: string | null; operatorId: string | null; startedAt: Date | null; finishedAt: Date | null; createdAt: Date }) {
    return { id: record.id, installationId: record.installationId, action: record.action, version: record.version,
      previousVersion: record.previousVersion, retryOfOperationId: record.retryOfOperationId, owner: record.owner,
      status: record.status, failureReason: publicPluginFailureReason(record.failureReason), operatorId: record.operatorId,
      startedAt: record.startedAt, finishedAt: record.finishedAt, createdAt: record.createdAt };
  }

  /** Persist a lifecycle failure as a safe category and force the installation closed. */
  recordFailure(installationId: string, action: PluginLifecycleAction, operatorId: string, cause: unknown, correlationId?: string, operationId?: string) {
    if (!actions.includes(action)) throw new BadRequestException("Unsupported plugin lifecycle action");
    if (action === "upgrade" && !operationId) throw new ConflictException("Upgrade failure requires its operation id to restore the previous version");
    return this.access.write(operatorId, [PLUGIN_MANAGEMENT_PERMISSION], async (tx, actor) => {
      const projectId = await this.projectId(tx);
      const found = await tx.pluginInstallation.findFirst({ where: { id: installationId, projectId } });
      if (!found) throw new NotFoundException("Plugin installation not found");
      await this.lock(tx, projectId, found.pluginCode);
      const current = await tx.pluginInstallation.findFirst({ where: { id: installationId, projectId } });
      if (!current) throw new NotFoundException("Plugin installation not found");
      const now = new Date();
      const failureReason = safePluginFailureReason(cause);
      let operation;
      if (operationId) {
        const foundOperation = await tx.pluginOperation.findFirst({ where: {
          id: operationId, installationId, action, status: { in: ["pending", "running", ...(action === "upgrade" ? ["succeeded" as const] : [])] }
        } });
        if (!foundOperation) throw new ConflictException("Plugin operation cannot transition to failed");
        if (action === "upgrade") {
          if (!foundOperation.previousVersion) throw new ConflictException("Upgrade operation has no recorded previous version");
          const postUpgradeState = foundOperation.status === "succeeded" && ["installed", "enabled"].includes(current.status) && current.version === foundOperation.version;
          const pendingRetryState = ["pending", "running"].includes(foundOperation.status) && current.status === "installed" && current.version === foundOperation.previousVersion;
          if (!postUpgradeState && !pendingRetryState) throw new ConflictException("Upgrade state changed before rollback");
        } else if (!["pending", "running"].includes(foundOperation.status)) {
          throw new ConflictException("Plugin operation cannot transition to failed");
        }
        operation = await tx.pluginOperation.update({ where: { id: foundOperation.id }, data: { status: "failed", failureReason, finishedAt: now } });
      } else {
        operation = await tx.pluginOperation.create({ data: {
          installationId, action, version: current.version, previousVersion: null, owner: current.owner, status: "failed", failureReason,
          operatorId: actor.id, startedAt: now, finishedAt: now
        } });
      }
      if (action === "upgrade") {
        await tx.pluginInstallation.update({ where: { id: current.id }, data: {
          version: operation.previousVersion!, status: "installed", failureReason: null,
          ...(current.status === "enabled" ? { disabledAt: now } : {})
        } });
      } else {
        await tx.pluginInstallation.update({ where: { id: current.id }, data: {
          status: "failed", failureReason, ...(current.status === "enabled" ? { disabledAt: now } : {})
        } });
      }
      await this.access.audit(tx, actor.id, operation.id, "plugin-operation-failed", "plugin-runtime", "plugin-operation", correlationId,
        ["installationId", "action", "status", "failureReason"]);
      return this.publicOperation(operation);
    });
  }

  /** Queue one explicit retry request. It records intent but does not execute plugin code or retry automatically. */
  requestRetry(installationId: string, failedOperationId: string, operatorId: string, correlationId?: string) {
    return this.access.write(operatorId, [PLUGIN_MANAGEMENT_PERMISSION], async (tx, actor) => {
      const projectId = await this.projectId(tx);
      const found = await tx.pluginInstallation.findFirst({ where: { id: installationId, projectId } });
      if (!found) throw new NotFoundException("Plugin installation not found");
      await this.lock(tx, projectId, found.pluginCode);
      const current = await tx.pluginInstallation.findFirst({ where: { id: installationId, projectId } });
      if (!current) throw new ConflictException("Only a failed plugin installation can be retried");
      const failed = await tx.pluginOperation.findFirst({ where: { id: failedOperationId, installationId, status: "failed" } });
      if (!failed || !actions.includes(failed.action as PluginLifecycleAction)) throw new NotFoundException("Failed plugin operation not found");
      const existingRetry = await tx.pluginOperation.findUnique({ where: { retryOfOperationId: failed.id } });
      if (existingRetry) {
        if (["pending", "running", "succeeded"].includes(existingRetry.status)) return this.publicOperation(existingRetry);
        throw new ConflictException("This operation retry has failed; retry the latest failed operation");
      }
      const rolledBackUpgrade = failed.action === "upgrade" && failed.previousVersion !== null &&
        current.status === "installed" && current.version === failed.previousVersion;
      if (current.status !== "failed" && !rolledBackUpgrade) throw new ConflictException("Only a failed installation or rolled-back upgrade can be retried");
      const trusted = this.catalog.get(current.pluginCode);
      if (trusted.manifest.version !== failed.version || (failed.action === "upgrade"
        ? !rolledBackUpgrade
        : trusted.manifest.version !== current.version)) {
        throw new ConflictException("Failed plugin version is no longer in the trusted catalog");
      }
      const active = await tx.pluginOperation.count({ where: { installationId, action: failed.action, status: { in: ["pending", "running"] } } });
      if (active > 0) throw new ConflictException("A retry for this plugin operation is already pending");
      const failures = await tx.pluginOperation.count({ where: { installationId, action: failed.action, status: "failed" } });
      if (failures >= MAX_PLUGIN_OPERATION_ATTEMPTS) throw new ConflictException("Plugin operation retry limit reached");
      const operation = await tx.pluginOperation.create({ data: {
        installationId, action: failed.action, version: failed.version, previousVersion: failed.previousVersion,
        retryOfOperationId: failed.id, owner: failed.owner, status: "pending", operatorId: actor.id
      } });
      await this.access.audit(tx, actor.id, operation.id, "plugin-operation-retry-requested", "plugin-runtime", "plugin-operation", correlationId,
        ["installationId", "action", "status"]);
      return this.publicOperation(operation);
    });
  }

  private write(pluginCode: string, requestedVersion: string | undefined, operatorId: string, correlationId: string | undefined,
    action: PluginLifecycleAction) {
    if (!actions.includes(action)) throw new BadRequestException("Unsupported plugin lifecycle action");
    return this.access.write(operatorId, [PLUGIN_MANAGEMENT_PERMISSION], async (tx, actor) => {
      const registration = this.trusted(pluginCode, requestedVersion);
      const projectId = await this.projectId(tx);
      const lockCodes = [pluginCode, ...Object.keys(registration.manifest.dependencies), ...Object.keys(registration.manifest.optionalDependencies)];
      if (action === "disable") lockCodes.push(...this.catalog.dependentsOf(pluginCode).map(manifest => manifest.code));
      if (action === "upgrade") lockCodes.push(...this.catalog.dependentsOf(pluginCode).map(manifest => manifest.code));
      await this.lockMany(tx, projectId, lockCodes);
      if (action !== "disable") await this.assertRuntimeDependencies(tx, projectId, pluginCode, action);
      else await this.assertNoEnabledDependents(tx, projectId, pluginCode);
      const key = { projectId_pluginCode: { projectId, pluginCode } };
      const current = await tx.pluginInstallation.findUnique({ where: key });
      const now = new Date();
      let result;
      let previousVersion: string | null = null;
      if (action === "install") {
        if (current?.status === "enabled") throw new ConflictException("Disable the plugin before reinstalling");
        if (current?.status === "installed") {
          if (current.version !== registration.manifest.version) throw new ConflictException("Use upgrade for an installed plugin version change");
          return this.public(current);
        }
        result = current
          ? await tx.pluginInstallation.update({ where: { id: current.id }, data: { version: registration.manifest.version, owner: registration.owner, status: "installed", installedAt: current.installedAt ?? now, failureReason: null } })
          : await tx.pluginInstallation.create({ data: { projectId, pluginCode, version: registration.manifest.version, owner: registration.owner, status: "installed", installedAt: now } });
      } else {
        if (!current) throw new NotFoundException("Plugin installation not found");
        if (action === "upgrade") {
          if (current.status !== "installed") throw new ConflictException("Plugin must be installed and disabled before upgrade");
          if (comparePluginVersions(registration.manifest.version, current.version) <= 0) throw new ConflictException("Upgrade must select a newer trusted version");
          await this.assertUpgradeCompatibleWithDependents(tx, projectId, pluginCode, registration.manifest.version);
          previousVersion = current.version;
          result = await tx.pluginInstallation.update({ where: { id: current.id }, data: { version: registration.manifest.version, owner: registration.owner, failureReason: null } });
        } else if (action === "enable") {
          if (current.status === "enabled") return this.public(current);
          if (current.status !== "installed") throw new ConflictException("Only an installed plugin can be enabled");
          result = await tx.pluginInstallation.update({ where: { id: current.id }, data: { status: "enabled", enabledAt: now, disabledAt: null, failureReason: null } });
        } else {
          if (current.status === "installed") return this.public(current);
          if (current.status !== "enabled") throw new ConflictException("Only an enabled plugin can be disabled");
          result = await tx.pluginInstallation.update({ where: { id: current.id }, data: { status: "installed", disabledAt: now } });
        }
      }
      await this.operation(tx, result, action, registration.owner, actor.id, now, previousVersion);
      await this.audit(tx, actor.id, result.id, action, correlationId);
      return this.public(result);
    });
  }

  private public(record: { id: string; projectId: string; pluginCode: string; version: string; owner: string; status: string; installedAt: Date | null; enabledAt: Date | null; disabledAt: Date | null; updatedAt: Date; failureReason?: string | null }) {
    return { id: record.id, projectId: record.projectId, pluginCode: record.pluginCode, version: record.version, owner: record.owner,
      status: record.status, installedAt: record.installedAt, enabledAt: record.enabledAt, disabledAt: record.disabledAt, updatedAt: record.updatedAt,
      failureReason: publicPluginFailureReason(record.failureReason ?? null) };
  }

  install(pluginCode: string, version: string, operatorId: string, correlationId?: string) { return this.write(pluginCode, version, operatorId, correlationId, "install"); }
  upgrade(pluginCode: string, version: string, operatorId: string, correlationId?: string) { return this.write(pluginCode, version, operatorId, correlationId, "upgrade"); }
  enable(pluginCode: string, operatorId: string, correlationId?: string) { return this.write(pluginCode, undefined, operatorId, correlationId, "enable"); }
  disable(pluginCode: string, operatorId: string, correlationId?: string) { return this.write(pluginCode, undefined, operatorId, correlationId, "disable"); }

  async list() {
    if (!(await this.prisma.readiness()).ready) throw new ServiceUnavailableException("Plugin management unavailable");
    try {
      return await this.prisma.$transaction(async tx => {
        const projectId = await this.projectId(tx);
        const installations = await tx.pluginInstallation.findMany({ where: { projectId }, orderBy: [{ pluginCode: "asc" }] });
        return { available: this.catalog.list(), installations: installations.map(row => this.public(row)) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 3000 });
    } catch { throw new ServiceUnavailableException("Plugin management unavailable"); }
  }

  listOperations(pluginCode: string) {
    if (!validCode(pluginCode)) throw new BadRequestException("Invalid plugin code");
    this.catalog.get(pluginCode);
    return this.access.database(() => this.prisma.$transaction(async tx => {
      const projectId = await this.projectId(tx);
      const installation = await tx.pluginInstallation.findUnique({ where: { projectId_pluginCode: { projectId, pluginCode } }, select: { id: true } });
      if (!installation) throw new NotFoundException("Plugin installation not found");
      const rows = await tx.pluginOperation.findMany({ where: { installationId: installation.id }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 });
      return rows.map(row => this.publicOperation(row));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 3000 }));
  }
}
