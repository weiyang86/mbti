# AF-223 Root 接线与正式验收请求

候选范围仅三个新增 API 文件、一个新增测试及两份交接文档。Candidate not CODE_VERIFIED；不要集成 bootstrap 提交，只精确集成其后原名“提供个人文档章节索引只读接口”的候选提交。

## DocumentsModule 唯一接线

在 `apps/api/src/documents/personal-documents.module.ts` 的原 `DocumentsModule` 中追加以下两个 import：

```ts
import { PersonalDocumentSectionsController } from "./personal-document-sections.controller";
import { PersonalDocumentSectionsService } from "./personal-document-sections.service";
```

向原 `controllers` 追加 `PersonalDocumentSectionsController`，向原 `providers` 追加 `PersonalDocumentSectionsService`。复用已有 `PersonalDocumentNoStoreGuard`、`PersonalDocumentsService`、`ClientAuthModule`、`ClientWorkspacesModule`；`PersonalDocumentSectionsService` 用显式 `@Inject(PersonalDocumentsService)` 取唯一原 owner，构造参数的 `Pick<PersonalDocumentsService, "get">` 只缩窄可调用端口，便于真实类型离线测试，不引入新 owner。

Controller 路径为 `client/documents/:id/sections`，方法为 `GET`，沿原全局 `api` 前缀后为 `GET /api/client/documents/:id/sections?expectedRevision=N`。沿原 `PersonalDocumentNoStoreGuard → WorkspaceContextGuard`；后者内部先调用原 `ClientAuthGuard`，权限固定 `workspace.documents.read`。原 bootstrap 已对 `/api/client/documents` 安装 `personalDocumentNoStore` 中间件，覆盖该子路由；无需新增正文解析器、全局守卫、认证或缓存实现。成功及拒绝响应请实测 `Cache-Control: private, no-store`。

不需要修改 PersonalDocumentsService、原 controller、schema、migration、SDK index/package、锁文件或权限定义。Worker 没有写以上共享文件，也没有接入应用运行时。

## 冻结入口与拒绝行为

`buildPersonalDocumentSectionIndex({id,revision,body})` 返回冻结契约的七个顶层字段及连续 UTF16 区间；原正文 UTF8 SHA256、小写 hex、UTF16 长度和 UTF8 字节长度保持精确。LF、CRLF、单 CR、BOM、组合字符及 emoji 不正规化。标题只去首尾空格/tab；标题行保留在本块，尾部 `#` 保留字面值。空/纯正文仅一个“正文”块；前言计入 128 上限；空标题、257 codepoints、129 块明确 400，无截断。

Service 仅一次调用原 `PersonalDocumentsService.get(member,workspace,id)`，在授权后的当前快照上比较 revision，不读历史；不符 409。query 仅必填 canonical string `expectedRevision=1..200`，额外、重复/数组、非纯对象、getter、继承字段与非 canonical 值拒绝；沿 DTO 习惯接受 data-only 的 null-prototype query。另做 `String(parsed) === raw` 检查，拒绝 JS `$` 锚点可能接受的结尾换行。

## Root I223 必须完成的真实证据

1. 按原流程获取实际新保护租约、隔离 DB 目标保护与验证 Task；串行接入上面的 module，两类均复用现有 owner。候选单元测试不是正式 I223。
2. 用原 API、当前真实 client cookie 与 `x-aij-workspace-id`，读取已保存文档当前 revision 的目录，逐字段比较纯 parser；检查响应 envelope 和 no-store。
3. 实测匿名 401、撤销读取权限 403、其他成员与已删除文档 404、插件/项目不可用原拒绝，以及旧 revision 409。重复 expectedRevision、数组/额外/prototype query 和非 canonical 值须真实 HTTP 400。
4. 对索引前后文档正文、revision、历史版本，以及 Run/Job/Trace/exports 的数量和内容做不变性比较；Auth lastSeenAt 仅依原 owner 行为。没有本卡 schema、审计写入口或运行费用。
5. 运行适用原文档/历史/导出回归、质量门禁及正式 `verify:task`，完成执行/队列记录并按原标题提交；以真实 I223 Task ID 作为后续 I224 的依赖，不能引用本候选 Task 冒充正式 I。

人工验收可在 root 的受保护临时环境创建包含前言、emoji、三种行尾与围栏的已保存文档，读取目录并按 `body.slice(start,end)` 拼回全文，确认完全相等；将 revision 减一应 409，重复 query 应 400。Worker 没有启动访问地址、DB、应用/native、Docker 或付费调用；正式服务与人工页面验收留给 root。
