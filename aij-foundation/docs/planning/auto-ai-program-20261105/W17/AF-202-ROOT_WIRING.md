# AF-202 root 接线请求（候选，不是 CODE_VERIFIED）

依据固定 W17 CONTRACT；仅固定 AF201 port 开发，没有读取 AF201/203 活跃源码。总控须在真实 I201 完成后接 I202，I203 依赖实际 I202。bootstrap 不进入产品候选 delta。

## 实现接口与默认关闭

- `PersonalDocumentsService.withCurrentDocument(member,workspace,id,expectedRevision|undefined,callback)`：同一原短事务先 read 后 export，原 lifecycle/member/role/grant/head 锁；callback `(tx,head,projectId)`。undefined 只允许下载/列举历史附件，不取消当前 head 未删除校验。原 CRUD 路径未降低权限。
- `PersonalDocumentExportsService(prisma,documents,files,profile)`。`DOCUMENT_EXPORT_FILES` token `useExisting: GeneratedFileAssetsService`，结构 port 为 CONTRACT 原 stage/commit/confirm/discard/read；ticket 对象原样传递，未序列化或重建 opaque capability。仅 stage 返回 assetId 可见。
- 注册 `PersonalDocumentExportsController` 和 `DocumentExportNoStoreGuard`；导出原 PersonalDocumentsService 供同 module 使用。profile provider 默认 `useValue:new DocumentExportProfile()`，该值内是真实 `new DocumentExportExecutor()` 且 configured=false；不要 Nest 自动注入其可选构造参数。
- 原 runtime loader 新增严格 AIJ_DOCUMENT_EXPORT_ENABLED（缺省 false；仅接受 true/false），IMAGE_ID/DOCKER_CLI 缺省空。启用仅在 trusted root loader 验证绝对规范 CLI 路径、sha256 固定 image 后提供 `new DocumentExportProfile(new DocumentExportExecutor({enabled:true,dockerCliPath,approvedImage}),true)`。profile.configured 表示配置完成，非 Docker 健康探针。无外部账号/密钥；不在 client 或 process.env 临时启用。所有 executor 非 SUCCESS（包括 BUSY）固定 503，安全固定消息，不回显原输出。
- HTTP `/api/client/document-exports` 必须在全局 JSON parser/认证之前 mount `documentExportNoStore`；将原 `personalDocumentJsonVerify` 的重复 key / UTF8 检查同样覆盖此路径，沿用原 body 大小限制和原 auth/CSRF pipeline。controller 内另做同源 Origin/sec-fetch-site 检查。所有错误必须保持 private,no-store+nosniff，不要全局 envelope 包装已 `@Res()` 发送的 binary。
- POST query 必须为空；capability/get/content 也拒未知 query；list 只接受 documentId/revision。GET capability 只需当前 read，其他端点同时 read+export。权限新增 `workspace.documents.export` 到原注册表，仅增量给原启用 OWNER；不可复活禁用角色/权限，不把 manage 当 export。
- response close 且 writableFinished=false 才取消。原 request.close 正常事件不取消。原 executor 15 秒执行窗口，SDK 总传输 deadline 120 秒容纳 cleanup，不自动重发。

## 精确 SQL 建议（只由 root 写入并执行审定 migration）

原 personal_document_scope_key、personal_document_version_revision_key、file_asset_id_workspace_key 已存在于 immutable source；迁移前确认实际 DB。

```sql
CREATE TABLE public.personal_document_export (
 id uuid PRIMARY KEY,
 document_id uuid NOT NULL,
 workspace_id text NOT NULL,
 member_id text NOT NULL,
 project_id text NOT NULL REFERENCES public.project_profile(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 revision integer NOT NULL CHECK (revision BETWEEN 1 AND 200),
 file_asset_id text NOT NULL,
 format text NOT NULL CHECK (format IN ('docx','pdf')),
 renderer_version text NOT NULL CHECK (renderer_version = 'aij-plain-document-v1'),
 page_count integer,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT personal_document_export_scope_fk FOREIGN KEY (document_id,workspace_id,member_id)
   REFERENCES public.personal_document(id,workspace_id,member_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT personal_document_export_revision_fk FOREIGN KEY (document_id,revision)
   REFERENCES public.personal_document_version(document_id,revision) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT personal_document_export_file_fk FOREIGN KEY (file_asset_id,workspace_id)
   REFERENCES public.file_asset(id,workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT personal_document_export_tuple_key UNIQUE(document_id,revision,format,renderer_version),
 CONSTRAINT personal_document_export_file_key UNIQUE(file_asset_id),
 CONSTRAINT personal_document_export_pages_check CHECK (
   (format='docx' AND page_count IS NULL) OR
   (format='pdf' AND page_count IS NOT NULL AND page_count BETWEEN 1 AND 100))
);
CREATE INDEX personal_document_export_owner_idx ON public.personal_document_export(workspace_id,member_id,document_id,revision);
CREATE FUNCTION public.personal_document_export_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable document export'; END;
$$;
CREATE TRIGGER personal_document_export_immutable_trigger BEFORE UPDATE OR DELETE ON public.personal_document_export
 FOR EACH ROW EXECUTE FUNCTION public.personal_document_export_immutable();
```

Prisma 新 model 与 SQL 同名映射，字段 id/documentId 用 @db.Uuid、createdAt @db.Timestamp(3)，其他对应 String/Int/Int?。具体关系：

```prisma
model PersonalDocumentExport {
 id String @id @db.Uuid
 documentId String @map("document_id") @db.Uuid
 workspaceId String @map("workspace_id")
 memberId String @map("member_id")
 projectId String @map("project_id")
 revision Int
 fileAssetId String @unique(map:"personal_document_export_file_key") @map("file_asset_id")
 format String
 rendererVersion String @map("renderer_version")
 pageCount Int? @map("page_count")
 createdAt DateTime @default(now()) @map("created_at") @db.Timestamp(3)
 document PersonalDocument @relation(fields:[documentId,workspaceId,memberId],references:[id,workspaceId,memberId],onDelete:Restrict,onUpdate:Restrict,map:"personal_document_export_scope_fk")
 version PersonalDocumentVersion @relation(fields:[documentId,revision],references:[documentId,revision],onDelete:Restrict,onUpdate:Restrict,map:"personal_document_export_revision_fk")
 file FileAsset @relation(fields:[fileAssetId,workspaceId],references:[id,workspaceId],onDelete:Restrict,onUpdate:Restrict,map:"personal_document_export_file_fk")
 project ProjectProfile @relation(fields:[projectId],references:[id],onDelete:Restrict,onUpdate:Restrict)
 @@unique([documentId,revision,format,rendererVersion],map:"personal_document_export_tuple_key")
 @@index([workspaceId,memberId,documentId,revision],map:"personal_document_export_owner_idx")
 @@map("personal_document_export")
}
```

各原 model 添加逆关系 `documentExports PersonalDocumentExport[]`（可按已占用名调整）；SQL CHECK/immutable trigger 保持 SQL 真值，Prisma 不替代它。已有 FileAsset 与版本 row 不复制、不加新文件/Job账本。第二事务使用原 per-owner advisory/head 锁串行 check+insert，再由 tuple 唯一约束兜底；并发 loser 不写 file metadata/审计。未知 commit 仅重读精确 tuple 且验证本次 id+assetId；不重试 INSERT。恢复期间权限撤销也不泄露 meta；discard 必须由 AF201 自己判定 committed/unknown，未知保留字节。

## 原 SDK index / fetch 最小接线

共享 index 由 root 修改：

```ts
import {readClientBinaryResponse} from './client-binary-response.js';
export * from './personal-document-exports.js';
export type {ClientBinaryResponse} from './client-binary-response.js';
// 只扩展原类型；JSON 默认不变。
export type ClientApiOptions = RequestInit & {
 workspaceId?: string; responseKind?: 'binary'; maxResponseBytes?: number;
};
```

原 `createClientApi` 中同一个 fetch（原 credentials/include、workspace header、cache/signal）后：先按原 response.ok 分支处理 error，清理非成功 response.body；再在任何 response.json() 之前添加：

```ts
if (options.responseKind === 'binary') {
 return await readClientBinaryResponse(response, options.maxResponseBytes, options.signal ?? undefined) as T;
}
```

fetch 参数中解构排除 responseKind/maxResponseBytes/workspaceId，避免自定义字段外传；无需另起 fetch/凭据实现。helper 消费真实 response stream，长度 1..5MiB，拒压缩/缺长度/超限/短流，abort cancel+release，失败清零分配缓冲。SDK 下载核对所有指定 headers/私有缓存策略/expected meta/完整 WebCrypto SHA256；安全 filename 固定 document-UUID-rREV.ext，不含正文和用户姓名。未知 metadata/network/5xx 不自动重试 POST。guarded ClientApi wrapper 必须原样透传新增 options，在传输前后重验 scope；拒绝迟到 binary 时清零 bytes，取消不得持有响应缓存。对 guard 后置写失败维持未知状态，禁止假定未提交。

## root 必须执行的真实门禁

Worker 只提供小协作者/真实 TS/DTO/stream/WebCrypto/ESM/CJS 检查，不是 PG/Docker/API/浏览器证据。root 在隔离 127.0.0.1:55433 串行迁移后验证：真实 FileAsset+immutable revision FK/不可变触发器；两 API 并发唯一；审计失败 rollback；未知 commit/discard；删除后 404/历史 revision 读；撤权/切空间/项目与插件停用；CSRF/重复 key/所有 private error headers；真实原 Executor→DOCX/PDF→本地文件→HTTP bytes；原上传 scope 回归。公开 index ESM/CJS/strict 安装实包消费者及原 JSON 回归、guarded scope fence、Linux/Docker、正式 verify:task 全由 root。外部 DEFERRED_NOT_PASSED，真实配置留空；不替代完整40或 AF191 原生14。


## P2 浏览器跨端口 CORS 接线补充（root 修改 shared bootstrap）

默认 Web `3655` → API `3656` 是跨 origin 的 credentialed fetch；仅 origin+credentials 的 enableCors 不会向 JS 暴露全部下载校验头。root 应在原 CORS 配置对可信、明确的 configured web origin 保持 `credentials: true`，新增精确 `exposedHeaders` 列表：

```ts
[
 'Content-Disposition',
 'X-Content-Type-Options',
 'X-AIJ-Document-Id',
 'X-AIJ-Document-Revision',
 'X-AIJ-Export-Id',
 'X-AIJ-Checksum-Sha256',
 'X-AIJ-Renderer-Version',
]
```

不使用 credentialed wildcard origin 或 wildcard exposedHeaders；Content-Length/Content-Type/Cache-Control 已属于 CORS safelisted response headers，无需扩大暴露集合。root 必须用真实跨端口浏览器与安装实包 SDK 的原 fetch 验证这些头实际可读取、完整 SHA256 校验及下载成功，并确认非可信 origin 被原策略拒绝；Node Response 小测试不能证明浏览器 CORS 通过。Worker 本次没有修改 shared bootstrap，也未运行浏览器验收。实际 profile ID 仍来自原 projectId(tx)，不替换成 runtime slug；SQL TRUNCATE 防护由 root 已知硬化范围处理。

## Session fence 补充（root Controller 必须接入）

`create(member,workspace,raw,signal?,authorize?)` 第五参数是仅可信 server 内部使用的 `(tx: Prisma.TransactionClient) => Promise<void>`；不加入 HTTP DTO/SDK，不接收客户端函数或 claims JSON。root 在原 Controller 已验证请求中捕获 `req.clientClaims`，传入 `authorize = tx => auth.assertSessionInTransaction(tx, verifiedClaims)`，每个 HTTP create 都必须提供实际原 ClientAuthService fence，不因参数可选而省略；可选仅保留既有直接内部调用兼容。

Service 在原 withCurrentDocument 的 initial snapshot、final commit、unknown commit readback 三个回调最开始 `await authorize?.(tx)`：分别早于 configured/tuple、复用/文件提交、精确恢复读取。使用现有 tx，不开 nested auth transaction。初次 session 401 不运行 renderer；渲染/stage 期间 session revoked/tokenVersion 变更在第二事务拒绝，不写 relation/file metadata/audit。未知提交恢复中的 gate 401 优先返回原 auth 401，不恢复/暴露 committed meta；随后只委托 AF201 discard 检查该 ticket，已提交或未知文件保留。cleanup 状态未知时也不覆盖已确认的 auth 401；原 artifact RAM 仍由 finally 清零，不清零 staged/persisted 副本。

root 必须用真实登录、原 ClientAuthService、隔离 PG 实测 session revoke/tokenVersion 更新与导出第二事务/未知恢复的竞争，确认 401、未提交 metadata/audit 原子性、已提交文件保留和无 metadata 泄露。Worker 的事务协作者 gate 验证不属于真实 PG/登录验收；root 已报告先前十场景通过不替代本 session fence 的新增门禁。本次未改 shared auth、Controller、module 或 registry。
