import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Req, Res, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { GuestRequest, MBTI_RAW, MbtiErrorFilter, MbtiGuestGuard } from "./mbti.http";
import { MbtiSocialService } from "./mbti-social.service";

@Controller("v1")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(MbtiGuestGuard)
export class MbtiSocialController {
  constructor(private readonly social: MbtiSocialService) {}

  // Explicit static registration before cards/:id and buddies/:id.
  @Get("cards/me")
  @Header("Cache-Control", "no-store")
  me(@Req() req: GuestRequest, @Query() query: unknown) {
    this.social.noInput(query); return this.social.myCard(req.mbtiOwnerId);
  }
  @Put("cards/me")
  @Header("Cache-Control", "no-store")
  update(@Req() req: GuestRequest, @Query() query: unknown, @Body() body: unknown) {
    this.social.noInput(query); return this.social.updateCard(req.mbtiOwnerId, body);
  }
  @Get("cards/:id")
  @Header("Cache-Control", "no-store")
  card(@Req() req: GuestRequest, @Param("id") id: string, @Query() query: unknown) {
    this.social.noInput(query); return this.social.publicCard(req.mbtiOwnerId, id);
  }
  @Get("buddies")
  @Header("Cache-Control", "no-store")
  buddies(@Req() req: GuestRequest, @Query() query: unknown) { return this.social.buddies(req.mbtiOwnerId, query); }

  @Get("buddies/blocked")
  @Header("Cache-Control", "no-store")
  blocked(@Req() req: GuestRequest, @Query() query: unknown) {
    this.social.noInput(query); return this.social.blocked(req.mbtiOwnerId);
  }
  @Get("buddies/:id")
  @Header("Cache-Control", "no-store")
  buddy(@Req() req: GuestRequest, @Param("id") id: string, @Query() query: unknown) {
    this.social.noInput(query); return this.social.buddy(req.mbtiOwnerId, id);
  }
  @Post("buddies/:id/block")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  block(@Req() req: GuestRequest, @Param("id") id: string, @Query() query: unknown, @Body() body: unknown) {
    this.social.noInput(query, body); return this.social.block(req.mbtiOwnerId, id, true);
  }
  @Delete("buddies/:id/block")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  unblock(@Req() req: GuestRequest, @Param("id") id: string, @Query() query: unknown, @Body() body: unknown) {
    this.social.noInput(query, body); return this.social.block(req.mbtiOwnerId, id, false);
  }
  @Get("card-exchanges")
  @Header("Cache-Control", "no-store")
  exchanges(@Req() req: GuestRequest, @Query() query: unknown) {
    this.social.noInput(query); return this.social.exchanges(req.mbtiOwnerId);
  }
  @Post("card-exchanges")
  @Header("Cache-Control", "no-store")
  async create(@Req() req: GuestRequest, @Query() query: unknown, @Body() body: unknown, @Res({ passthrough: true }) response: ServerResponse) {
    this.social.noInput(query);
    const result = await this.social.createExchange(req.mbtiOwnerId, body);
    response.statusCode = result.created ? 201 : 200; return result.payload;
  }
  @Post("card-exchanges/:id/respond")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  respond(@Req() req: GuestRequest, @Param("id") id: string, @Query() query: unknown, @Body() body: unknown) {
    this.social.noInput(query); return this.social.respond(req.mbtiOwnerId, id, body);
  }
  @Delete("card-exchanges/:id")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  revoke(@Req() req: GuestRequest, @Param("id") id: string, @Query() query: unknown, @Body() body: unknown) {
    this.social.noInput(query, body); return this.social.revoke(req.mbtiOwnerId, id);
  }
}
