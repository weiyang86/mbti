import { assertLaunchRegistryAlignment } from "../../../../scripts/plugin-launch-codes.cjs";
import type { TrustedPluginRegistration } from "./plugin-catalog";
import { aiPluginRegistration } from "../plugins/aij-ai/ai-plugin";
import { notificationPluginRegistration } from "../plugins/aij-notification/notification-plugin";
import { aijPaymentPluginRegistration } from "../plugins/aij-payment/payment-plugin";

import { mbtiConfigRegistration } from "../plugins/mbti-config/mbti-config.plugin";

/** One trusted implementation catalog for loading and lifecycle management. */
export const TRUSTED_PLUGINS: ReadonlyMap<string, TrustedPluginRegistration> = new Map(
  [aiPluginRegistration, notificationPluginRegistration, aijPaymentPluginRegistration, mbtiConfigRegistration].map(p => [p.manifest.code, p])
);

assertLaunchRegistryAlignment([...TRUSTED_PLUGINS.keys()]);
