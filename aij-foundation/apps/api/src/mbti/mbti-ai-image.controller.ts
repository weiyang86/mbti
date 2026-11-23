import { Body, Controller, Header, HttpCode, Post, UseFilters, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { Permissions } from "../common/decorators/permissions.decorator";
import { MbtiAiImageService } from "./mbti-ai-image.service";
import { MbtiErrorFilter } from "./mbti.http";

@Controller("admin/mbti/ai")
@UseFilters(MbtiErrorFilter)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions("admin.config.manage")
export class MbtiAiAdminController {
  constructor(private readonly images: MbtiAiImageService) {}

  @Post("image") @HttpCode(200) @Header("Cache-Control", "no-store")
  image(@Body() body: unknown) { return this.images.generate(body); }
}
