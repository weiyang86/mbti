# AF-224 root 接线与正式验证请求

状态：候选已实现，Candidate not CODE_VERIFIED。本卡 Writer 只交付下列新模块与离线测试；公开 index/package/build/registry/队列和正式 I 依赖由 root 独占。

## 公开导出

请 root 在 `packages/sdk/src/index.ts` 接入：

```ts
export {
  createPersonalDocumentSectionsClient,
  composePersonalDocumentSectionDraft,
  type PersonalDocumentSection,
  type PersonalDocumentSectionIndex,
  type PersonalDocumentSectionDraft,
  type ComposePersonalDocumentSectionDraftInput
} from "./personal-document-sections.js";
```

模块仅 type import 已有 `ClientApi` 与 `PersonalDocument`，没有 runtime source import，也没有 Node 运行依赖。`get(workspaceId, documentId, expectedRevision, signal?)` 仅一次 `GET /client/documents/:id/sections?expectedRevision=N`，使用原 ClientApi 的 workspace、认证和错误 owner，传入 `cache: "no-store"`。原 ClientApi 返回的 HTTP/abort 错误原样上抛；本模块请求校验及模糊成功解码失败为无业务 status 的安全 TypeError。

## 组合与 UI 注入

`await composePersonalDocumentSectionDraft({ document, index, sectionId, replacement })` 中 document 必须是原公开 PersonalDocumentsClient 当前 `get` 的完整 PersonalDocument，index 必须是同 id/revision 的章节响应。函数检查原对象 descriptor、精确字段、id/revision、UTF16/UTF8 长度、WebCrypto SHA256、所有分块连续范围和原文边界；内部边界必须位于完整原行起点，拒绝拆 surrogate pair 和 CRLF。它不重解析 Markdown，章节识别仍由 AF223 owner 负责。

替换整块含标题；非末块的非空 replacement 必须显式以 LF 或 CR 结束，函数不补换行。保留原 `.slice(0,start)` 和 `.slice(end)`，校验合成后不超过 65536 UTF8 字节，返回 frozen `{documentId, expectedRevision, sourceSha256, sectionId, body, changed}`；不包含原 code/name/owner/history。索引及其 sections 也 detached + deep frozen；输入不被修改，digest 等待前已取不可变快照。空 replacement 可删除一整块，`changed=false` 是纯 no-op；没有 PATCH 或独立 mutation owner。

AF225 可以由 root 注入上述 factory 的只读 get 和 async compose helper。UI 及原 manager 仍需按 CONTRACT 复检当前 scope/session/权限/已保存状态，只在显式确认后转全文编辑草稿；原明确保存继续使用已有 PATCH/expectedRevision。

## 正式 I224 入口

必须先接收真实 I223 的集成 Task ID，不能引用 AF223 候选 Task 代替。请 root 在自己的隔离环境完成：

1. 真实 I223 HTTP 的当前/旧 revision、删除、跨成员、撤权拒绝与原 auth/context 复检。
2. root 接上公开 index 后实际私有包 build，以及仓库外 fresh install 的 ESM/CJS、NodeNext 类型、浏览器消费。本卡 `.artifacts/AF-224` 只有新模块的独立编译/runtime 证据；声明文件及现有 public index 的正式全入口未获验证。
3. 用真实 body/index 复验哈希、emoji/替代字符/CRLF/单CR、围栏、空正文、128块、noop、65536字节与前后缀字节；GET 自身无 body，只能验证哈希格式与结构，body 的真实哈希/UTF16边界由 compose 核验。
4. 原公开 SDK PATCH 明确保存生成一版，以及 expectedRevision 409 拒绝；原历史/导出/Run/Job/Trace 等保持原 owner。无新增章节写 API。
5. 注册正式 `verify:task` 及适用门禁、队列与执行记录更新、按原任务名提交；正式 I224 完成后才能支撑 I225。

候选复现：先在自己的 node_modules 执行 `pnpm install --frozen-lockfile`，再 `pnpm --filter @aij/contracts build`、`node --test scripts/verification/personal-document-sections-sdk.test.mjs`、`pnpm exec eslint packages/sdk/src/personal-document-sections.ts scripts/verification/personal-document-sections-sdk.test.mjs --max-warnings=0`。测试仅用合成 ClientApi 和显式 loopback synthetic HTTP；未读取 AF223 worktree、未证明真实 API/权限/PG/native。
