import { Injectable, Optional } from "@nestjs/common";
import { ExternalServicesService } from "../configuration/external-services.service";
import { reject } from "./mbti.http";

const ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_BYTES = 12 * 1024 * 1024;
const SIZES = ["960*1280", "1024*1024", "720*1280"] as const;

export type MbtiImageRequest = {
  requestId: string;
  portrait: string;
  style: string;
  prompt: string;
  size: (typeof SIZES)[number];
  consent: true;
};

function invalid(message: string): never { reject(422, "INVALID_IMAGE_INPUT", message); }
function magic(bytes: Buffer): "jpeg" | "png" | "webp" | null {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "png";
  if (bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "webp";
  return null;
}
function imageValue(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(label + "图片格式无效");
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || match[2].length % 4 !== 0) invalid(label + "图片格式无效");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 50 || bytes.length > MAX_IMAGE_BYTES || magic(bytes) !== match[1]) invalid(label + "图片格式无效");
  return value;
}
export function parseImageRequest(input: unknown): MbtiImageRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("请求格式无效");
  const body = input as Record<string, unknown>;
  if (Object.keys(body).length !== 6 || Object.keys(body).some(key => !["requestId", "portrait", "style", "prompt", "size", "consent"].includes(key)))
    invalid("请求字段无效");
  if (typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{12,80}$/.test(body.requestId)) invalid("requestId 无效");
  if (body.consent !== true) reject(403, "IMAGE_CONSENT_REQUIRED", "请确认有权上传并使用两张图片");
  if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 1800) invalid("生成指令无效");
  if (!SIZES.includes(body.size as never)) invalid("生成尺寸无效");
  return { requestId: body.requestId, portrait: imageValue(body.portrait, "人像"), style: imageValue(body.style, "风格"),
    prompt: body.prompt, size: body.size as MbtiImageRequest["size"], consent: true };
}

function imageHost(url: URL) {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && !url.port && !url.username && !url.password &&
    (/\.oss(?:-[a-z0-9-]+)?\.aliyuncs\.com$/.test(host) || host === "cdn.wanx.aliyuncs.com" || host === "dashscope-result-bj.aliyuncs.com");
}
function endpoint(baseUrl: string | undefined) {
  if (!baseUrl) return ENDPOINT;
  let parsed!: URL;
  try { parsed = new URL(baseUrl); } catch { reject(503, "AI_IMAGE_ENDPOINT", "图像模型 Base URL 无效"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "dashscope.aliyuncs.com") {
    reject(503, "AI_IMAGE_ENDPOINT", "图像模型 Base URL 请填写 https://dashscope.aliyuncs.com");
  }
  return ENDPOINT;
}
/** wan2.x uses interleave flags; qwen-image takes plain generation parameters. */
function imageParameters(model: string, size: string) {
  if (/^wan2\./i.test(model)) return { n: 1, enable_interleave: false, size, watermark: true };
  return { n: 1, size, watermark: true };
}

@Injectable()
export class MbtiAiImageService {
  constructor(private readonly external: ExternalServicesService, @Optional() private readonly fetcher?: typeof fetch) {}

  async generate(input: unknown) {
    const request = parseImageRequest(input);
    let runtime!: { fields: Record<string, string>; credentials: Record<string, string> };
    try { runtime = await this.external.runtimeCredentials("aliyun"); }
    catch { reject(503, "AI_IMAGE_UNCONFIGURED", "请先在 AI 参数配置中完成阿里云百炼 Base URL、模型与 API Key"); }
    const apiKey = runtime.credentials.apiKey;
    if (!apiKey) reject(503, "AI_IMAGE_UNCONFIGURED", "阿里云百炼 API Key 未配置");
    const model = runtime.fields.model?.trim() || "wan2.6-image";
    if (!/^(?:wan2\.[A-Za-z0-9._-]{1,48}|qwen-image[A-Za-z0-9._-]{0,32})$/i.test(model)) {
      reject(503, "AI_IMAGE_MODEL", "请配置万相或 Qwen 图像模型，例如 wan2.6-image、qwen-image-3.0");
    }
    const url = endpoint(runtime.fields.baseUrl);
    const call = this.fetcher ?? fetch;

    let upstream!: Response;
    try {
      upstream = await call(url, { method: "POST", redirect: "error",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: { messages: [{ role: "user", content: [
          { text: request.prompt }, { image: request.portrait }, { image: request.style },
        ] }] }, parameters: imageParameters(model, request.size) }),
        signal: AbortSignal.timeout(175_000) });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) reject(504, "AI_IMAGE_TIMEOUT", "图像模型响应超时");
      reject(502, "AI_IMAGE_UPSTREAM", "图像模型暂不可用");
    }
    if (!upstream.ok) {
      if (upstream.status === 429) reject(429, "AI_IMAGE_RATE_LIMITED", "图像模型调用过于频繁，请稍后重试");
      reject(502, "AI_IMAGE_UPSTREAM", "图像模型暂不可用");
    }
    let payload!: unknown;
    try { payload = await upstream.json(); } catch { reject(502, "AI_IMAGE_UPSTREAM", "图像模型返回格式无效"); }
    const content = (payload as { output?: { choices?: { message?: { content?: { type?: string; image?: string }[] } }[] } })
      ?.output?.choices?.[0]?.message?.content;
    const link = Array.isArray(content) ? content.find(item => item?.type === "image" && typeof item.image === "string")?.image : undefined;
    if (!link) reject(502, "AI_IMAGE_UPSTREAM", "图像模型未返回图片");
    let media: URL;
    try { media = new URL(link); } catch { reject(502, "AI_IMAGE_UPSTREAM", "图像结果地址无效"); }
    if (!imageHost(media)) reject(502, "AI_IMAGE_UPSTREAM", "图像结果地址不在允许范围内");
    let download!: Response;
    try { download = await call(media.href, { method: "GET", redirect: "error", signal: AbortSignal.timeout(60_000) }); }
    catch { reject(502, "AI_IMAGE_UPSTREAM", "图像结果下载失败"); }
    if (!download.ok) reject(502, "AI_IMAGE_UPSTREAM", "图像结果下载失败");
    const bytes = Buffer.from(await download.arrayBuffer());
    const kind = magic(bytes);
    if (!kind || bytes.length > MAX_RESULT_BYTES) reject(502, "AI_IMAGE_UPSTREAM", "图像结果格式无效");
    return { contract: "mbti-image/v1", requestId: request.requestId, image: "data:image/" + kind + ";base64," + bytes.toString("base64") };
  }
}
