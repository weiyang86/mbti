import { Controller, Get, Header, NotFoundException, Query, SetMetadata, UseFilters } from "@nestjs/common";
import { PluginRoute } from "../../plugin-runtime/plugin-enabled.guard";
import { MBTI_RAW, MbtiErrorFilter } from "../../mbti/mbti.http";
import { MBTI_PUBLIC_APPROVED, publicChannel } from "./mbti-config.public";

@Controller("v1/config/published")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@PluginRoute("mbti-config")
export class MbtiConfigPublicController {
  @Get()
  @Header("Cache-Control", "no-store")
  published(@Query() query: unknown): never {
    publicChannel(query); // Reject draft, version, scope, environment and repeated/arbitrary channels.
    // Deliberately has no service dependency: approval cannot accidentally expose values.
    if (!MBTI_PUBLIC_APPROVED) throw new NotFoundException("Public configuration pending approval");
    throw new NotFoundException("Public configuration unavailable");
  }
}
