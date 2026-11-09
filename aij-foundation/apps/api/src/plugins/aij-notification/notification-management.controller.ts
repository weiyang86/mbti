import { Body, Controller, Get, Header, Param, Patch, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../../auth/auth.types";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { PLUGIN_MANAGEMENT_PERMISSION } from "../../../../../scripts/plugin-policy.cjs";
import { NotificationSecretChannelDto, UpdateNotificationChannelDto } from "./notification-management.dto";
import { NotificationManagementService } from "./notification-management.service";

const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("admin/notifications")
@Permissions(PLUGIN_MANAGEMENT_PERMISSION)
export class NotificationManagementController {
  constructor(private readonly notifications: NotificationManagementService) {}

  @Get("status") @Header("Cache-Control", "no-store")
  status() { return this.notifications.status(); }

  @Patch("channels/:channel") @Header("Cache-Control", "no-store")
  updateChannel(@Param(strict(NotificationSecretChannelDto)) params: object, @Body(strict(UpdateNotificationChannelDto)) body: object, @Req() request: AdminRequest) {
    const { channel } = params as NotificationSecretChannelDto;
    return this.notifications.updateChannel(channel, body as UpdateNotificationChannelDto, request.user!.id, request.correlationId);
  }
}
