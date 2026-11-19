import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Controller("health")
export class HealthController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  health() {
    return {
      status: "ok",
      service: this.config.getOrThrow<string>("serviceId"),
      projectId: this.config.getOrThrow<string>("projectId"),
      namespace: this.config.getOrThrow<string>("namespace"),
      scope: "process",
      time: new Date().toISOString(),
      enabledPlugins: [],
      database: this.config.getOrThrow<{ database: boolean }>("capabilities").database ? "configured" : "not-configured"
    };
  }
}
