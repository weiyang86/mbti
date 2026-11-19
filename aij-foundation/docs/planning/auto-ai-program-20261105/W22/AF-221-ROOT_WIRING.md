# AF-221 实际父组件接线补充（候选，root 尚未集成）

本节是 Task task_19d52bafe9f1 / Dispatch ctx_4e61e8d56592 的当前实现，优先于下方 f258 初次候选时的建议。负责人经总控将三个零 diff 的父文件范围独占交还原 Writer；同一注册子工作区从 f258f17342199bef4429f02d073178b0b5f665ee clean 开始，无根 live 源码复制，不改 bootstrap/原候选。Candidate not CODE_VERIFIED。

现在已经实现实际接线，无需总控再按旧建议重复改父组件：

- `ClientDocumentLibrary` 把 `access.request` 与 `access.subscribeInvalidation` 传入原 manager；没有传 raw clientApi。
- `createDocumentAccess.request` 是原 guarded：只有精确 GET `/client/auth/me` 可省 workspaceId，其余路径必须精确当前空间；保留 readScope 前后验证、完整 session/role/validation identity 和 generation、二进制迟到归零、未知 mutation 语义。verifier 自身继续走原 raw clientApi，未递归。当前原请求 401/403/404 也送回原失败 owner；旧 generation 的失败不清新 owner。clear 与已有 scope 身份变动同步通知清理。
- manager 用页面实例 `createDocumentComposition` 持有**同一个** restore store，传给永久无 key 的 `ClientDocumentVersionRestorePanel.controller`。独立使用面板仍支持原四 props；受管面板不会再创建第二 store。父 CRUD/编辑与导航围栏直接读取这个 store 的 busy/confirmation/locked，不另建锁账本。重绑 API/request、null、conceal 和 dispose 均不能重建该锁。
- parent 的 publish 同步应用 `savedDocumentRestoreScope`：编辑、忙、原 recovery/conflict、历史选择、删除确认或没有当前已保存详情时都置 null。完整父身份还在 render 阶段遮罩，防止同一 document/revision 但 role/session 已变时等待 effect 才隐藏。
- 打开/保存后提供“退出编辑，比较历史”，只接受名称正文与已保存基线相等、无忙/原未知/冲突/历史选择/删除确认/恢复活动的状态。脏稿明确提示先保存或显式丢弃，没有静默丢稿。只读角色可退出到比较视图；“继续编辑”需原管理权限和同一恢复锁允许。比较视图正文转义、折行，标题和正文可键盘到达。
- `onDocumentChanged` 调原 manager 的 `reloadRestored()`，只对仍为当前非编辑的原详情调用原 guarded SDK get，先清旧详情再以服务端结果保留已保存视图；无子数据注入，不读其他资源。若范围已变化，原 epoch/guard 丢弃迟到结果。
- `onScopeRejected` 先同步清子 store 和原 manager 私有状态，再调用原 library 失败 owner；access 失效订阅也在 React 重绘之前清父子。原恢复 opaque 锁保留，原 CRUD 的 recovery owner 不替换。blur/hidden/unmount 继续用同一清理路径。
- 恢复未知时父保存/新建/删除/进入编辑关闭；仍可显式读列表/原文档，以只读保存视图回到原范围核对。close/null 不丢恢复锁，显式原范围 GET + 单独新鲜 ACK 后原 guarded get 重读。原 parent 未知写入继续阻止 restore scope，原 owner 自行处理。
- 保留 AntD/adminTheme/PageHeading；文案已说明历史恢复支持、分段再生成以后提供；取消恢复 Modal 的原 scope 围栏焦点逻辑保留，退出编辑/重读后增加已保存标题焦点。

离线检查：原 28 项恢复测试、新 17 项 actual guarded/store/composition/render wiring 测试、受影响原导出围栏 3 项，合计 48 项；focused ESLint 与 Web tsc --noEmit。所有都是本地合成或静态测试；真实 PG/API/CAS/旧版本/导出引用、原生浏览器/桌面/390/真正 hidden 与正式 verify:task 仍由 root 执行，保持 NOT_RUN，不能以本节测试代替。

下方原六文件候选说明作为历史保留：其中“尚未修改父组件”和“总控应增加退出编辑/guard 窄出口”的工作已由本补充在子工作区完成；其原 API/权限/未知写入契约与总控真实验收边界继续有效。

---

# AF-221 总控接线说明（候选，尚未集成）

本文件是共享文件的接线 hook，不表示 Worker 已修改父组件。Worker 只新增面板、状态、声明、离线测试和两份交接文档；Candidate not CODE_VERIFIED。合同来源为根只读 W22/CONTRACT.md；冻结代码来源 dc13430835ae89b58ae18577be12643224c9c55e。

## 公开输入与永久挂载

```tsx
import { ClientDocumentVersionRestorePanel } from "./client-document-restore-panel";
import type { ClientApi } from "@aij/sdk";
// 原 ClientDocumentManagerProps 增加 readonly request: ClientApi。
// 这是 ClientApi 形状的输入；api: PersonalDocumentsPort 继续由原 owner 持有。

const restoreScope = state.scope && state.detail && !state.editing &&
  !state.busy && !state.historical && !state.deletePrompt &&
  !state.recovery && !state.conflict && canRead
  ? { memberId: state.scope.memberId, workspaceId: state.scope.workspaceId,
      documentId: state.detail.id, revision: state.detail.revision }
  : null;

// 放在 manager 的稳定层，所有 canRead/editing/detail 等条件块之外。
<ClientDocumentVersionRestorePanel
  request={request}
  scope={restoreScope}
  onDocumentChanged={handleRestoredDocument}
  onScopeRejected={handleRestoreScopeRejected}
/>
```

仅一个实例，禁止加随文档/修订/空间/账号变化的 key，禁止条件挂载。scope=null 必须继续挂载，未知锁仍在该实例内；面板会显示无正文的锁提示。不要通过重新创建 store、换 key、卸载再挂载来绕过锁。真正卸载会在旧 store 中清正文并保留 opaque 锁，但本功能没有跨页面持久化；不承诺重载后保存 RAM。

冻结 manager 的 `applyDetail()` 总是令 `editing=true`；因此仅添加上述 JSX 会使恢复入口永远不可达。总控应增加一个窄的、显式的“退出编辑，比较历史”状态转换：只在已保存详情、无忙碌/历史预览/冲突/未知结果且名称正文与保存基线完全相同时退出编辑，保留已保存详情供 scope 使用；有草稿时要求用户先保存或明确丢弃，不能隐式丢弃。恢复面板只在只读已保存详情模式取得 scope，不能把 `editing=true` 解释为可恢复，也不能让草稿参与恢复 payload。保留原 PageHeading、AntD/adminTheme 与原编辑/历史功能；集成通过后再更新原 PageHeading 中“历史恢复将在后续提供”的文案。

## ClientApi 的原权限与会话 owner

原 `ClientDocumentLibrary` / `createDocumentAccess` 必须继续拥有选择空间、会话、role/permissions/sessionKey、generation 与当前权限验证。由它向 manager 传入稳定的 ClientApi 形状 `request`，不创建另一套登录/权限状态，不用 admin 请求，不从 props 的 workspaceId 推定权限。

冻结 `createDocumentAccess` 只暴露 `api/exportsApi`，其内部 guarded 对所有请求要求 options.workspaceId；不能直接把 PersonalDocumentsPort 强转成 ClientApi，亦不能直接把未围栏的 clientApi 当成已经接好父 owner 的输入。总控可在原 owner 窄出口暴露 guarded 的 ClientApi，并允许面板所需的只读 `/client/auth/me` GET 无 workspaceId，其余 context/documents 请求仍须精确匹配当前空间。所有路径继续执行原 readScope 的前后验证及 generation 比对，readScope 自身仍使用原 raw clientApi，避免递归；失败仍调用原 handleAccessFailure。原权限围栏还验证 project/organization/插件安装，不应省略。输入 prop 的 readonly 表示组件不能改写它，不代表恢复没有 PATCH。

面板内部再通过原 `/client/auth/me`、`/client/workspaces/context` 前后核对 member/workspace/role/permissions/精确小写 64hex sessionGeneration，并通过实际公开 SDK get 核对 documentId/revision。scope 仅有四个规定字段；父 owner 的角色/会话变动即使四字段相同，也必须同步将输入变为 null 或变更被取消的请求 generation，不能仅依赖四字段触发 React effect。禁止对当前会话验证另造缓存、身份字符串、默认空间或静默重试。

## 两个回调

`onScopeRejected`：面板在仍属当前动作的 401/403/404 或当前身份/权限变化时先同步清子面板私有状态，再调用此回调。总控回调必须在任何 await 前同步清原 manager 的 detail、name/body/code、history/historical、确认和导出私有状态，并调用原父 owner 的拒绝处理清 scope；可用保留原未知恢复标识的 conceal 路径，而非丢弃其他未确认写入。没有实际 error 参数时以安全的 ClientRequestFailure(403) 交回原 owner，原 raw 401 的处理仍由该 owner 保留。不要仅 setIssue、只清子面板、直接改 permissions，或自动刷新其他资源。

`onDocumentChanged`：只收到无参数通知，没有未经围栏的文档对象。总控从原 manager 当前状态取得原详情 id，确认仍为当前成员/空间/详情且非编辑/忙碌，再经原 api.get/open 的当前权限围栏重读；禁止把面板临时数据直接注入父页，不重读其他空间/资源。恢复成功与用户在未知结果后完成独立 ACK 才通知；no-op/取消/CAS 拒绝/未知/迟到/hidden/unmount 均不成功通知。原 parent CRUD 及其 CAS/草稿 owner 保持原职责；预检 409 不覆盖原当前人工编辑。

## 请求、锁与错误语义

仅原 createPersonalDocumentsClient 的 get/versions/getVersion/update。历史通过原 beforeRevision 游标分页；历史结构只有 documentId/revision/name/body/createdAt，没有 Agent version id。唯一恢复 payload 为 `{expectedRevision: current, name: historical.name, body: historical.body}`，实际方法 PATCH。当前文档 revision 必须仍等于 scope；确认前后重查，不能自动采用新 revision 重放。相同名称正文（包括空正文）零 PATCH，取消零 PATCH。

成功必须核对 PATCH 的唯一新修订和后续原 GET head；原历史与导出引用的真实不变性由原文档/导出 owner 及总控 PG/API 验收证明。面板没有新增 API、SDK/表/权限/审计、导出或删除恢复能力，也没有新日志 owner。

尝试 PATCH 前设置 RAM 锁，保留 opaque member/workspace/document/expectedRevision 与原授权指纹（SHA-256，不含名称正文）。所有尝试后的错误，包括 400/401/403/404/409 或已提交但丢回复，保留此锁。null、换身份/空间/角色/会话/头版本、blur/pagehide、真正 hidden、dispose 都清正文/名称/历史/确认，锁不丢失。锁存在时不允许再次恢复。

只能在原成员/空间/文档及原角色/权限/会话指纹下显式读取当前 head；新 owner 不能用自己的读取解除旧锁。读取不会清锁，需另一次明确 ACK，ACK 重新验证当前授权与同一份 head 后才解锁。若原会话/角色已无法恢复，则本实例无法安全核对旧结果，保留锁；不换 owner、不 poll、不 retry、不新造恢复 endpoint。原文档不可读/404时同样不能凭“找不到”解除锁。

## 总控验收与未运行

Worker 已运行的是实际编译公开 SDK + 合成 ClientApi 响应的离线单元、静态 AntD 渲染、lint 与 Web 类型检查。合成 visibility/listener 及 React hook harness 不等于原生浏览器，不是 PG/API/native 通过。

总控集成后应在本卡正式 verify:task 与适用门禁中验证：

1. 接好原权限围栏、显式退出编辑与永久单面板；read-only 能比较，read+manage 才恢复，no-op/取消零写。
2. 原接口真实 PATCH 只新增 v3/v4 等唯一新版本，原 v1/v2 的名称正文、版本时间与既有导出引用/下载内容不变。
3. 两账号/空间、401/403/404、manage 撤销、role/sessionGeneration 变化同步清父子正文；CAS 保留并发人工版本。
4. 丢回复/延迟/超时/4xx/409 后原范围 GET + 独立新鲜 ACK，null/切换不丢锁，不使用新 owner 核对。
5. 桌面与 390px 原生键盘、焦点返回、真正 hidden、blur/pagehide、卸载和迟到回调；不能以本文合成事件代替。

数据库、API/HTTP、导出持久引用、原父页实际接线、原生桌面/390、根 verify:task 与 full build 均由总控执行，Worker NOT_RUN。全部目标验收状态保持 NOT_RUN_TARGET_ACCEPTANCE，直到总控逐项取得真实证据。无运行地址，未启动/停止任何服务；未执行 DB/migrate/seed/Docker/外部厂商调用。
