# 阿里云向量化与重排协议准备层（AF-183）

状态：内部候选实现，**默认 `configured: false`**；不是产品目录注册、CODE_VERIFIED、负责人接收或真实阿里云可用性证明。查阅日期：2026-11-06（Asia/Shanghai）。没有真实凭据、付费请求或客户数据。

## 官方依据与固定协议

以下只引用阿里云官方文档，日期为本次访问日期；页面内容会变，后续真实供应商验收须重新核对。代码的 `aliyun-native-retrieval/1` 是本地协议策略版本，不是阿里云模型快照版本；模型名均为文档列出的稳定版本名，不使用 preview/latest 别名，不声称底层权重永不变化。

| 依据（访问 2026-11-06） | 本卡采用的事实 |
| --- | --- |
| [同步向量 API](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api) | `text-embedding-v4`；北京；原生 `input.texts`、`parameters.text_type`、`dimension:1024`、`output_type:dense`；最多 10 条、单条 8192 tokens；仅取连续向量 |
| [向量 API 英文版](https://help.aliyun.com/en/model-studio/text-embedding-synchronous-api) | HTTP 响应保留 `output.embeddings`；SDK 2.0 示例将其展开为 `embeddings`，并使用 `index`，不可整段当 HTTP 响应复制 |
| [向量 API 日文官方字段参考](https://www.alibabacloud.com/help/ja/model-studio/text-embedding-synchronous-api) | 原生字段表仍列 `text_index`；本卡明确兼容 `text_index` 或 `index` 单一拼法，拒绝两者共存或批内混用；不接受 SDK 顶层展开形状 |
| [文本排序 API](https://help.aliyun.com/zh/model-studio/text-rerank-api) | `qwen3-rerank`；`input.query/documents`、`parameters.top_n/return_documents:false`；`output.results[].index/relevance_score`，得分 [0,1] 且降序；`usage.total_tokens` |
| [排序模型限制](https://help.aliyun.com/en/model-studio/rerank) | `qwen3-rerank` 最多 500 文档、每条 query/document 4000 tokens、请求 120000 tokens；请求量计算为 query tokens × 文档数 + 文档 tokens 总和 |
| [Base URL 总览](https://help.aliyun.com/en/model-studio/base-url) | 北京共享域名 `dashscope.aliyuncs.com` 仍可用；原生基路径 `/api/v1`；推荐的业务空间专属域名留给后续受控配置卡，本卡不提供任意 URL/WorkspaceId/地域切换 |
| [错误码](https://help.aliyun.com/zh/model-studio/error-code) | 401/403 鉴权或访问拒绝，429 限流/额度限制，400 参数错误，5xx 上游故障；不回显供应商 message/code/body，不自动重试 |
| [限流](https://help.aliyun.com/zh/model-studio/rate-limit) | 北京向量 v4 表列 1800 RPM/1200000 TPM，qwen3-rerank 表列 5400 RPM/5000000000 TPM；不是本卡准入承诺，实际组织额度须由原 admission owner 核实 |

固定 POST 地址：

```text
https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding
https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank
```

认证为同地域 API Key 的 `Authorization: Bearer …`，请求 `Content-Type: application/json`。host 将**已经授权并解析**的凭据作为参数传入；本卡不读环境、不解析 secretRef、不接受调用方 headers/model/CA/connect/URL，也不实现 DNS/TLS 传输。只依赖 Node 标准库。

OpenAI 兼容向量接口是另一协议：`/compatible-mode/v1/embeddings`、`input`、`dimensions`、`encoding_format`、响应 `data[].embedding/index`。本卡只实现 DashScope 原生封装，拒绝兼容接口形状；没有 DeepSeek embedding。

## 可复用接口与内存结果

`AliyunRetrievalProtocol` 接收 `request(url:string, init:RequestInit):Promise<Response>` 对象，结构与现有 `AiCenterHttpTransport` 一致。应用宿主尚未注入或注册它；原 provider、运行记录、成本真值与传输 owner 未改动。

```ts
const protocol = new AliyunRetrievalProtocol(existingTransport);
const vectors = await protocol.embed({ texts: ['synthetic text'], textType: 'document' }, authorizedCredential, signal);
// 显式读取私有内存结果；禁止直接写进公共响应、日志或持久层。
vectors.readVectors();
vectors.readUsage();
const ranks = await protocol.rerank({ query: 'synthetic query', documents: ['synthetic text'], topN: 1 }, authorizedCredential, signal);
ranks.readRanks(); // 只有原 documents 下标和得分，不返回文档原文。
```

结果使用 JS `#private` 内存字段，默认 `JSON.stringify` / Node inspect 只输出固定类型标记；显式读取的向量、下标、usage 均冻结。结果不携带请求文本、凭据、供应商 request_id 或原始 body。不是安全隔离沙箱：持有结果的可信 host 可以显式读取数值，后续 host 必须维持私有边界。

usage 仅接受安全非负整数 `total_tokens`，上限 2147483647。缺失或 `{}` 是 `{state:'unknown'}`，真实报告 0 才是 `{state:'reported',totalTokens:0}`；未知字段/类型不符拒绝。不推算 prompt/completion/cached tokens、费用、账单或结算，不生成第二套 Run/Job/Trace/cost 账本。

## 本地保守边界

| 项目 | 本地上限/策略 |
| --- | --- |
| 向量批量 | 1–4 条，每条 UTF-8 ≤2048 bytes；维度固定 1024 |
| 重排 | 1–8 篇；query ≤512 bytes、每篇 ≤2048 bytes；topN 为 1..文档数的整数 |
| 请求与响应 | 序列化请求 ≤24 KiB；编码 Content-Length 声明（若有）和解码后流累计分别 ≤256 KiB；identity 严格匹配长度；固定 10 秒截止 |
| 文本 | 字符串且非空白；普通 TAB/LF/CR 原样允许并保留，不 trim/替换/规范化；拒绝其余 Cc、Cf 格式字符、未配对代理项、稀疏数组、额外键、对象/图片/文件输入；不截断、不分块 |
| 秘密 | 拒绝文本包含本次凭据、明显 sk-/Bearer/PRIVATE KEY 字样；这是有限的拒绝策略，不是完整 DLP |
| 向量输出 | count 与请求一致；下标完整无重复、可乱序后复位；每条维度一致、元素有限实数；拒绝 sparse/token/text/额外字段 |
| 重排输出 | count 恰为 topN；原始下标唯一且在输入范围；有限得分 [0,1]、非递增；并列保持上游顺序；任何 echoed document 被拒绝 |
| 错误响应 | 仅 200 JSON；拒绝重定向、未知错误封装、未知 schema、空/截断 JSON/非法 UTF-8/超大 body，以及可观察到的 HTTP framing/解码失败；固定安全错误码，原异常无 cause |

这些 byte 上限远小于文档列出的 token 上限，是 admission 前的保守输入限制，不是供应商 tokenizer 或计费的替代。未添加调用频率准入、并发队列、host 授权或成本结算。

调用方取消会 abort 注入的请求边界，同时竞速拒绝正在等待的请求或流读取；不配合取消的边界迟到返回也不接收，迟到 body 被取消。超时同样 abort。没有隐式重试、故障切换或外部 exactly-once 声明；已到供应商的调用可能仍计费，后续 host 必须沿用原成本 owner 处理不确定结算。

## 已解码 HTTP 的长度与完整性边界（同卡修正）

原 `AiCenterHttpTransport` 直接返回 Node fetch 的 `Response`，body 已自动解压，但 `Content-Encoding` / `Content-Length` 可能仍描述编码后的响应。不能直接比较 gzip 的编码长度与解码后字节数；这是 [Fetch 标准 HTTP-network fetch](https://fetch.spec.whatwg.org/#http-network-fetch) 区分编码大小与解码大小的行为（访问 2026-11-06）。[Node 官方 fetch 文档](https://nodejs.org/api/globals.html#fetch) 说明其使用内置 Undici；实际测试版本为 Node v24.21.0 / `process.versions.undici=7.29.1`。

本协议固定接受无 Content-Encoding / `identity`，以及单个 `gzip`、`deflate`、`br`（大小写归一化）；未知、空值或逗号复合编码均拒绝。仍只使用原 fetch 解码后的流，没有自建网络、解压器、dispatcher 或依赖：

- 所有编码的 Content-Length 若存在，都必须是原有有界整数声明且 ≤256 KiB；读取后的实际解码字节始终独立累计 ≤256 KiB。没有长度声明时不声称已测得编码字节总数。
- identity 响应保留声明长度与实际解码字节严格相等的检查；gzip/deflate/br 的声明仍受上限约束，但不再错误地与解码长度比较。
- 可观察到的 HTTP framing、decoder 流错误仍安全拒绝；解码后继续完整执行 UTF-8、JSON、schema、下标、维度、count、usage 校验。不是跳过压缩正文的内容校验。
- 截断/错长度的可观察测试包括 identity/gzip 声明长度大于实发字节并关闭连接、损坏压缩数据、合法压缩但不完整 JSON。真实 fetch 均拒绝或协议解析拒绝；取消压缩流后夹具观察到服务端 socket 关闭。

**不提供独立 gzip CRC/尾部完整性证明。** 本次真实 owned HTTP 复现：完整 gzip 为 97 bytes、去掉末尾 8 bytes 后为 89 bytes，两者分别声明实际编码长度，Node fetch 都成功解出相同 85-byte 完整合法 JSON。原 `Response` 接口不暴露编码字节，无法独立检查这一尾部；这类被 Node 宽容解码的完整合法结果仍会被接受，不能报告为“截断已拒绝”。测试保留了真实接受复现，后续 Node/Undici 行为变化须重新验证。若产品要求字节级编码完整性，应另卡扩展原传输 owner 提供证据，本卡不越权新增传输或将假拒绝计为通过。

此边界由总控在 `msg_788b611ee070` 明确确认；不改变宿主授权、准入、账本、产品能力默认未配置或 I181 依赖。

## 验证与总控接入步骤

Worker 使用独立 frozen installation 和该单文件真实编译，未启动产品、数据库或 Web/API 重型构建。可复现：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec tsc apps/api/src/plugins/aij-ai/aliyun-retrieval-protocol.ts --target ES2022 --module commonjs --moduleResolution node --strict --skipLibCheck --types node --outDir .artifacts/af183/compiled --declaration
AIJ_ALIYUN_PROTOCOL_MODULE=.artifacts/af183/compiled/aliyun-retrieval-protocol.js node --test scripts/verification/aliyun-retrieval-protocol.test.mjs
pnpm exec eslint apps/api/src/plugins/aij-ai/aliyun-retrieval-protocol.ts scripts/verification/aliyun-retrieval-protocol.test.mjs scripts/verification/aliyun-retrieval-protocol-live.test.mjs --max-warnings=0
```

普通套件保留原八个顶层用例，新增排版输入与真实压缩 HTTP 回归（共 10 个顶层、15 个含子测试计数）：覆盖 embed/rerank 普通换行和制表符原样序列化、gzip/deflate/br 成功、解码后超限、编码声明超限、未知/复合编码拒绝、identity/gzip 错长度、解码/JSON 截断拒绝及取消 socket 清理，并明确记录 Node 宽容接受缺失 gzip 尾部的边界。原有 `abc\n` 拒绝样本按当前指令改为仍不安全的 `abc\v`，并非继续保留错误的换行拒绝契约。不是只有注入假响应；模块路径 override 仅供 Worker 的隔离编译，不能当作完整产品集成通过。

总控在 I181 完成后精确接入并按其独占调度执行完整构建、正式校验及以下默认 whole-API dist 测试；不要设置 Worker override：

```sh
node --test scripts/verification/aliyun-retrieval-protocol.test.mjs
node --test scripts/verification/aliyun-retrieval-protocol-live.test.mjs
```

第二个脚本为 **ROOT ONLY / Worker NOT_RUN**。它直接加载整个 API 构建产生的协议与真实 `AiCenterHttpTransport`，仅在夹具边界将已校验的固定供应商地址映射到 `127.0.0.1` 的临时端口。验证真实网络请求体、原始下标、成功/拒绝、重定向不跟随、编码声明/解码大小、429 无重试、排版保留、真实 gzip/deflate/br 成功与拒绝路径、Node 尾部宽容复现、压缩流取消后的 socket 清理，finally 关闭全部服务端连接和服务；不创建自定义 pool、临时密钥或证书，不读真实凭据，不调用阿里云。

未运行：总控完整 API types/build、原 TEXT 回归、正式全仓 lint、根 `verify:task`、上述 whole-API wire、真实供应商验收。下一卡需明确处理 host auth、secret/admission/ledger 接线、provider registration 和真实 vendor 接受路径；本卡不会因此自动启用目录或能力。人工检查应确认目录能力仍未配置、公共 API/SDK/Schema 没有新增，再检查真实源码和以上测试输出。无产品访问地址；没有应用正在运行。

## 总控最新验证

原候选NOT_RUN保留。Root已在实际wholeAPI构建、原AiCenterHttpTransport ownedHTTP和原TEXT/Job/PG回归上通过正式run-k8z7Ix，见 [AF-183执行记录](../execution/AF-183.md)。这仅是内部协议CODE_VERIFIED；configured=false及后续host/secret/admission/ledger/catalog/真实vendor门禁保持，未使产品向量检索自动可用。
