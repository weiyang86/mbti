import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Query, Req, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import { GuestRequest, MBTI_RAW, MbtiErrorFilter, MbtiGuestGuard } from "./mbti.http";
import { MbtiService } from "./mbti.service";

@Controller("v1")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
export class MbtiController {
  constructor(private readonly service: MbtiService) {}
  @Get("health")
  health() { return { status: "ok", version: "0.4.0-fastlane-candidate.1" }; }

  @Post("auth/guest")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  guest() { return this.service.guest(); }

  @Get("quiz/versions/current")
  @UseGuards(MbtiGuestGuard)
  bank() { return this.service.currentBank(); }

  @Post("quiz/sessions")
  @UseGuards(MbtiGuestGuard)
  create(@Req() req: GuestRequest, @Body() body: unknown) { return this.service.createSession(req.mbtiOwnerId, body); }

  @Put("quiz/sessions/:id/answers")
  @UseGuards(MbtiGuestGuard)
  answers(@Req() req: GuestRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.saveAnswers(req.mbtiOwnerId, id, body); }

  // The candidate OpenAPI requires 201 for the winning submit and 409 for a replay.
  @Post("quiz/sessions/:id/submit")
  @UseGuards(MbtiGuestGuard)
  submit(@Req() req: GuestRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.submit(req.mbtiOwnerId, id, body); }

  @Get("results")
  @UseGuards(MbtiGuestGuard)
  @Header("Cache-Control", "no-store")
  results(@Req() req: GuestRequest, @Query("limit") limit?: string, @Query("cursor") cursor?: string) { return this.service.results(req.mbtiOwnerId, limit, cursor); }

  @Get("results/:id")
  @UseGuards(MbtiGuestGuard)
  @Header("Cache-Control", "no-store")
  result(@Req() req: GuestRequest, @Param("id") id: string) { return this.service.result(req.mbtiOwnerId, id); }
}
