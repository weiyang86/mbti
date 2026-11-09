import { definePluginManifest } from "../../plugin-runtime/plugin-manifest";
import type { TrustedPluginRegistration } from "../../plugin-runtime/plugin-catalog";
import { PaymentRuntimeModule } from "./payment-runtime.module";

export const aijPaymentPluginManifest = definePluginManifest({
  manifestVersion: 2 as const,
  code: "aij-payment",
  name: "AIJ Payment",
  version: "0.1.0",
  coreVersionRange: "^0.1.0",
  dependencies: {},
  optionalDependencies: {},
  permissions: [],
  menus: [],
  frontendRoutes: [],
  configSchema: {},
  migrations: [],
  lifecycle: {},
  events: [],
  jobs: [],
  featureFlags: []
});

/** Static host registration only; ENABLED_PLUGINS and persisted installation still gate route loading. */
export const aijPaymentPluginRegistration: TrustedPluginRegistration = Object.freeze({
  manifest: aijPaymentPluginManifest,
  module: PaymentRuntimeModule,
  owner: "@aij/api"
});
