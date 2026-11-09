import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class RuntimeHealthService {
  readonly startedAt = new Date();
  worker = { status: "starting", instanceId: "", lastPollAt: null as Date | null, lastError: null as string | null };
  scheduler = { status: "starting", instanceId: "", lastPollAt: null as Date | null, lastError: null as string | null };

  constructor(private readonly prisma: PrismaService) {}

  snapshot() {
    return this.prisma.readiness().then(async database => {
      if (!database.ready) return { ready: false, reason: database.reason, database: { ready: false, reason: database.reason }, worker: this.publicState(this.worker), scheduler: this.publicState(this.scheduler), queues: null, startedAt: this.startedAt };
      try {
        const [jobs, outbox] = await Promise.all([
          this.prisma.$queryRaw<Array<{ status: string; count: bigint }>>`SELECT status::text, count(*)::bigint AS count FROM runtime_job WHERE deleted_at IS NULL GROUP BY status`,
          this.prisma.$queryRaw<Array<{ status: string; count: bigint }>>`SELECT status::text, count(*)::bigint AS count FROM runtime_outbox WHERE deleted_at IS NULL GROUP BY status`
        ]);
        const counts = (rows: Array<{ status: string; count: bigint }>, allowed: string[]) => Object.fromEntries(allowed.map(status => [status, Number(rows.find(row => row.status === status)?.count ?? 0n)]));
        const worker = this.publicState(this.worker), scheduler = this.publicState(this.scheduler);
        const fresh = (state: typeof worker) => state.status === "running" && !state.hasError && !!state.lastPollAt && Date.now() - state.lastPollAt.getTime() < 30_000;
        const ready = fresh(worker) && fresh(scheduler);
        return { ready, reason: ready ? "READY" : worker.status === "disabled" ? "ASYNC_RUNTIME_DISABLED" : "ASYNC_RUNTIME_UNHEALTHY", database: { ready: true, reason: "READY" }, worker, scheduler, queues: { jobs: counts(jobs, ["pending", "retry", "running", "completed", "failed", "dead", "cancelled"]), outbox: counts(outbox, ["pending", "retry", "processing", "processed", "dead"]) }, startedAt: this.startedAt };
      } catch {
        return { ready: false, database: { ready: false, reason: "DATABASE_UNAVAILABLE" }, worker: this.publicState(this.worker), scheduler: this.publicState(this.scheduler), queues: null, startedAt: this.startedAt };
      }
    });
  }

  private publicState(state: { status: string; instanceId: string; lastPollAt: Date | null; lastError: string | null }) {
    return { status: state.status, lastPollAt: state.lastPollAt, hasError: !!state.lastError };
  }
}
