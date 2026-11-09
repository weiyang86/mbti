import { definePluginManifest } from "../../plugin-runtime/plugin-manifest";
import type { TrustedPluginRegistration } from "../../plugin-runtime/plugin-catalog";
import { AiRuntimeModule } from "./ai-runtime.module";

export const aiPluginManifest = definePluginManifest({
  manifestVersion: 2 as const,
  code: "aij-ai",
  name: "AIJ AI",
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
  featureFlags: [{ code: "aij-ai.text.generate", defaultEnabled: false }]
});

/** Static trusted registration. The host imports it only for an explicit enabled plugin code. */
export const aiPluginRegistration: TrustedPluginRegistration = Object.freeze({
  manifest: aiPluginManifest,
  module: AiRuntimeModule,
  owner: "@aij/api"
});
