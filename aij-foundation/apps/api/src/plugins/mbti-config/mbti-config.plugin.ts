import { definePluginManifest } from "../../plugin-runtime/plugin-manifest";
import type { TrustedPluginRegistration } from "../../plugin-runtime/plugin-catalog";
import { MbtiConfigModule } from "./mbti-config.module";
export const mbtiConfigManifest = definePluginManifest({
  manifestVersion: 2, code: "mbti-config", name: "MBTI 配置", version: "0.1.0", coreVersionRange: "^0.1.0",
  dependencies: {}, optionalDependencies: {},
  // Reuse platform permissions; business plugin permission names await Remy's decision.
  // No lifecycle hook or initialization writes menus, accounts or grants.
  permissions: [], menus: [], frontendRoutes: [{ path: "/plugins/mbti-config/settings" }],
  configSchema: {}, migrations: [], lifecycle: {}, events: [], jobs: [], featureFlags: []
});
export const mbtiConfigRegistration: TrustedPluginRegistration = Object.freeze({ manifest: mbtiConfigManifest, module: MbtiConfigModule, owner: "@aij/api", projectIds: Object.freeze(["mbti-foundation"]) });
