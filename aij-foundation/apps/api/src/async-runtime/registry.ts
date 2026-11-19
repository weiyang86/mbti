import { BadRequestException, Injectable } from "@nestjs/common";
import type { RuntimeEvent, RuntimeJobInput } from "@aij/runtime-contracts";

export type EventHandler = (event: RuntimeEvent, tx: unknown) => Promise<void>;
export type JobHandler = (
  job: { id: string; payload: unknown; correlationId?: string; idempotencyKey: string; attempt?: number; maxAttempts?: number; leaseOwner?: string; leaseNonce?: string; signal: AbortSignal },
  tx: unknown
) => Promise<{ resultReference?: unknown } | void>;
export type JobRegistration = {
  handler: JobHandler;
  executionMode: "transactional" | "orchestrated";
};
export type ScheduleDefinition = {
  code: string;
  intervalMs?: number;
  cron?: string;
  job: (now: Date) => RuntimeJobInput;
};

@Injectable()
export class RuntimeRegistry {
  private readonly eventHandlers = new Map<string, EventHandler>();
  private readonly jobHandlers = new Map<string, JobRegistration>();
  private readonly declaredJobs = new Set<string>();
  private readonly schedules = new Map<string, ScheduleDefinition>();

  registerEvent(type: string, version: number, handler: EventHandler) {
    this.register(this.eventHandlers, `${type}@${version}`, handler);
  }
  registeredEventDefinitions() {
    return [...this.eventHandlers.keys()].map((key) => {
      const separator = key.lastIndexOf("@");
      return { type: key.slice(0, separator), version: Number(key.slice(separator + 1)) };
    });
  }
  registerJob(type: string, version: number, handler: JobHandler) {
    this.declaredJobs.add(`${type}@${version}`);
    this.register(this.jobHandlers, `${type}@${version}`, { handler, executionMode: "transactional" });
  }
  registerOrchestratedJob(type: string, version: number, handler: JobHandler) {
    this.declaredJobs.add(`${type}@${version}`);
    this.register(this.jobHandlers, `${type}@${version}`, { handler, executionMode: "orchestrated" });
  }
  declareJob(type: string, version: number) {
    this.declaredJobs.add(`${type}@${version}`);
  }
  registerSchedule(definition: ScheduleDefinition) {
    this.register(this.schedules, definition.code, definition);
  }
  event(type: string, version: number) {
    return this.required(this.eventHandlers, `${type}@${version}`, "event consumer");
  }
  job(type: string, version: number) {
    return this.jobRegistration(type, version).handler;
  }
  jobRegistration(type: string, version: number) {
    return this.required(this.jobHandlers, `${type}@${version}`, "job handler");
  }
  assertJobDeclared(type: string, version: number) {
    this.required(this.declaredJobs, `${type}@${version}`, "job declaration");
  }
  registeredJobDefinitions() {
    return [...this.jobHandlers.keys()].map((key) => {
      const separator = key.lastIndexOf("@");
      return { type: key.slice(0, separator), version: Number(key.slice(separator + 1)) };
    });
  }
  scheduleDefinitions() {
    return [...this.schedules.values()];
  }

  private register<T>(registry: Map<string, T>, key: string, value: T) {
    if (registry.has(key)) throw new BadRequestException(`duplicate runtime registration: ${key}`);
    registry.set(key, value);
  }
  private required<T>(registry: Map<string, T>, key: string, kind: string): T;
  private required(registry: Set<string>, key: string, kind: string): void;
  private required<T>(registry: Map<string, T> | Set<string>, key: string, kind: string): T | void {
    if (registry instanceof Set) {
      if (!registry.has(key)) throw new BadRequestException(`${kind} is not allowlisted: ${key}`);
      return;
    }
    const value = registry.get(key);
    if (!value) throw new BadRequestException(`${kind} is not allowlisted: ${key}`);
    return value;
  }
}
