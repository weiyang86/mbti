import { definePluginManifest } from "../../plugin-runtime/plugin-manifest";
import type { TrustedPluginRegistration } from "../../plugin-runtime/plugin-catalog";
import { NotificationRuntimeModule } from "./notification-runtime.module";

export const notificationPluginManifest = definePluginManifest({
  manifestVersion: 2 as const,
  code: "aij-notification",
  name: "AIJ Notification",
  version: "0.1.0",
  coreVersionRange: "^0.1.0",
  dependencies: {}, optionalDependencies: {}, permissions: [], menus: [], frontendRoutes: [], configSchema: {}, migrations: [],
  lifecycle: {}, events: ["aij-notification.delivery.requested"], jobs: ["aij-notification.deliver"], featureFlags: []
});

/** Trusted static host registration. Runtime import remains opt-in through ENABLED_PLUGINS. */
export const notificationPluginRegistration: TrustedPluginRegistration = Object.freeze({
  manifest: notificationPluginManifest,
  module: NotificationRuntimeModule,
  owner: "@aij/api"
});
