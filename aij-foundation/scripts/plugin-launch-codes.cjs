"use strict";
const LAUNCH_PLUGIN_CODES = Object.freeze(["aij-ai", "aij-notification", "aij-payment", "mbti-config"]);
function assertLaunchPlugins(codes) {
  if (!Array.isArray(codes) || new Set(codes).size !== codes.length || codes.some(code => !LAUNCH_PLUGIN_CODES.includes(code))) {
    throw new Error("Plugin is not in the registered launch allowlist");
  }
}
function assertLaunchRegistryAlignment(codes) {
  if (!Array.isArray(codes) || new Set(codes).size !== codes.length ||
      [...codes].sort().join("\n") !== [...LAUNCH_PLUGIN_CODES].sort().join("\n")) {
    throw new Error("Trusted plugin registry and launch allowlist mismatch");
  }
}
module.exports = { LAUNCH_PLUGIN_CODES, assertLaunchPlugins, assertLaunchRegistryAlignment };
