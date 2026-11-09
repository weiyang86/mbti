# AF-229 root 接线交接

本文件是候选接线说明；共享 owner、bootstrap、module、public barrel、正式验证与队列只由 root 修改。候选未达到 CODE_VERIFIED，W23 人工验收仍 pending；本批出口仍为 OWNER_CHECK_PENDING。

## 端口与模块

`ai-personal-document-generation.service.ts` 导出 abstract `DocumentGenerationRunDriver`，四方法均为 `(memberId: string, workspaceId: string, bodyOrId: unknown, claims: ClientClaims, correlationId?: string): Promise<unknown>`：

- `previewDocumentGeneration`
- `submitDocumentGeneration`
- `readDocumentGeneration`
- `recoverDocumentGeneration`

它们必须绑定 AF228 root 已接好的原 `AiCenterRunService`，不绑定新的执行器，不导入候选未来文件。原 owner 在同 admission TX 重建与核验文档/会话/Agent/Memory/model/catalog/费用及幂等引用，原 Run/Job/reservation/enqueue/Trace 的唯一 owner 不变。preview 不创建上述记录；recover 只观察原 key。

在原 `AiRuntimeModule` 注册新 `AiPersonalDocumentGenerationController`，providers 增加 `AiPersonalDocumentGenerationService`、`DocumentGenerationNoStoreGuard` 与以下绑定（controller/guard 来自新 controller 文件，service/driver 来自新 service 文件）：

```ts
{ provide: DocumentGenerationRunDriver, useExisting: AiCenterRunService }
```

缺 driver 时新 service 明确返回安全 503，不能以 optional DI 当作已接线通过。owner 异常在 await 时原样传播；只对 owner 的成功结构校验失败改为安全 503。结果要求 owner 传精确 publicRun/envelope，不传整个 Run 数据库行：私有/额外字段、异常原型及 getter 会被拒绝。Date 字段明确通过 `Date.prototype.toISOString` 转成 ISO，其余传输对象仅 plain/null prototype data object。

## HTTP 与 bootstrap

四个路由都在全局 `/api` 前缀下：

| 方法 | 路径 | HTTP 成功 | 权限 |
|---|---|---|---|
| POST | `/client/ai/document-generations/preview` | 200 | documents.read + ai.read + ai.assets.read |
| POST | `/client/ai/document-generations` | 202 | 上述 + documents.manage + ai.execute |
| GET | `/client/ai/document-generation-runs/:id` | 200 | 三个 read 权限 |
| GET | `/client/ai/document-generation-requests/:key` | 200 | 三个 read 权限 |

权限均带 `workspace.` 前缀，不要求 documents.export。Controller 通过原 `WorkspaceContextGuard` 获得 member/workspace/claims，session subject 必须匹配当前 member；POST 保留原同站 origin 检查，submit 保留 `AI_CENTER_CLIENT_EXECUTION_ENABLED` 开关。query 精确空对象并检查 raw URL 不含 `?`，避免解析器吞掉污染 query；两个 GET 也拒绝 body/content-length/transfer-encoding。

root 必须修改原 `apps/api/src/bootstrap.ts`，在 body parser/auth/错误处理之前给上述三个路径族匹配所有方法、子路径和错误响应，设置 `Cache-Control: private, no-store` 与 `X-Content-Type-Options: nosniff`。guard 仅能覆盖走到 guard 的请求，不能证明 401、JSON 400、415、413 等响应已 private。

POST 仅接受 UTF-8 application/json；原 parser 的 verify hook 对该 prefix 必须在 JSON.parse 前严格检查重复键（含转义同名）、`__proto__`/`constructor`/`prototype`、非法 UTF-8、非有限数、额外结构与大小限制，并把失败映射安全消息，不能回显 instruction/ref/body。可沿冻结 bootstrap 中 workflow 的 strict JSON owner 和 finite check 接法，避免维护另一个松散 JSON.parse 分支；不得把整套 workflow publication 当本卡来源。保持原其他接口解析行为。

## SDK barrel 与消费者

root 在 `packages/sdk/src/index.ts` 增加新文件的公开导出，建议显式导出以便检查命名冲突：

```ts
export {
  createPersonalDocumentGenerationClient,
  type DocumentSectionSelector, type DocumentSectionRef, type DocumentGenerationRef,
  type DocumentGenerationPreviewBody, type DocumentGenerationSubmitBody,
  type DocumentGenerationStatus, type DocumentGenerationBudgetStatus,
  type DocumentGenerationPreview, type DocumentGenerationRun,
  type DocumentGenerationRunEnvelope, type DocumentGenerationRequest,
  type DocumentGenerationRecovery
} from './personal-document-generation.js';
```

新 factory 的 `.preview(workspaceId, body, signal?)` / `.submit(...)` / `.read(workspaceId, id, signal?)` / `.recover(workspaceId, key, signal?)` 每次恰好一个原 `ClientApi` 请求，POST raw instruction 只在 JSON body，不在 URL。引用/结果为脱离输入的冻结对象；submit 返回 ref 全等于所提交的规范 ref；preview 绑定 selector/Agent revision/本次 raw instruction 的 UTF8 SHA256（SDK 需要 WebCrypto，缺失安全 TypeError）；read 绑定 run id。只接受 text 字符串输出（<=64000 UTF16），其他状态 output=null，imageAssetId=null，所有 wire 日期 canonical ISO，费用 canonical signed-int64 非负十进制字符串。metadata 的 documentCurrent 与 contentAvailable 独立，不代表可读取结果或允许自动重提；unknown/reserved 仍是原状态。

Worker 已构建现有 SDK 小包，但因禁止改 barrel，此构建未包含新模块；新模块由离线脚本分别语义检查并编译成 ESM/CJS，另作 NodeNext 类型消费者。root 必须在接 barrel 后重新构建、fresh pack，并在仓库外分别验证 ESM import、CJS require、NodeNext import/require 声明和 browser 消费者；不能把仓库内直接模块测试叫 packed 验收。

## root 串行验收

只精确接收候选 delta；不要 merge/cherry-pick source-only bootstrap 或 root 整段历史。依赖正式 I227→I228→I229 的真实已验证集成 ID，不引用候选 Task 充当代码依赖。

在受保护的 55433 隔离验收库串行跑真实权限/session/PG/API/runtime：preview 零 Run/Job/reserve/upstream；submit 正常与丢回复后查原 key；读成功 text 与 metadata recovery；篡改/过期/失权/外属/ref/费用拒绝；来源/会话撤销及 IO 后变化；purged full read 410、metadata 仍可查；generic run/key/image 不回退 legacy。检查原通用 Agent/workflow/text/image 路径回归、原运行时唯一 Trace/cost/请求状态 owner 与当前源门。

真实 HTTP 另验 strict JSON、NoStore 在成功和 400/401/403/404/409/410/413/415/503 上的覆盖、无正文/私有字段泄漏，以及真正公共 SDK 的四操作。注册 `verify:task`、适用门禁及真实 packed/browser 消费者由 root 完成；未完成者保持 NOT_RUN。本卡没有新 schema/migration、数据库、页面、日志账本或监听端口；Worker 没有运行应用服务。
