import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryRoot, schemaInvocation } from "../prisma-schema.mjs";

// Prisma can format the copied client schema. Ignore formatting/comments only;
// retain token boundaries and exact quoted values, including their whitespace.
export function schemaTokens(schema) {
  return [...schema.matchAll(/"(?:[^"\\]|\\.)*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|-?\d+(?:\.\d+)?|[^\s]/g)]
    .map(([token]) => token).filter((token) => !token.startsWith("//") && !token.startsWith("/*"));
}

export function assertGeneratedSchema(actual, source) {
  // The official formatter also moves block attributes after fields. Format
  // isolated copies with the actual pinned CLI; never rewrite repository input.
  const parent = resolve(repositoryRoot, ".artifacts/schema-assertions");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "format-"));
  const normalized = [actual, source].map((contents, index) => {
    const path = join(directory, index + ".prisma");
    writeFileSync(path, contents);
    const invocation = schemaInvocation(["validate"]);
    invocation.args[1] = "format";
    invocation.args.push("--schema", path);
    const result = spawnSync(invocation.command, invocation.args, invocation.options);
    assert.equal(result.status, 0, "isolated official formatter failed: " + result.stderr);
    return schemaTokens(readFileSync(path, "utf8"));
  });
  assert.deepEqual(normalized[0], normalized[1], "generated schema must retain the current officially formatted source tokens");
}

export function assertRetainedBusinessAbsent(models) {
  const inventory = readFileSync(fileURLToPath(new URL("../../docs/generated/PRISMA_MODEL_OWNERSHIP.csv", import.meta.url)), "utf8");
  const retained = new Set(inventory.split(/\r?\n/).filter((line) => line.split(",")[2] === "原库保留").map((line) => line.split(",")[0]));
  assert.equal(retained.size, 127, "F00 retained inventory changes need an explicit boundary review");
  const names = new Set(models.map((model) => model.name));
  for (const model of models) {
    for (const name of [model.name, ...model.fields.filter((field) => field.kind === "object").map((field) => field.type)]) {
      assert.ok(!retained.has(name), "retained business owner present: " + name);
      assert.doesNotMatch(name, /^Qingqi|^CompanyProfile$|^Diagnosis|^Order$|^Entitlement|^Fde|^SiteCase|^SiteGeneration/);
      assert.ok(names.has(name), "missing relation owner: " + name);
    }
  }
}

// Later verified cards added these generic reverse links. Historical owner
// suites still bound every external relation rather than accepting any new FK.
export const ownerExtensions = {
  SysUser: [["sessions", "AdminAuthSession"], ["paymentRefundRequests", "PaymentRefundRequest"], ["paymentReconciliationRuns", "PaymentReconciliationRun"], ["paymentReconciliationReviews", "PaymentReconciliationDiscrepancy"]],
  MemberUser: [["personalAiSkills", "AiPersonalSkill"], ["personalAiSkillVersions", "AiPersonalSkillVersion"], ["createdWorkspaces", "ClientWorkspace"], ["workspaceMemberships", "ClientWorkspaceMembership"], ["authoredAiKnowledgeDocuments", "AiKnowledgeDocument"], ["aiKnowledgeQuestions", "AiKnowledgeQuestion"], ["aiAgentRuns", "AiAgentRun"], ["personalAiAgents", "AiPersonalAgent"], ["personalAiAgentVersions", "AiPersonalAgentVersion"], ["personalAiMemories", "AiPersonalMemory"], ["personalWorkflows", "AiPersonalWorkflow"]],
  ProjectProfile: [["aiExecutionTraces", "AiExecutionTrace"], ["connectorInstallations", "ConnectorInstallation"], ["paymentOrders", "PaymentOrder"], ["paymentCallbackEvents", "PaymentCallbackEvent"], ["paymentRefundRequests", "PaymentRefundRequest"], ["paymentReconciliationRuns", "PaymentReconciliationRun"], ["paymentReconciliationDiscrepancies", "PaymentReconciliationDiscrepancy"]],
  SecretReference: [["connectorInstallations", "ConnectorInstallation"]]
};

export function assertOwnerExtensions(models, ownerNames) {
  for (const model of models.filter((model) => ownerNames.includes(model.name))) {
    const external = model.fields.filter((field) => field.kind === "object" && !ownerNames.includes(field.type)).map((field) => [field.name, field.type]);
    assert.deepEqual(external, ownerExtensions[model.name] ?? [], model.name + " authorized external links");
  }
}
