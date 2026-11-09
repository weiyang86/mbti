import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { safeRuntimeError, scheduleIsDue } from "./runtime-contracts";
import { JobService } from "./job.service";
import { RuntimeRegistry, ScheduleDefinition } from "./registry";
import { RuntimeHealthService } from "./runtime-health.service";

type SchedulerLease = { schedule_code: string; last_enqueued_at: Date | null };

@Injectable()
export class SchedulerService {
  constructor(private readonly prisma: PrismaService, private readonly jobs: JobService, private readonly registry: RuntimeRegistry, private readonly health: RuntimeHealthService) {}

  async tick(instanceId: string, now = new Date()) {
    this.health.scheduler = { ...this.health.scheduler, status: "running", instanceId, lastPollAt: now, lastError: null };
    for (const definition of this.registry.scheduleDefinitions()) {
      try { await this.trySchedule(definition, instanceId, now); }
      catch (error) { this.health.scheduler.lastError = safeRuntimeError(error); }
    }
  }

  private async trySchedule(definition: ScheduleDefinition, instanceId: string, now: Date) {
    const leaseUntil = new Date(now.getTime() + 30_000);
    const rows = await this.prisma.$queryRaw<SchedulerLease[]>(Prisma.sql`
      INSERT INTO runtime_scheduler_lock (id, schedule_code, lease_owner, lease_expires_at, status, created_at, updated_at)
      VALUES (${`schedule:${definition.code}`}, ${definition.code}, ${instanceId}, ${leaseUntil}, 'active', ${now}, ${now})
      ON CONFLICT (schedule_code) DO UPDATE SET lease_owner = EXCLUDED.lease_owner,
        lease_expires_at = EXCLUDED.lease_expires_at, updated_at = EXCLUDED.updated_at
      WHERE runtime_scheduler_lock.lease_expires_at < ${now}
      RETURNING schedule_code, last_enqueued_at
    `);
    const lock = rows[0];
    if (!lock || !scheduleIsDue(definition, lock.last_enqueued_at, now)) return false;
    await this.jobs.enqueue(definition.job(now));
    await this.prisma.runtimeSchedulerLock.update({ where: { scheduleCode: definition.code }, data: { lastEnqueuedAt: now, leaseExpiresAt: now } });
    return true;
  }
}
