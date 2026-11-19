const failureCodes = new Set([
  "PLUGIN_OPERATION_FAILED",
  "PLUGIN_TIMEOUT",
  "PLUGIN_ABORTED",
  "PLUGIN_DEPENDENCY_UNAVAILABLE",
  "PLUGIN_VALIDATION_FAILED"
]);

export const MAX_PLUGIN_OPERATION_ATTEMPTS = 3;

/** Persist only stable, non-sensitive categories; never store provider messages or stacks. */
export function safePluginFailureReason(cause: unknown): string {
  try {
    if (cause && typeof cause === "object") {
      const candidate = cause as { code?: unknown; name?: unknown };
      if (typeof candidate.code === "string" && failureCodes.has(candidate.code)) return candidate.code;
      if (candidate.name === "TimeoutError") return "PLUGIN_TIMEOUT";
      if (candidate.name === "AbortError") return "PLUGIN_ABORTED";
    }
  } catch {
    // Malformed error objects still map to the generic safe category.
  }
  return "PLUGIN_OPERATION_FAILED";
}

export function publicPluginFailureReason(value: string | null): string | null {
  if (value === null) return null;
  return failureCodes.has(value) ? value : "PLUGIN_OPERATION_FAILED";
}
