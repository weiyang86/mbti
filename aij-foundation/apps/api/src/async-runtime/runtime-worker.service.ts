import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { JobService } from "./job.service";
import { OutboxService } from "./outbox.service";
import { SchedulerService } from "./scheduler.service";
import { RuntimeHealthService } from "./runtime-health.service";
import { safeRuntimeError } from "./runtime-contracts";

@Injectable()
export class RuntimeWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly instanceId = `${process.env.HOSTNAME || "local"}:${process.pid}:${randomUUID()}`;
  private timers: NodeJS.Timeout[] = [];
  private stopping = false;
  private activePoll?: Promise<void>;
  private activeSchedule?: Promise<void>;

  constructor(private readonly outbox: OutboxService, private readonly jobs: JobService, private readonly scheduler: SchedulerService, private readonly health: RuntimeHealthService, private readonly config: ConfigService) {}

  onModuleInit() {
    if (!this.config.get<boolean>("asyncRuntimeEnabled")) {
      this.health.worker = { status: "disabled", instanceId: this.instanceId, lastPollAt: null, lastError: null };
      this.health.scheduler = { status: "disabled", instanceId: this.instanceId, lastPollAt: null, lastError: null };
      return;
    }
    this.health.worker = { status: "running", instanceId: this.instanceId, lastPollAt: null, lastError: null };
    this.health.scheduler = { status: "running", instanceId: this.instanceId, lastPollAt: null, lastError: null };
    this.timers = [setInterval(() => void this.poll(), 1000), setInterval(() => void this.schedule(), 5000)];
    this.timers.forEach((timer) => timer.unref());
  }

  async onModuleDestroy() {
    this.stopping = true;
    this.timers.forEach(clearInterval);
    await Promise.allSettled([this.activePoll, this.activeSchedule].filter((task): task is Promise<void> => !!task));
    if (this.config.get<boolean>("asyncRuntimeEnabled")) {
      this.health.worker = { ...this.health.worker, status: "stopped" };
      this.health.scheduler = { ...this.health.scheduler, status: "stopped" };
    }
  }

  async poll() {
    if (this.stopping || !this.config.get<boolean>("asyncRuntimeEnabled")) return;
    // Only a new runPoll advances the heartbeat; reentry is not worker progress.
    if (this.activePoll) return this.activePoll;
    this.activePoll = this.runPoll().finally(() => { this.activePoll = undefined; });
    return this.activePoll;
  }

  private async runPoll() {
    this.health.worker.lastPollAt = new Date();
    try {
      const events = await this.outbox.claim(this.instanceId, 1);
      for (const event of events) await this.outbox.deliver(event);
      const jobs = await this.jobs.claim(this.instanceId, 1);
      for (const job of jobs) await this.jobs.execute(job);
      this.health.worker.lastError = null;
    } catch (error) {
      this.health.worker.lastError = safeRuntimeError(error);
    }
  }

  private async schedule() {
    if (this.stopping || !this.config.get<boolean>("asyncRuntimeEnabled") || this.activeSchedule) return;
    this.activeSchedule = this.scheduler.tick(this.instanceId).finally(() => { this.activeSchedule = undefined; });
    return this.activeSchedule;
  }
}
