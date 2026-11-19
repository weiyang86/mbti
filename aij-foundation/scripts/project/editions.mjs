// Configuration declarations only; API plugin registration and SecretCenter remain the owners.
const aiConfiguration = Object.freeze({
  AI_CENTER_LIVE_ENABLED: "false",
  AI_CENTER_CLIENT_EXECUTION_ENABLED: "false",
  AI_CENTER_ALLOWED_BASE_URLS: "[]",
  AI_DEEPSEEK_LIVE_ENABLED: "false",
  AI_DEEPSEEK_UPSTREAM_CONFIRMED: "false",
  AI_DEEPSEEK_DATA_CLASS: ""
});
const base = Object.freeze({ code: "base", profile: "aij-base", enabledPlugins: Object.freeze([]) });
const aiStandard = Object.freeze({ code: "ai-standard", profile: "aij-ai-standard", enabledPlugins: Object.freeze(["aij-ai"]) });

export function resolveEdition(code = "base") {
  if (code === "base") return base;
  if (code === "ai-standard") return aiStandard;
  throw new Error("Unknown project edition; select base or ai-standard");
}

export function assertEditionPlugins(edition, plugins) {
  if (!Array.isArray(plugins) || plugins.length !== edition.enabledPlugins.length ||
      plugins.some((code, index) => code !== edition.enabledPlugins[index])) {
    throw new Error("Enabled plugins must match the selected edition's trusted plugin list");
  }
}

export function projectEditionContract(edition, projectId, appEnv) {
  const ai = edition.code === "ai-standard";
  return {
    trustedDependencies: ai ? [{
      pluginCode: "aij-ai", owner: "@aij/api",
      registration: "apps/api/src/plugins/aij-ai/ai-plugin.ts",
      services: ["AsyncRuntime", "SecretCenter", "RBAC", "ClientAuth", "ClientWorkspaces", "Files"]
    }] : [],
    // Requirements describe subsequent provisioning, not an installed or running project.
    requiredCapabilities: ai ? ["auth", "clientAuth", "database"] : [],
    requiredRuntime: ai ? ["ASYNC_RUNTIME_ENABLED"] : [],
    optionalCapabilities: ai ? ["storage"] : [],
    forwardedConfiguration: ai ? { ...aiConfiguration } : {},
    secretRefVariables: ai ? ["AIJ_SECRET_" + projectId.toUpperCase().replaceAll("-", "_") + "_" + appEnv.toUpperCase() + "_AI_PROVIDER"] : []
  };
}

export function validateEditionConfiguration(contract, local) {
  for (const key of Object.keys(contract.forwardedConfiguration)) {
    const value = local[key];
    if (value === undefined) continue;
    if (key.endsWith("_ENABLED") || key === "AI_DEEPSEEK_UPSTREAM_CONFIRMED") {
      if (!["true", "false"].includes(value)) throw new Error(key + " must be true or false");
    } else if (key === "AI_DEEPSEEK_DATA_CLASS") {
      if (!["", "synthetic-or-deidentified"].includes(value)) throw new Error("AI_DEEPSEEK_DATA_CLASS requires explicit synthetic-or-deidentified classification");
    } else if (key === "AI_CENTER_ALLOWED_BASE_URLS") {
      let urls;
      try {
        urls = JSON.parse(value);
        if (!Array.isArray(urls) || urls.length > 32) throw new Error();
        for (const item of urls) {
          if (typeof item !== "string") throw new Error();
          const url = new URL(item);
          if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
        }
      } catch { throw new Error("AI_CENTER_ALLOWED_BASE_URLS must be a JSON array of HTTPS base URLs without credentials, query or fragment"); }
    }
  }
}
