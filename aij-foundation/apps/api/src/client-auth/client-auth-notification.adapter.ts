import { Injectable } from "@nestjs/common";
import { readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";

export type ClientAuthNotificationDelivery = Readonly<{
  purpose?: "email_verification" | "password_reset";
  memberId: string;
  email: string;
  token: string;
  expiresAt: Date;
}>;

/**
 * G5-02/G5-03 delivery boundary. The only implementation currently available
 * is an in-memory test adapter; production remains unavailable until a
 * separately verified notification integration is wired. Tokens are never
 * persisted here.
 */
@Injectable()
export class ClientAuthNotificationAdapter {
  readonly testDeliveries: ClientAuthNotificationDelivery[] = [];
  private readonly mode: "disabled" | "test";

  constructor() {
    const environment = readApplicationEnvironment();
    const requested = environment.CLIENT_AUTH_NOTIFICATION_ADAPTER;
    if (requested !== undefined && requested !== "" && requested !== "disabled" && requested !== "test") throw new Error("Unsupported client auth notification adapter");
    if (requested === "test" && (environment.NODE_ENV === "production" || environment.APP_ENV === "production")) {
      throw new Error("Test client auth notification adapter is forbidden in production");
    }
    this.mode = requested === "test" ? "test" : "disabled";
  }

  get available(): boolean {
    return this.mode === "test";
  }

  async deliver(input: ClientAuthNotificationDelivery): Promise<"accepted" | "not_configured"> {
    if (this.mode !== "test") return "not_configured";
    this.testDeliveries.push({ ...input });
    return "accepted";
  }
}
