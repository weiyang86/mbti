import { Body, Controller, Get, Header, Put, Req, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import { GuestRequest, MBTI_RAW, MbtiErrorFilter, MbtiGuestGuard } from "./mbti.http";
import { MbtiRadarService } from "./mbti-radar.service";

@Controller("v1/radar")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(MbtiGuestGuard)
export class MbtiRadarController {
  constructor(private readonly radar: MbtiRadarService) {}

  @Get("participation")
  @Header("Cache-Control", "no-store")
  participation(@Req() req: GuestRequest) { return this.radar.participation(req.mbtiOwnerId, req.url ?? ""); }

  @Put("participation")
  @Header("Cache-Control", "no-store")
  update(@Req() req: GuestRequest, @Body() body: unknown) { return this.radar.update(req.mbtiOwnerId, req.url ?? "", body); }

  @Get("same-type")
  @Header("Cache-Control", "no-store")
  sameType(@Req() req: GuestRequest) { return this.radar.sameType(req.mbtiOwnerId, req.url ?? ""); }
}
