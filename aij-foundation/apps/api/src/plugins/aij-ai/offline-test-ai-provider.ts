import { ServiceUnavailableException } from "@nestjs/common";
import type { AiBudgetAdmissionPort, AiProvider, AiProviderRequest } from "./ai-provider";

/** Registered only by AiRuntimeModule when both test environment guards and the explicit fixture switch are active. */
export class OfflineKnowledgeTestProvider implements AiProvider {
  readonly providerCode = "offline-knowledge";
  readonly models = [{ modelCode: "synthetic-qa-v1", capabilities: ["text.generate"] as const }];

  async invoke(request: AiProviderRequest, credential: string) {
    if (typeof credential !== "string" || credential.length < 16) {
      throw new Error("synthetic offline credential unavailable");
    }
    if (request.payload.query === "synthetic provider failure") {
      throw new Error("synthetic offline provider failure");
    }
    const evidence = request.payload.evidence;
    if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > 5) {
      throw new Error("synthetic offline evidence unavailable");
    }
    const first = evidence[0] as { excerpt?: unknown };
    if (typeof first?.excerpt !== "string" || !first.excerpt.trim()) {
      throw new Error("synthetic offline evidence unavailable");
    }
    return { output: { answer: first.excerpt } };
  }
}

/** Offline tests have no external billable usage; production remains default-deny without the real budget owner. */
export class OfflineKnowledgeTestBudgetAdmission implements AiBudgetAdmissionPort {
  async assertWithinBudget(_tx: Parameters<AiBudgetAdmissionPort["assertWithinBudget"]>[0], request: Parameters<AiBudgetAdmissionPort["assertWithinBudget"]>[1]) {
    if (request.providerCode !== "offline-knowledge" || request.modelCode !== "synthetic-qa-v1") {
      throw new ServiceUnavailableException("AI budget policy is unavailable");
    }
  }
}

export function offlineKnowledgeTestMode(config: { get<T = unknown>(key: string): T | undefined }) {
  return config.get<string>("nodeEnv") === "test" &&
    config.get<string>("environment") === "test" &&
    process.env.AIJ_TEST_AI_PROVIDER_MODE === "offline-knowledge";
}
