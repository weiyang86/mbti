import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const pluginCodePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Current project installation state is the runtime gate for plugin routes, jobs and secrets. */
@Injectable()
export class PluginRuntimeAccessService {
  private readonly projectCode: string;

  constructor(private readonly prisma: PrismaService, runtime: ConfigService) {
    this.projectCode = runtime.getOrThrow<string>("projectId") + "-" + runtime.getOrThrow<string>("environment");
  }

  async projectId(tx: Prisma.TransactionClient): Promise<string> {
    const project = await tx.projectProfile.findFirst({
      where: { code: this.projectCode, status: "active", deletedAt: null, organization: { status: "active", deletedAt: null } },
      select: { id: true }
    });
    if (!project) throw new ServiceUnavailableException("Plugin runtime unavailable");
    return project.id;
  }

  /** Shares the lifecycle transaction lock so disable serializes with newly entering plugin work. */
  async assertEnabledInTransaction(tx: Prisma.TransactionClient, projectId: string, pluginCode: string): Promise<void> {
    if (!pluginCodePattern.test(pluginCode)) throw new ForbiddenException("Plugin capability unavailable");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"plugin-lifecycle:" + projectId + ":" + pluginCode}))`;
    const installation = await tx.pluginInstallation.findUnique({
      where: { projectId_pluginCode: { projectId, pluginCode } },
      select: { status: true }
    });
    if (installation?.status !== "enabled") throw new NotFoundException("Plugin capability unavailable");
  }

  async isEnabled(pluginCode: string): Promise<boolean> {
    if (!pluginCodePattern.test(pluginCode)) return false;
    if (!(await this.prisma.readiness()).ready) throw new ServiceUnavailableException("Plugin runtime unavailable");
    try {
      return await this.prisma.$transaction(async tx => {
        const projectId = await this.projectId(tx);
        const installation = await tx.pluginInstallation.findUnique({
          where: { projectId_pluginCode: { projectId, pluginCode } },
          select: { status: true }
        });
        return installation?.status === "enabled";
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 2000 });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Plugin runtime unavailable");
    }
  }

  async assertEnabled(pluginCode: string): Promise<void> {
    if (!(await this.prisma.readiness()).ready) throw new ServiceUnavailableException("Plugin runtime unavailable");
    try {
      await this.prisma.$transaction(async tx => {
        const projectId = await this.projectId(tx);
        await this.assertEnabledInTransaction(tx, projectId, pluginCode);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 2000 });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Plugin runtime unavailable");
    }
  }

  async enabledCodes(): Promise<string[]> {
    if (!(await this.prisma.readiness()).ready) throw new ServiceUnavailableException("Plugin runtime unavailable");
    try {
      return await this.prisma.$transaction(async tx => {
        const projectId = await this.projectId(tx);
        const rows = await tx.pluginInstallation.findMany({ where: { projectId, status: "enabled" }, select: { pluginCode: true } });
        return rows.map(row => row.pluginCode);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 2000 });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Plugin runtime unavailable");
    }
  }
}
