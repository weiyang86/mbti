import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Patch, Post, Req, Res, UseGuards, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ServerResponse } from "node:http";
import { ClientAuthService } from "./client-auth.service";
import { ClientAuthGuard } from "./client-auth.guard";
import { clientCookieHeader, ClientRequest, expiredClientCookieHeader } from "./client-auth.security";
import { ClientConsentUpdateDto, ClientEmailVerificationConfirmDto, ClientEmailVerificationRequestDto, ClientLoginDto, ClientPasswordChangeDto, ClientPasswordResetConfirmDto, ClientPasswordResetRequestDto, ClientRegisterDto } from "./dto";

@Controller("client/auth")
export class ClientAuthController {
  constructor(private readonly auth: ClientAuthService, private readonly config: ConfigService) {}

  private assertSameOrigin(request: ClientRequest) {
    // Cookie-authenticated writes must reject cross-site requests; CORS alone is not an authorization check.
    if (request.headers.origin !== this.config.getOrThrow("webUrl") || request.headers["sec-fetch-site"] === "cross-site") throw new ForbiddenException("Invalid request origin");
  }

  @Post("register") @HttpCode(202) @Header("Cache-Control", "no-store")
  register(@Body(new ValidationPipe({ expectedType: ClientRegisterDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object, @Req() request: ClientRequest) {
    return this.auth.register(body as ClientRegisterDto, { ip: request.socket.remoteAddress || "unknown", userAgent: request.headers["user-agent"] || "unknown", correlationId: request.correlationId });
  }

  @Post("email/verification/request") @HttpCode(202) @Header("Cache-Control", "no-store")
  requestEmailVerification(@Body(new ValidationPipe({ expectedType: ClientEmailVerificationRequestDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object, @Req() request: ClientRequest) {
    return this.auth.requestEmailVerification(body as ClientEmailVerificationRequestDto, { ip: request.socket.remoteAddress || "unknown", userAgent: request.headers["user-agent"] || "unknown", correlationId: request.correlationId });
  }

  @Post("email/verification/confirm") @HttpCode(200) @Header("Cache-Control", "no-store")
  confirmEmailVerification(@Body(new ValidationPipe({ expectedType: ClientEmailVerificationConfirmDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object, @Req() request: ClientRequest) {
    return this.auth.confirmEmailVerification((body as ClientEmailVerificationConfirmDto).token, { ip: request.socket.remoteAddress || "unknown", correlationId: request.correlationId });
  }

  @Post("password/reset/request") @HttpCode(202) @Header("Cache-Control", "no-store")
  requestPasswordReset(@Body(new ValidationPipe({ expectedType: ClientPasswordResetRequestDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object, @Req() request: ClientRequest) {
    return this.auth.requestPasswordReset(body as ClientPasswordResetRequestDto, { ip: request.socket.remoteAddress || "unknown", userAgent: request.headers["user-agent"] || "unknown", correlationId: request.correlationId });
  }

  @Post("password/reset/confirm") @HttpCode(200) @Header("Cache-Control", "no-store")
  async confirmPasswordReset(@Body(new ValidationPipe({ expectedType: ClientPasswordResetConfirmDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object, @Req() request: ClientRequest, @Res({ passthrough: true }) response: ServerResponse) {
    const input = body as ClientPasswordResetConfirmDto;
    const result = await this.auth.confirmPasswordReset(input.token, input.newPassword, { ip: request.socket.remoteAddress || "unknown", correlationId: request.correlationId });
    response.setHeader("Set-Cookie", expiredClientCookieHeader(this.config.getOrThrow("clientSessionCookie"), this.config.getOrThrow("nodeEnv") === "production"));
    return result;
  }

  @Post("login") @HttpCode(200) @Header("Cache-Control", "no-store")
  async login(@Body(new ValidationPipe({ expectedType: ClientLoginDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object, @Req() request: ClientRequest, @Res({ passthrough: true }) response: ServerResponse) {
    this.assertSameOrigin(request);
    const result = await this.auth.login(body as ClientLoginDto, { ip: request.socket.remoteAddress || "unknown", userAgent: request.headers["user-agent"] || "unknown", correlationId: request.correlationId });
    response.setHeader("Set-Cookie", clientCookieHeader(this.config.getOrThrow("clientSessionCookie"), result.token, this.config.getOrThrow("nodeEnv") === "production"));
    return result.member;
  }

  @Get("me") @UseGuards(ClientAuthGuard) @Header("Cache-Control", "no-store")
  me(@Req() request: ClientRequest) { return request.client; }

  @Post("logout") @HttpCode(200) @UseGuards(ClientAuthGuard) @Header("Cache-Control", "no-store")
  async logout(@Req() request: ClientRequest, @Res({ passthrough: true }) response: ServerResponse) {
    this.assertSameOrigin(request);
    await this.auth.logoutCurrent(request.client!.id, request.clientClaims!.sessionId, request.correlationId);
    response.setHeader("Set-Cookie", expiredClientCookieHeader(this.config.getOrThrow("clientSessionCookie"), this.config.getOrThrow("nodeEnv") === "production"));
    return { signedOut: true };
  }

  @Post("sessions/revoke-all") @HttpCode(200) @UseGuards(ClientAuthGuard) @Header("Cache-Control", "no-store")
  async revokeAll(@Req() request: ClientRequest, @Res({ passthrough: true }) response: ServerResponse) {
    this.assertSameOrigin(request);
    const result = await this.auth.revokeAll(request.client!.id, request.correlationId);
    response.setHeader("Set-Cookie", expiredClientCookieHeader(this.config.getOrThrow("clientSessionCookie"), this.config.getOrThrow("nodeEnv") === "production"));
    return result;
  }

  @Patch("password") @HttpCode(200) @UseGuards(ClientAuthGuard) @Header("Cache-Control", "no-store")
  async changePassword(@Body(new ValidationPipe({ expectedType: ClientPasswordChangeDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object, @Req() request: ClientRequest, @Res({ passthrough: true }) response: ServerResponse) {
    this.assertSameOrigin(request);
    await this.auth.changePassword(request.client!.id, body as ClientPasswordChangeDto, { ip: request.socket.remoteAddress || "unknown", correlationId: request.correlationId });
    response.setHeader("Set-Cookie", expiredClientCookieHeader(this.config.getOrThrow("clientSessionCookie"), this.config.getOrThrow("nodeEnv") === "production"));
    return { changed: true };
  }

  @Get("consents") @UseGuards(ClientAuthGuard) @Header("Cache-Control", "no-store")
  getConsents(@Req() request: ClientRequest) {
    return this.auth.getConsents(request.client!.id);
  }

  @Patch("consents") @HttpCode(200) @UseGuards(ClientAuthGuard) @Header("Cache-Control", "no-store")
  updateConsent(@Body(new ValidationPipe({ expectedType: ClientConsentUpdateDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object, @Req() request: ClientRequest) {
    this.assertSameOrigin(request);
    return this.auth.updateConsent(request.client!.id, body as ClientConsentUpdateDto, request.correlationId);
  }
}
