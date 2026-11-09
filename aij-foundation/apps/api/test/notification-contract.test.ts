import * as assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import {
  NotificationProvider,
  NotificationProviderRegistry,
  parseNotificationSecretRef,
  requireNotificationSecretRef
} from "../src/plugins/aij-notification/notification-provider";
import { renderNotificationTemplate, validateNotificationTemplate } from "../src/plugins/aij-notification/template-engine";

test("notification templates render only scalar variables and HTML escape values", () => {
  const result = renderNotificationTemplate("Hello {{user.name}}: {{task}}", { user: { name: "<Admin>" }, task: "A&B" });
  assert.equal(result.rendered, "Hello &lt;Admin&gt;: A&amp;B");
  assert.deepEqual(result.variables, ["user.name", "task"]);
});

test("notification templates reject missing, object, and secret-shaped values", () => {
  assert.throws(() => renderNotificationTemplate("{{missing}}", {}), BadRequestException);
  assert.throws(() => renderNotificationTemplate("{{value}}", { value: { nested: "object" } }), BadRequestException);
  assert.throws(() => renderNotificationTemplate("{{value}}", { value: "Bearer abc.def" }), BadRequestException);
  assert.throws(() => validateNotificationTemplate("{{credential.apiKey}}"), BadRequestException);
});

test("notification templates reject executable markup and malformed braces", () => {
  for (const value of ["{{{unsafe}}}", "<script>alert(1)</script>", "<a onclick=x>", "javascript:alert(1)", "{{value"])
    assert.throws(() => validateNotificationTemplate(value), BadRequestException);
});

test("SecretRef parsing returns only a typed reference and rejects plaintext credentials", () => {
  assert.deepEqual(parseNotificationSecretRef("env://AIJ_EMAIL_PROVIDER_KEY"), {
    ref: "env://AIJ_EMAIL_PROVIDER_KEY", provider: "env", name: "AIJ_EMAIL_PROVIDER_KEY"
  });
  assert.throws(() => parseNotificationSecretRef("plain-secret-value"), BadRequestException);
  assert.throws(() => parseNotificationSecretRef(""), ServiceUnavailableException);
});

test("in-app delivery needs no secret while external delivery fails closed without a reference", () => {
  assert.equal(requireNotificationSecretRef("in_app", null), null);
  assert.throws(() => requireNotificationSecretRef("email", undefined), ServiceUnavailableException);
  assert.equal(requireNotificationSecretRef("email", "local://aij-foundation/development/SMTP_KEY")?.ref,
    "local://aij-foundation/development/SMTP_KEY");
});

test("provider registry accepts explicit providers and rejects duplicate or missing implementations", () => {
  const provider: NotificationProvider = {
    channelType: "in_app", requiresSecretRef: false,
    async deliver() { return { providerMessageId: "fixture-only" }; }
  };
  const registry = new NotificationProviderRegistry([provider]);
  assert.equal(registry.get("in_app"), provider);
  assert.throws(() => registry.get("email"), ServiceUnavailableException);
  assert.throws(() => registry.get("unknown"), ServiceUnavailableException);
  assert.throws(() => new NotificationProviderRegistry([provider, provider]), /registration is invalid/);
});
