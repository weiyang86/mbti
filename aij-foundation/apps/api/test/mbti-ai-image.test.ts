import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpException } from "@nestjs/common";
import { MbtiAiImageService, parseImageRequest } from "../src/mbti/mbti-ai-image.service";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(64).fill(7)]);
const data = "data:image/png;base64," + png.toString("base64");
const base = { requestId: "admin_image_0001", portrait: data, style: data, prompt: "fixed nonpersonal fixture", size: "960*1280" as const, consent: true as const };
const status = (value: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === value;

test("image request accepts exactly two verified images and rejects foreign fields", () => {
  assert.deepEqual(parseImageRequest(base), base);
  assert.throws(() => parseImageRequest({ ...base, extra: 1 }), status(422));
  assert.throws(() => parseImageRequest({ ...base, consent: false }), status(403));
  assert.throws(() => parseImageRequest({ ...base, portrait: "data:image/png;base64,AAAA" }), status(422));
  assert.throws(() => parseImageRequest({ ...base, size: "1*1" }), status(422));
  assert.throws(() => parseImageRequest({ ...base, prompt: "" }), status(422));
});

test("image service calls DashScope with the configured key and returns a verified data URL", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (init?.method === "POST") return new Response(JSON.stringify({ output: { choices: [{ message: { content: [
      { type: "text", text: "done" }, { type: "image", image: "https://dashscope-result-bj.aliyuncs.com/out.png" },
    ] } }] } }), { status: 200 });
    return new Response(png, { status: 200 });
  };
  const external = { runtimeCredentials: async () => ({ fields: { baseUrl: "https://dashscope.aliyuncs.com", model: "wan2.6-image" }, credentials: { apiKey: "sk-" + "a".repeat(40) } }) };
  const result = await new MbtiAiImageService(external as never, fetcher as typeof fetch).generate(base);
  assert.equal(result.contract, "mbti-image/v1");
  assert.equal(result.image, data);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(String(calls[0]!.init!.body)).parameters.size, "960*1280");
  assert.equal((calls[0]!.init!.headers as Record<string, string>).Authorization, "Bearer sk-" + "a".repeat(40));
});

test("image service fails closed when the provider is missing or returns a foreign host", async () => {
  const missing = { runtimeCredentials: async () => { throw new Error("unconfigured"); } };
  await assert.rejects(new MbtiAiImageService(missing as never, (async () => new Response()) as typeof fetch).generate(base), status(503));
  const foreign = async (url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
    ? new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ type: "image", image: "https://evil.example/out.png" }] } }] } }), { status: 200 })
    : new Response(png, { status: 200 });
  const external = { runtimeCredentials: async () => ({ fields: { model: "wan2.6-image" }, credentials: { apiKey: "sk-" + "a".repeat(40) } }) };
  await assert.rejects(new MbtiAiImageService(external as never, foreign as typeof fetch).generate(base), status(502));
  const wrongModel = { runtimeCredentials: async () => ({ fields: { model: "deepseek-chat" }, credentials: { apiKey: "sk-" + "a".repeat(40) } }) };
  await assert.rejects(new MbtiAiImageService(wrongModel as never, foreign as typeof fetch).generate(base), status(503));
});
