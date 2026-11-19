import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Req, Res, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { GuestRequest, MBTI_RAW, MbtiErrorFilter, MbtiGuestGuard } from "./mbti.http";
import { MbtiContactsService } from "./mbti-contacts.service";

@Controller("v1")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(MbtiGuestGuard)
export class MbtiContactsController {
  constructor(private readonly contacts: MbtiContactsService) {}
  @Get("contacts/me")
  @Header("Cache-Control", "no-store")
  mine(@Req() req: GuestRequest, @Query() query: unknown) {
    this.contacts.noInput(query); return this.contacts.mine(req.mbtiOwnerId);
  }
  @Put("contacts/me")
  @Header("Cache-Control", "no-store")
  replace(@Req() req: GuestRequest, @Query() query: unknown, @Body() body: unknown) {
    this.contacts.noInput(query); return this.contacts.replace(req.mbtiOwnerId, body);
  }
  @Delete("contacts/me")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  clear(@Req() req: GuestRequest, @Query() query: unknown, @Body() body: unknown) {
    this.contacts.noInput(query, body); return this.contacts.clear(req.mbtiOwnerId);
  }
  @Get("contact-requests")
  @Header("Cache-Control", "no-store")
  list(@Req() req: GuestRequest, @Query() query: unknown) { return this.contacts.list(req.mbtiOwnerId, query); }
  @Post("contact-requests")
  @Header("Cache-Control", "no-store")
  async create(@Req() req: GuestRequest, @Query() query: unknown, @Body() body: unknown, @Res({ passthrough: true }) response: ServerResponse) {
    this.contacts.noInput(query);
    const result = await this.contacts.create(req.mbtiOwnerId, body);
    response.statusCode = result.created ? 201 : 200; return result.payload;
  }
  @Post("contact-requests/:id/respond")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  respond(@Req() req: GuestRequest, @Param("id") id: string, @Query() query: unknown, @Body() body: unknown) {
    this.contacts.noInput(query); return this.contacts.respond(req.mbtiOwnerId, id, body);
  }
  @Delete("contact-requests/:id")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  revoke(@Req() req: GuestRequest, @Param("id") id: string, @Query() query: unknown, @Body() body: unknown) {
    this.contacts.noInput(query, body); return this.contacts.revoke(req.mbtiOwnerId, id);
  }
  @Get("contact-requests/:id/granted")
  @Header("Cache-Control", "no-store")
  granted(@Req() req: GuestRequest, @Param("id") id: string, @Query() query: unknown) {
    this.contacts.noInput(query); return this.contacts.granted(req.mbtiOwnerId, id);
  }
}
