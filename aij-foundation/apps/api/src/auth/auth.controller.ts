import { Body, Controller, Get, Header, HttpCode, Post, Req, UseGuards, ValidationPipe, Res, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ServerResponse } from "node:http";
import { adminCookie, requireBrowserOrigin } from "./browser-session";
import { AuthService } from "./auth.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { AdminRequest } from "./auth.types";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}

  @Post("login")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  login(@Body() dto: LoginDto, @Req() request: AdminRequest) { return this.auth.login(dto, request.correlationId); }

  @Post("browser-login")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async browserLogin(@Body(new ValidationPipe({ expectedType: LoginDto, whitelist: true, forbidNonWhitelisted: true })) dto: object, @Req() request: AdminRequest, @Res({ passthrough: true }) response: ServerResponse) {
    requireBrowserOrigin(request, this.config.getOrThrow("webUrl"));
    if (request.headers["x-aij-client"] !== "web") throw new ForbiddenException("Invalid browser client");
    const result = await this.auth.login(dto as LoginDto, request.correlationId, "cookie");
    response.setHeader("Set-Cookie", adminCookie(this.config, result.accessToken));
    return { user: result.user, expiresIn: result.expiresIn };
  }

  @Get("session")
  @UseGuards(JwtAuthGuard)
  @Header("Cache-Control", "no-store")
  session(@Req() request: AdminRequest) {
    if (request.adminSession!.transport !== "cookie") throw new ForbiddenException("Browser session required");
    return { user: request.user, csrfToken: this.auth.browserCsrf(request.adminSession!) };
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Header("Cache-Control", "no-store")
  async logout(@Req() request: AdminRequest, @Res({ passthrough: true }) response: ServerResponse) {
    const result = await this.auth.logout(request.adminSession!, request.correlationId);
    if (request.adminSession!.transport === "cookie") response.setHeader("Set-Cookie", adminCookie(this.config, "", true));
    return result;
  }

  @Post("password")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Header("Cache-Control", "no-store")
  async changePassword(@Body(new ValidationPipe({ expectedType: ChangePasswordDto, whitelist: true, forbidNonWhitelisted: true })) dto: object, @Req() request: AdminRequest, @Res({ passthrough: true }) response: ServerResponse) {
    const result = await this.auth.changePassword(request.adminSession!, dto as ChangePasswordDto, request.correlationId);
    if (request.adminSession!.transport === "cookie") response.setHeader("Set-Cookie", adminCookie(this.config, "", true));
    return result;
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @Header("Cache-Control", "no-store")
  me(@Req() request: AdminRequest) { return request.user; }
}
