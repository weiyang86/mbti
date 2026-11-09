import { Module } from "@nestjs/common";
import { RbacModule } from "../rbac/rbac.module";
import { JobService } from "./job.service";
import { OutboxService } from "./outbox.service";
import { RuntimeAdminController } from "./runtime-admin.controller";
import { RuntimeAdminService } from "./runtime-admin.service";
import { RuntimeHealthService } from "./runtime-health.service";
import { RuntimeRegistry } from "./registry";
import { RuntimeWorkerService } from "./runtime-worker.service";
import { SchedulerService } from "./scheduler.service";
import { PluginRuntimeAccessModule } from "../plugin-runtime/plugin-runtime-access.module";

@Module({ imports: [RbacModule, PluginRuntimeAccessModule], controllers: [RuntimeAdminController], providers: [RuntimeRegistry, RuntimeHealthService, JobService, OutboxService, SchedulerService, RuntimeAdminService, RuntimeWorkerService], exports: [RuntimeRegistry, RuntimeHealthService, JobService, OutboxService] })
export class AsyncRuntimeModule {}
