import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Req, Res, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { GuestRequest, MBTI_RAW, MbtiErrorFilter, MbtiGuestGuard } from "./mbti.http";
import { MbtiService } from "./mbti.service";
import { MbtiShareService } from "./mbti-share.service";

@Controller("v1")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
export class MbtiController {
  constructor(private readonly service: MbtiService, private readonly shares: MbtiShareService) {}
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

  @Post("results")
  @UseGuards(MbtiGuestGuard)
  selfSelect(@Req() req: GuestRequest, @Body() body: unknown) { return this.service.selfSelect(req.mbtiOwnerId, body); }

  // Static route must be registered before results/:id.
  @Get("results/compare")
  @UseGuards(MbtiGuestGuard)
  compare(@Req() req: GuestRequest, @Query("baseline_id") baseline: unknown, @Query("target_id") target: unknown) { return this.service.compare(req.mbtiOwnerId, baseline, target); }

  @Get("results/:id")
  @UseGuards(MbtiGuestGuard)
  @Header("Cache-Control", "no-store")
  result(@Req() req: GuestRequest, @Param("id") id: string) { return this.service.result(req.mbtiOwnerId, id); }

  @Delete("results/:id")
  @HttpCode(204)
  @UseGuards(MbtiGuestGuard)
  deleteResult(@Req() req: GuestRequest, @Param("id") id: string) { return this.service.deleteResult(req.mbtiOwnerId, id); }

  @Get("types")
  @UseGuards(MbtiGuestGuard)
  types() { return this.service.types(); }

  @Post("share/preview")
  @HttpCode(200)
  @UseGuards(MbtiGuestGuard)
  preview(@Req() req: GuestRequest, @Body() body: unknown) { return this.shares.preview(req.mbtiOwnerId, body); }

  // This capability grants access to one rendered share image, never to private files/results.
  @Get("share/assets/:filename")
  async asset(@Param("filename") filename: string, @Res() response: ServerResponse) {
    const bytes = await this.shares.asset(filename);
    response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    response.setHeader("Content-Length", bytes.length);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Disposition", "inline; filename=mbti-share.svg");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.end(bytes);
  }
}
