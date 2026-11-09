import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { ParsedSecretRef, parseSecretRef } from "../../secret-center/secret-ref";

export const NOTIFICATION_CHANNEL_TYPES = ["in_app", "email", "sms", "wecom", "feishu", "webhook"] as const;
export type NotificationChannelType = typeof NOTIFICATION_CHANNEL_TYPES[number];

export type NotificationDeliveryContext = Readonly<{
  projectId: string;
  messageId: string;
  recipientId: string;
  recipientAddress?: string;
  title: string;
  body: string;
  contentType: "text" | "html";
  attemptNo: number;
  idempotencyKey: string;
  correlationId?: string;
}>;

export type NotificationDeliveryReceipt = Readonly<{ providerMessageId: string }>;

/** Provider boundary: credential resolution stays in the service-side SecretRef owner. */
export interface NotificationProvider {
  readonly channelType: NotificationChannelType;
  readonly requiresSecretRef: boolean;
  deliver(context: NotificationDeliveryContext): Promise<NotificationDeliveryReceipt>;
}

/** A catalog entry is code, never a user-supplied module path or executable environment script. */
export class NotificationProviderRegistry {
  private readonly providers = new Map<NotificationChannelType, NotificationProvider>();

  constructor(providers: readonly NotificationProvider[]) {
    for (const provider of providers) this.register(provider);
  }

  /** Trusted host modules may register implementations at bootstrap; callers cannot add provider code. */
  register(provider: NotificationProvider): void {
    if (!provider || !NOTIFICATION_CHANNEL_TYPES.includes(provider.channelType) || this.providers.has(provider.channelType) ||
        provider.requiresSecretRef !== (provider.channelType !== "in_app") || typeof provider.deliver !== "function") {
      throw new Error("Notification provider registration is invalid");
    }
    this.providers.set(provider.channelType, provider);
  }

  get(channelType: string): NotificationProvider {
    if (!NOTIFICATION_CHANNEL_TYPES.includes(channelType as NotificationChannelType)) {
      throw new ServiceUnavailableException("Notification channel is unavailable");
    }
    const provider = this.providers.get(channelType as NotificationChannelType);
    if (!provider) throw new ServiceUnavailableException("Notification channel is unavailable");
    return provider;
  }
}

/** Validate a reference only; this function never reads or returns the referenced secret value. */
export function parseNotificationSecretRef(input: unknown): ParsedSecretRef {
  if (typeof input !== "string" || input.trim() === "") throw new ServiceUnavailableException("Notification channel credentials are unavailable");
  try {
    return parseSecretRef(input);
  } catch {
    throw new BadRequestException("Notification credential must be a valid SecretRef");
  }
}

/** Reject an external channel before delivery if no server-side reference is configured. */
export function requireNotificationSecretRef(channelType: NotificationChannelType, secretRef: unknown): ParsedSecretRef | null {
  const providerRequiresSecret = channelType !== "in_app";
  if (!providerRequiresSecret) return null;
  return parseNotificationSecretRef(secretRef);
}
