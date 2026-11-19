import { Allow, IsIn, IsInt, IsString, Max, Min } from "class-validator";

export const NOTIFICATION_SECRET_CHANNELS = ["email", "sms", "wecom", "feishu", "webhook"] as const;
export type NotificationSecretChannel = typeof NOTIFICATION_SECRET_CHANNELS[number];

export class NotificationSecretChannelDto {
  @IsString() @IsIn(NOTIFICATION_SECRET_CHANNELS) channel!: NotificationSecretChannel;
}

export class UpdateNotificationChannelDto {
  // Null explicitly clears the binding; the service rejects every non-string/non-null value.
  @Allow() secretRef!: string | null;
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
}
