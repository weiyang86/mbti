# 受限 Knowledge HTTPS Web Reader（AF-171 候选）

## 范围与调用

实现位于 `apps/api/src/plugins/aij-ai/knowledge-web-reader.ts`。直接导出的 `knowledgeWebReader` 使用真实 Node DNS、HTTPS、TLS；没有运行时环境绕过开关，没有新依赖。当前尚未接入 Knowledge URL 导入/更新接口、数据库、发布、解析、embedding、SDK 或页面，也没有启动可访问的应用地址。

```ts
import { knowledgeWebReader } from './knowledge-web-reader';
const result = await knowledgeWebReader.read(serverAuthorizedUrl, {
  signal: serverAbortController.signal,
  // cache: serverLoadedExistingResourceMetadata,
});
```

上游 owner 必须先认证并授权 URL 导入及租户访问；本适配器只负责有界读取。`signal` 和 `cache` 由服务端产生，不能直接转发 HTTP body/上传源中的配置。缓存上下文须来自已存在的、经校验资源，只包含 canonical `sourceUrl`、SHA-256 `checksum`、`contentType` 及至少一个有效 validator；不接收旧正文。`fetched` 返回原始 bytes、严格 UTF-8 text、字节数、最终 canonical URL、类型、SHA-256 和可选 validator；这些值都属于不可信来源数据，不得进入日志/错误/验收输出。`not-modified` 仅返回相同资源的缓存元数据，不带正文/bytes。上层在授权作用域内决定是否继续使用自己已持有的正文。

返回的 HTML 仅为原始数据，不执行脚本、指令、工具或 prompt，不提供可信 HTML 渲染；消费者不得直接通过 `innerHTML` 或等价机制显示。后续 Knowledge owner 应另行完成解析、净化、内容审核、幂等更新及持久化。

## 固定策略

- URL：WHATWG HTTPS，原始与 canonical 长度均至多 2048；只接受 ASCII DNS authority（可接受有效 punycode），至少两段、合法标签、默认 443（可显式 `:443`）。拒绝账户、空账户、片段、空/非标准端口、反斜杠、空白/控制字符、无效 percent 编码/UTF-8 编码、IP 字面量及数字/十六进制/八进制 IPv4 变体、local/internal/test/invalid/metadata 等保留域标签及 example 域。
- 每一跳并发解析全部 A/AAAA；DNS 至多 2 秒，任一查询错误（除 ENODATA）、空集或超过 64 个答案即拒绝。所有答案必须属于 native public global 类；混合公私答案整体拒绝。保守排除全部 IANA special-purpose IPv4 分配、IPv4 multicast/reserved；IPv6 只允许 `2000::/3` 中非 special-purpose 的 native global unicast，并排除 ISATAP。私网、回环、链路/站点本地、CGNAT、文档、未指定、多播、NAT64、mapped/compatible、Teredo、6to4、ORCHID、保留/特殊服务均不放行。该分类不声称测量实时 Internet 路由可达性，且会保守拒绝部分特殊公网服务。
- 选中第一个已通过的地址，通过实际 `tls.connect` 的固定 `lookup` 连接；不会重新 unrestricted DNS 解析或失败后回退。每次请求使用独立 Agent，不复用连接/TLS session；保留原 hostname/SNI、标准 CA 与 `checkServerIdentity`，显式 `rejectUnauthorized: true`；直接 TLS 不使用代理或调用方认证。
- 请求仅有固定 Accept、User-Agent、identity encoding 与同资源条件 validator；Node 自动生成 Host/Connection。没有 Authorization/Cookie/forwarded/session 自定义入口。重定向仅支持 301/302/303/307/308，最多 3 次，每跳重新 URL 校验、全量 DNS 校验和 pin；不转发前一资源的条件 validator 到其他 URL，拒绝 HTTP 降级/账户/私网目标。
- 总 deadline 15 秒（单调时钟复检），完整响应头 5 秒，正文 idle 3 秒；支持外部取消。DNS 查询取消，所有路径清理 timer/abort listener/socket/Agent；销毁前后保留必要 error listener 吸收异步错误，再于 close 移除。
- 头部至多 16 KiB/100 对，关键头不得重复。仅 200 正文成功，304 必须有该 exact canonical URL 的有效 cache 上下文；304 validator 不能与所使用的旧 validator 冲突（ETag 使用 weak comparison）。其他状态/信息响应/upgrade 拒绝，不读取失败正文。
- 只接受 `text/plain` 或 `text/html`，charset 可省略或仅 `utf-8`（可带双引号）；任何非 identity Content-Encoding 拒绝，不解压。正文实际流式计数至多 1 MiB；Content-Length 只用于提前拒绝和完整性核验，不替代实际计数。严格 UTF-8，拒绝 BOM、NUL/不允许的 ASCII 控制字符、空白正文、畸形/截断正文。
- 不记录任何内容、URL query、凭据、原始头或异常 cause；外部仅能拿到固定的 `KnowledgeWebReaderError.code`。运营计数可记录成功/拒绝次数，不序列化 result 或外部错误。

`new KnowledgeWebReader(trustedDependencies)` 是仅供可信 composition/test 的窄 seam：resolver、TLS connector 及只能缩短的 timeout。构造时捕获函数并冻结 timeout/instance；`read()` 不读取任何传输/认证/策略字段。测试 connector 可以在测试进程内映射到自有夹具，不能作为产品 API 配置、上传数据、私网 allowlist 或“默认 pin 已证实”的替代品。生产 singleton 不使用这些 seam。

## 验证与总控接收

Worker 已运行编译后的单文件实现测试，测试通过真实 Node HTTP parser + 内存 Duplex 传递数据；没有建立真实 TLS/网络连接。单元测试的 seam 不等同网络证明。详细命令、失败修复和边界见 `docs/execution/AF-171-candidate.md`。

总控在自己的已核验安装中执行（仅编译此文件不需要 DB/应用构建）：

```sh
pnpm exec tsc apps/api/src/plugins/aij-ai/knowledge-web-reader.ts --target es2022 --module commonjs --strict --esModuleInterop --skipLibCheck --types node --outDir .artifacts/af171/compiled
AF171_COMPILED_READER=.artifacts/af171/compiled/knowledge-web-reader.js node --test scripts/verification/knowledge-web-reader.test.mjs
AF171_COMPILED_READER=.artifacts/af171/compiled/knowledge-web-reader.js node --test scripts/verification/knowledge-web-reader-live.test.mjs
```

`AF171_COMPILED_READER` 只选择测试加载的编译产物路径，不是生产开关。根总控独占的 live 脚本在 Worker 阶段 **NOT_RUN**，只完成 syntax/lint 检查：它创建自有随机 loopback UDP DNS 与 HTTPS 端口、短效测试证书，结束后删除证书/私钥和关闭监听；不会访问真实外部服务。它分别证明：默认导出读取器实际 DNS 收到私网结果即拒绝且无 TCP；默认 TLS connector 把已批准 IP 送到 socket lookup（syscall 边界人工拒连，无外连）；保持默认 CA/SNI 的自有 socket 映射产生 self-signed 拒绝；仅可信测试 constructor 映射/添加测试 CA 后验证真实 HTTPS 字节、重定向、chunked/超限/编码、304、超时/取消/清理。后者明确不是默认公网抓取证明。脚本的 Resolver/Socket 方法截获只在隔离的测试进程存在，测试完成即恢复；不可用于应用。

总控仍须执行适用的 API type/lint、正式 `verify:task` 注册及真实协议 gate/收据，串行集成、精确标题提交及远端回读后才能完成 I-* 集成 Task；候选提交不代表 CODE_VERIFIED 或负责人验收。人工验收不必浏览任意外部 URL：检查固定策略、运行自有 fixture、确认所有拒绝仅输出 code/count、确认 304 无正文及证据中无内容/query。下游 URL API 是另一任务，必须依赖真实集成 Task ID。

## 核验来源（2026-11-05）

- [Node HTTPS / Agent](https://nodejs.org/api/https.html)：每请求独立 Agent、createConnection、TLS 参数与显式 proxy 配置。
- [Node 24 DNS Resolver](https://nodejs.org/docs/latest-v24.x/api/dns.html)：A/AAAA 查询、独立 resolver、cancel、timeout 与 ENODATA；与 OS lookup 的差别。
- [Node WHATWG URL](https://nodejs.org/api/url.html)、[Node TLS](https://nodejs.org/api/tls.html)：规范化、IDNA、servername、lookup、CA 和 hostname 校验。实际执行环境为 Node 24.21.0，依赖版本未升级。
- [IANA IPv4 special-purpose](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml)、[IANA IPv6 special-purpose](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml)：地址分类依据，代码对 special-purpose 范围采取更保守策略。
- [RFC 5214 §6.1](https://www.rfc-editor.org/rfc/rfc5214.html#section-6.1)：ISATAP interface identifier；[RFC 9110 conditional requests](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2)：If-None-Match weak comparison 与 304 语义。以上为规则依据，没有抓取用户提供的网页。
