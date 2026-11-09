import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { NotFoundException, ServiceUnavailableException } = require("@nestjs/common");
const {
  AI_CAPABILITY_CODES,
  AI_PLUGIN_CODE,
  AiBudgetExceededException,
  AiProviderRegistry,
  DisabledAiCapabilityPolicy,
  UnconfiguredAiBudgetAdmission,
  UnconfiguredAiProviderConfiguration,
  validateAiProviderResult,
  validateAiInvocation,
  validateAiProviderConfiguration
} = require("../../apps/api/dist/plugins/aij-ai/ai-provider.js");
const { AiModelExecutionService } = require("../../apps/api/dist/plugins/aij-ai/ai-execution.service.js");
const { aiPluginManifest } = require("../../apps/api/dist/plugins/aij-ai/ai-plugin.js");
const { AiRuntimeModule } = require("../../apps/api/dist/plugins/aij-ai/ai-runtime.module.js");
const { resolvePluginModules } = require("../../apps/api/dist/plugin-runtime/plugin-runtime.module.js");

function makeHarness(overrides = {}) {
  const calls = [];
  const tx = {};
  const credential = "synthetic-provider-credential";
  const provider = {
    providerCode: "fixture-provider",
    models: [{ modelCode: "fixture-model-v1", capabilities: ["text.generate"] }],
    async invoke(request, receivedCredential) {
      calls.push({ type: "provider", request, receivedCredential });
      return { output: { text: "fixture response" }, usage: { promptTokens: 3, completionTokens: 2, costAmountNanos: "120", costCurrency: "USD" } };
    }
  };
  const dependencies = {
    prisma: { async $transaction(operation, options) { calls.push({ type: "transaction", options }); return operation(tx); } },
    pluginAccess: {
      async projectId(receivedTx) { assert.equal(receivedTx, tx); calls.push({ type: "project" }); return "synthetic-project-id"; },
      async assertEnabledInTransaction(receivedTx, projectId, pluginCode) {
        assert.equal(receivedTx, tx);
        calls.push({ type: "plugin-enabled", projectId, pluginCode });
      }
    },
    capabilities: {
      async assertEnabled(receivedTx, projectId, capabilityCode) {
        assert.equal(receivedTx, tx);
        calls.push({ type: "capability", projectId, capabilityCode });
      }
    },
    configuration: {
      async resolveActive(receivedTx, projectId, capabilityCode) {
        assert.equal(receivedTx, tx);
        calls.push({ type: "configuration", projectId, capabilityCode });
        return { providerCode: "fixture-provider", modelCode: "fixture-model-v1", credentialRef: "local://aij-foundation/test/AI_PROVIDER_KEY" };
      }
    },
    budget: {
      async assertWithinBudget(receivedTx, request) {
        assert.equal(receivedTx, tx);
        calls.push({ type: "budget", request });
      }
    },
    secrets: {
      async resolveTrustedForPlugin(pluginCode, ref) {
        calls.push({ type: "secret", pluginCode, ref });
        return credential;
      }
    },
    providers: new AiProviderRegistry([provider])
  };
  dependencies.traces = {};
  dependencies.jobs = {};
  dependencies.runtimeRegistry = {};
  Object.assign(dependencies, overrides);
  return {
    calls,
    credential,
    provider,
    service: new AiModelExecutionService(
      dependencies.prisma,
      dependencies.pluginAccess,
      dependencies.jobs,
      dependencies.runtimeRegistry,
      dependencies.capabilities,
      dependencies.configuration,
      dependencies.budget,
      dependencies.secrets,
      dependencies.providers,
      dependencies.traces
    )
  };
}

const request = () => ({ capabilityCode: "text.generate", payload: { prompt: "synthetic prompt" } });

test("AI manifest is statically registered and its capability defaults to disabled", () => {
  assert.equal(aiPluginManifest.code, "aij-ai");
  assert.deepEqual(aiPluginManifest.featureFlags, [{ code: "aij-ai.text.generate", defaultEnabled: false }]);
  assert.deepEqual(resolvePluginModules([]), []);
  assert.deepEqual(resolvePluginModules([AI_PLUGIN_CODE]), [AiRuntimeModule]);
  assert.throws(() => resolvePluginModules(["unregistered-provider"]));
});

test("provider registry rejects duplicate codes, malformed models, and unknown providers", () => {
  const provider = { providerCode: "fixture-provider", models: [{ modelCode: "fixture-model-v1", capabilities: ["text.generate"] }], async invoke() { return {}; } };
  assert.throws(() => new AiProviderRegistry([provider, provider]), /registration is invalid/);
  assert.throws(() => new AiProviderRegistry([{ ...provider, models: [{ modelCode: "bad model", capabilities: ["text.generate"] }] }]), /model registration is invalid/);
  assert.throws(() => new AiProviderRegistry([{ ...provider, models: [{ modelCode: "fixture-model-v1", capabilities: ["unknown.capability"] }] }]), /model registration is invalid/);
  assert.throws(() => new AiProviderRegistry([]).get("fixture-provider"), ServiceUnavailableException);
});

test("invocation contract accepts only a supported capability and bounded JSON object", () => {
  assert.deepEqual(AI_CAPABILITY_CODES, ["text.generate"]);
  assert.deepEqual(validateAiInvocation(request()), request());
  const callerOwned = request();
  const isolated = validateAiInvocation(callerOwned);
  callerOwned.payload.prompt = "mutated after policy check";
  assert.equal(isolated.payload.prompt, "synthetic prompt");
  assert.equal(Object.isFrozen(isolated.payload), true);
  assert.throws(() => validateAiInvocation({ ...request(), providerCode: "caller-selected-module" }));
  assert.throws(() => validateAiInvocation({ capabilityCode: "text.generate", payload: [] }));
  assert.throws(() => validateAiInvocation({ capabilityCode: "text.execute-shell", payload: {} }));
  assert.throws(() => validateAiInvocation({ capabilityCode: "text.generate", payload: { prompt: "x".repeat(70 * 1024) } }));
});

test("provider configuration accepts a SecretRef but rejects plaintext and caller-supplied extra fields", () => {
  assert.deepEqual(validateAiProviderConfiguration({
    providerCode: "fixture-provider", modelCode: "fixture-model-v1", credentialRef: "local://aij-foundation/test/AI_PROVIDER_KEY"
  }), { providerCode: "fixture-provider", modelCode: "fixture-model-v1", credentialRef: "local://aij-foundation/test/AI_PROVIDER_KEY" });
  assert.throws(() => validateAiProviderConfiguration({ providerCode: "fixture-provider", modelCode: "fixture-model-v1", credentialRef: "plain-secret" }), ServiceUnavailableException);
  assert.throws(() => validateAiProviderConfiguration({ providerCode: "fixture-provider", modelCode: "fixture-model-v1", credentialRef: "local://aij-foundation/test/AI_PROVIDER_KEY", credential: "leak" }), ServiceUnavailableException);
});

test("provider receipts require bounded token counts and authoritative integer cost with currency", () => {
  assert.deepEqual(validateAiProviderResult({ output: { text: "synthetic" }, usage: { promptTokens: 3, costAmountNanos: "0", costCurrency: "USD" } }), {
    output: { text: "synthetic" }, usage: { promptTokens: 3, costAmountNanos: "0", costCurrency: "USD" }
  });
  assert.deepEqual(validateAiProviderResult({ output: null }).usage, undefined);
  assert.throws(() => validateAiProviderResult({ output: "ok", usage: { costAmountNanos: 12, costCurrency: "USD" } }), ServiceUnavailableException);
  assert.throws(() => validateAiProviderResult({ output: "ok", usage: { costAmountNanos: "100", costCurrency: "usd" } }), ServiceUnavailableException);
  assert.throws(() => validateAiProviderResult({ output: "ok", usage: { costAmountNanos: "100" } }), ServiceUnavailableException);
  assert.throws(() => validateAiProviderResult({ output: "ok", usage: { promptTokens: 2_147_483_648 } }), ServiceUnavailableException);
  assert.throws(() => validateAiProviderResult({ text: "legacy untyped response" }), ServiceUnavailableException);
});

test("unconfigured runtime policy ports fail closed", async () => {
  const tx = {};
  await assert.rejects(new DisabledAiCapabilityPolicy().assertEnabled(tx, "project", "text.generate"), ServiceUnavailableException);
  await assert.rejects(new UnconfiguredAiBudgetAdmission().assertWithinBudget(tx, {
    projectId: "project", providerCode: "fixture-provider", modelCode: "fixture-model-v1", capabilityCode: "text.generate"
  }), ServiceUnavailableException);
  await assert.rejects(new UnconfiguredAiProviderConfiguration().resolveActive(tx, "project", "text.generate"), ServiceUnavailableException);
});

test("disabled plugin rejects before configuration, SecretRef resolution, or provider invocation", async () => {
  const notEnabled = new NotFoundException("Plugin capability unavailable");
  const harness = makeHarness({
    pluginAccess: {
      async projectId() { return "synthetic-project-id"; },
      async assertEnabledInTransaction() { throw notEnabled; }
    }
  });
  await assert.rejects(harness.service.execute(request()), error => error === notEnabled);
  assert.equal(harness.calls.some(call => call.type === "configuration" || call.type === "secret" || call.type === "provider"), false);
});

test("disabled capability rejects before budget admission and credential resolution", async () => {
  const denied = new ServiceUnavailableException("AI capability is unavailable");
  const harness = makeHarness({ capabilities: { async assertEnabled() { throw denied; } } });
  await assert.rejects(harness.service.execute(request()), error => error === denied);
  assert.equal(harness.calls.some(call => call.type === "budget" || call.type === "secret" || call.type === "provider"), false);
});

test("budget rejection occurs before SecretRef resolution and provider invocation", async () => {
  const denied = new AiBudgetExceededException();
  const harness = makeHarness({ budget: { async assertWithinBudget() { throw denied; } } });
  await assert.rejects(harness.service.execute(request()), error => error === denied);
  assert.equal(harness.calls.some(call => call.type === "secret" || call.type === "provider"), false);
});

test("successful offline protocol fixture resolves the plugin-owned SecretRef only after all gates", async () => {
  const harness = makeHarness();
  assert.deepEqual(await harness.service.execute(request()), { output: { text: "fixture response" } });
  const types = harness.calls.map(call => call.type);
  assert.ok(types.indexOf("plugin-enabled") < types.indexOf("capability"));
  assert.ok(types.indexOf("capability") < types.indexOf("configuration"));
  assert.ok(types.indexOf("configuration") < types.indexOf("budget"));
  assert.ok(types.indexOf("budget") < types.indexOf("secret"));
  assert.ok(types.indexOf("secret") < types.indexOf("provider"));
  const providerCall = harness.calls.find(call => call.type === "provider");
  assert.equal(providerCall.receivedCredential, harness.credential);
  assert.equal(providerCall.request.capabilityCode, "text.generate");
  assert.equal(Object.hasOwn(providerCall.request, "credentialRef"), false);
  assert.equal(harness.calls.find(call => call.type === "secret").pluginCode, "aij-ai");
});

test("unsupported model/capability fails before credential resolution", async () => {
  const harness = makeHarness({
    configuration: { async resolveActive() { return { providerCode: "fixture-provider", modelCode: "missing-model", credentialRef: "local://aij-foundation/test/AI_PROVIDER_KEY" }; } }
  });
  await assert.rejects(harness.service.execute(request()), ServiceUnavailableException);
  assert.equal(harness.calls.some(call => call.type === "secret" || call.type === "provider"), false);
});

test("provider and secret adapter errors are sanitized before reaching callers", async () => {
  const secret = "synthetic-provider-credential";
  const failingProvider = {
    providerCode: "fixture-provider",
    models: [{ modelCode: "fixture-model-v1", capabilities: ["text.generate"] }],
    async invoke() { throw new Error(`upstream returned credential ${secret}`); }
  };
  const harness = makeHarness({ providers: new AiProviderRegistry([failingProvider]) });
  await assert.rejects(harness.service.execute(request()), error => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.equal(error.message.includes(secret), false);
    return true;
  });

  const secretError = new Error(`secret adapter failed for ${secret}`);
  const secretHarness = makeHarness({ secrets: { async resolveTrustedForPlugin() { throw secretError; } } });
  await assert.rejects(secretHarness.service.execute(request()), error => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});
