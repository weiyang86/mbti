import { Controller, Get, Header, NotFoundException, Query, SetMetadata, UseFilters } from "@nestjs/common";
import { PluginRoute } from "../../plugin-runtime/plugin-enabled.guard";
import { MBTI_RAW, MbtiErrorFilter } from "../../mbti/mbti.http";
import { MBTI_PUBLIC_APPROVED, publicChannel } from "./mbti-config.public";
import { MbtiConfigService } from "./mbti-config.service";

@Controller("v1/config/published")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@PluginRoute("mbti-config")
export class MbtiConfigPublicController {
  constructor(private readonly config: MbtiConfigService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  published(@Query() query: unknown) {
    const channel = publicChannel(query); // Reject draft, version, scope, environment and repeated/arbitrary channels.
    if (!MBTI_PUBLIC_APPROVED) throw new NotFoundException("Public configuration pending approval");
    // Approved projection: 8 non-system categories + single-channel slice. Never env-gated.
    return this.config.publicCandidate(channel);
  }
}
