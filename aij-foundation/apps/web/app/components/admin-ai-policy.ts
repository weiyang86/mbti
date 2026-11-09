// Use the same permission owners as API guards and Seed, including the existing config namespace.
export { CONFIGURATION_PERMISSION as AI_CENTER_CONFIGURATION_PERMISSION } from "../../../../scripts/configuration-policy.cjs";
export { SECRET_PERMISSION as AI_CENTER_SECRET_PERMISSION } from "../../../../scripts/secret-policy.cjs";
export { RUNTIME_READ_PERMISSION as AI_CENTER_USAGE_PERMISSION } from "../../../../scripts/runtime-policy.cjs";
