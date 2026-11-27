import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LocalSecretStoreAdapter } from "../src/secret-center/secret-adapter";
import { LocalSecretStoreWriter } from "../src/secret-center/secret-store-writer";
import { parseSecretRef, type SecretIdentity } from "../src/secret-center/secret-ref";

test("local secret writer encrypts values, merges keys and never needs a pre-existing file", async () => {
  const root = mkdtempSync(join(tmpdir(), "mbti-secret-"));
  const previousFile = process.env.AIJ_SECRET_STORE_FILE, previousKey = process.env.AIJ_SECRET_STORE_KEY;
  process.env.AIJ_SECRET_STORE_KEY = randomBytes(32).toString("hex");
  delete process.env.AIJ_SECRET_STORE_FILE;
  const identity: SecretIdentity = { projectId: "mbti-foundation", environment: "development",
    namespace: "mbti-foundation:development", repositoryRoot: root };
  const writer = new LocalSecretStoreWriter(identity), reader = new LocalSecretStoreAdapter(identity);
  try {
    const first = "sk-" + "a".repeat(40), second = "sk-" + "b".repeat(40);
    await writer.write("MBTI_AI_DEEPSEEK_API_KEY", first);
    assert.equal(await reader.resolve(parseSecretRef("local://mbti-foundation/development/MBTI_AI_DEEPSEEK_API_KEY")), first);
    await writer.write("MBTI_AI_ALIYUN_API_KEY", second);
    assert.equal(await reader.resolve(parseSecretRef("local://mbti-foundation/development/MBTI_AI_ALIYUN_API_KEY")), second);
    assert.equal(await reader.resolve(parseSecretRef("local://mbti-foundation/development/MBTI_AI_DEEPSEEK_API_KEY")), first);
    await writer.write("MBTI_AI_DEEPSEEK_API_KEY", second);
    assert.equal(await reader.resolve(parseSecretRef("local://mbti-foundation/development/MBTI_AI_DEEPSEEK_API_KEY")), second);
  } finally {
    if (previousFile === undefined) delete process.env.AIJ_SECRET_STORE_FILE; else process.env.AIJ_SECRET_STORE_FILE = previousFile;
    if (previousKey === undefined) delete process.env.AIJ_SECRET_STORE_KEY; else process.env.AIJ_SECRET_STORE_KEY = previousKey;
    rmSync(root, { recursive: true, force: true });
  }
});
