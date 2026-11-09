// This list is checked against actual static Nest registrations by the delivery regression.
export const LAUNCH_PLUGIN_CODES = Object.freeze(["aij-ai", "aij-notification", "aij-payment"]);
export function assertLaunchPlugins(codes) {
  if (!Array.isArray(codes) || codes.some(code => !LAUNCH_PLUGIN_CODES.includes(code))) {
    throw new Error("Plugin is not in the registered launch allowlist");
  }
}
