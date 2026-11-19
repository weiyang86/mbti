import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";

@Controller("ready")
export class ReadyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async readiness() {
    const probe = await this.prisma.readiness();
    const result = { status: probe.ready ? "ready" : "not-ready", scope: "database", reason: probe.reason, time: new Date().toISOString() };
    if (!probe.ready) throw new ServiceUnavailableException({ success: false, data: result, message: "Service is not ready" });
    return result;
  }
}
