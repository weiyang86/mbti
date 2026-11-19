# AF-142 候选交付：提供个人用户通用AI任务工作台

日期：2026-11-05。此报告是 Worker 候选交接，不是正式 CODE_VERIFIED 或负责人接收；OWNER_CHECK_PENDING。

验收准备补充见 [AF-142-live-candidate](AF-142-live-candidate.md)：新增 root-only 合成 fixture/实际 HTTP 测试，Worker 未运行 DB/API 验收。

原候选因 F1/F2 审核退回；最新修订与验证见 [AF-142-review-fix-candidate](AF-142-review-fix-candidate.md)，下文“仅当前挂载保存”的历史边界已被最小持久恢复保护替代，不能作为缺陷豁免。

## 派工与基线

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W02-AF142`。
- Orca instance：`8b422a98-8b7e-49fe-b82c-9ef9ede94d46`；baseRef：`refs/remotes/origin/dev`。
- Task：`task_59fe192bc0c4`；Dispatch：`ctx_0fcc4e403f26`；Worker terminal：`term_ef1bbaa3-70e3-430c-b158-c13cd96177ec`。
- 分支始终为 `weiyang86/AIJ-W02-AF142`；起始 HEAD 与本地 origin/dev 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- remote fetch/push：`git@github.com:weiyang86/aij-foundation.git`。开工 `git status --short --branch` 干净；未切分支、未 fetch/push。
- 主工作区只读查阅 PROGRAM、WAVE-02、AF-142 及需求/源码缺口/交付基线；当前派工覆盖基线文档的历史未授权状态，不改写历史。
- 有效工程工时估计（非计时器实测）：契约核对与安装约 0.15h；实现约 0.35h；测试、自查、lint 兼容处理与交接约 0.30h；合计约 0.8h，低于 3.5h 预算。

## 实际差异与影响

仅新增允许的七个文件：

1. `apps/web/app/client/page.tsx`、`apps/web/app/client/ai/page.tsx`：两个真实入口，共用工作台。
2. `apps/web/app/components/client-ai-workbench.tsx`：复用 Ant Design、PageHeading 和现有客户空间 CSS/theme；空间/Agent 选择、按实际 inputFields 输入目标与参数、提交、任务编号读取、进度与文本/JSON/私有图片结果、空间/知识入口。
3. `apps/web/app/components/client-ai-workbench-state.mjs`、`.d.mts`：实际页面使用的可订阅状态模块与类型；校验服务端响应；scope 版本和 AbortController 隔离请求；轮询有上限、故障停止、人工恢复；防重复提交与相同幂等键确认；unknown 不自动重试执行。
4. `scripts/verification/client-ai-workbench.test.mjs`：直接执行上述状态模块，并在内存转译真实 SDK/contracts 源码，stub fetch 响应而非复制 SDK/状态实现。
5. 本候选报告。

数据库、Schema、后端接口实现、权限定义、日志/审计 owner 和 live 配置均无修改。无原轻企文件迁入，无全局 CSS、SDK、client-workspaces 共享组件、正式队列或 registry 写入。没有创建任务/执行/费用账本；页面展示服务端 AiAgentRun 的状态与结果。

## 复用契约及状态语义

- 统一 clientApi 确认 `/client/auth/me`、分页 `/client/workspaces`、`/client/workspaces/context`；URL 空间参数只在已列出的成员空间中匹配，服务端 context.workspaceId 还须匹配当前选择。
- 使用真实 `createAiClient` 的 `/client/ai/agents`、`POST /client/ai/agents/:code/runs`、`GET /client/ai/runs/:id`，提交仅 `{ input, idempotencyKey }`；服务端仍验证会话、成员关系、权限、Agent 目录、配置与执行策略。
- Cookie、no-store、workspace header 复用 SDK。当前客户写接口的 CSRF 防护是服务端 Origin/Sec-Fetch-Site 校验；没有另造管理员 CSRF Token 或客户端授权。
- SDK JSON 客户端不支持二进制，图片路径使用 SDK imagePath；同组件以 credentials=include、no-store、workspace header 和受 scope 控制的 signal 读取既有鉴权图片 GET。Blob URL 随图片切换/卸载撤销，不将私有内容交给 Next 图片优化服务。
- execute/read 分别控制列表/提交与读取；read-only 可按编号读原任务，execute-only 展示提交响应并明确缺少后续读取权限。401 使用原 `/client/login`；403 清空授权、结果和图片。
- 空成员空间、授权空 Agent 目录、400/403/404/409/410/503、failed、unknown 与 queued/running/succeeded 分开处理。无效响应不降级成 queued 或成功。
- 空目录显示等待配置；404 显示 Agent/模型/记录不可用；503 明示配置或执行策略可能未就绪。现有客户端 SDK 只保留 HTTP 状态，不暴露关闭原因/模型 readiness；界面明确接口缺少原因，未伪造“具体开关已关闭”或“模型已启用”。默认 live 开关完全未改。
- 轮询每 1.5s、最多 120 次；错误暂停，可人工读原任务恢复。unknown 保留服务端预算语义，不自动重新执行，也不开放原任务的“开始新任务”动作。
- 同一提交中的重复点击只发一个请求；网络/503/响应模型异常的提交结果未确认时锁定参数，确认提交复用原幂等键。该请求状态只保留于当前挂载页面；切换空间/重载后不持久化输入或自动恢复未确认提交，用户应核对原任务，不能把取消本地请求当作取消服务端执行。
- 切空间、切 Agent、开始新任务、pagehide、卸载均使旧 scope 失效并取消对应请求/定时器；即使测试 transport 忽略 abort，旧响应/旧 401/旧图片也不能污染当前空间。

## 命令、退出与真实验证范围

环境：Node `v24.21.0`，pnpm `10.0.0`；独立安装本工作区依赖。

| 命令 | 最终退出 | 结果 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | 独立安装 726 包，锁文件无变化；pnpm 提示若干依赖 build scripts 未执行，未开启它们 |
| `node --test scripts/verification/client-ai-workbench.test.mjs` | 0 | 28 tests / 28 pass / 0 fail / 0 skipped |
| `pnpm exec eslint apps scripts --max-warnings=0` | 0 | 全仓库 lint 通过；Next 插件仍打印既有 pages 路径提示，无 ESLint 规则告警 |
| `pnpm exec eslint apps/web/app/components/client-ai-workbench-state.d.mts --parser @typescript-eslint/parser --no-inline-config --max-warnings=0` | 0 | 使用正确 TS parser，独立验证声明文件，包含 no-unused-vars 检查 |
| 下述源码导入图 noEmit | 0 | 860 个导入文件、0 diagnostics，无 build/emit |
| `git diff --cached --check`（提交前） | 0 | 七个允许文件的差异检查 |

noEmit 原命令（从本工作区执行，不生成文件）：

```sh
node --input-type=module <<'JS'
import ts from 'typescript';
const program = ts.createProgram(['apps/web/app/client/page.tsx','apps/web/app/client/ai/page.tsx','apps/web/app/components/client-ai-workbench.tsx'], {
  target: ts.ScriptTarget.ES2017, lib: ['lib.dom.d.ts','lib.dom.iterable.d.ts','lib.esnext.d.ts'],
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
  strict: true, skipLibCheck: true, esModuleInterop: true, noEmit: true, baseUrl: process.cwd(),
  paths: {'@aij/sdk':['packages/sdk/src/index.ts'],'@aij/contracts':['packages/contracts/src/index.ts'],'@aij/ui':['packages/ui/src/index.ts']}
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, {getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:x=>x,getNewLine:()=> '\n'}));
console.log(JSON.stringify({check:'AF142 source import graph noEmit', files:program.getSourceFiles().length, diagnostics:diagnostics.length}));
process.exitCode = diagnostics.length ? 1 : 0;
JS
```

有效测试包括：真实 SDK Cookie/no-store/header/body 合约，授权空间分页与 foreign ID 拒绝，context 绑定，execute/read/无权限分离，空目录/空成员空间，503 恢复，输入拒绝与修正，重复提交/不确定提交同键确认，failed 与 unknown，context/Agent/submit/poll/image 跨 scope 竞态，卸载与迟到 401，当前 401/403，轮询错误/上限恢复，错误响应 identity/status/budget/input schema/envelope，JSON 原值，以及私有图片成功/非法类型/失效/过期路径。

这些是纯状态与 SDK 实现测试，fetch/图片服务为受控合成返回，未建立真实 HTTP/DB 连接、未解码真实图片，也未测试浏览器渲染或真实后端授权。

已解决的初始失败保留：首轮 24/25，旧 timer 测试手动触发回调未从 fake timer Map 移除，改用同 harness 的 tick 后 25/25，追加边界用例后 28/28。原配置 lint 首次退出 2，Next Babel parser 的 TS 声明 AST 与 typescript-eslint no-unused-vars 不兼容；只在本卡 `.d.mts` 加有说明的该规则兼容注释，全仓库原命令随后退出 0，并额外用正确 TS parser + `--no-inline-config` 检查该文件退出 0。没有修改全局 parser、依赖或锁文件；当前无已知失败用例。

## 未运行、人工步骤与总控建议

Worker 未运行 verify:task、Web/全库 build、浏览器、服务、真实 HTTP、DB、Prisma generate、Docker、seed/migrate、真实厂商、通知或付费。`/client`、`/client/ai` 只声明入口，未声称地址已运行。

总控收到停写交接后，精确集成候选七文件，注册并执行本卡正式 verify:task 与适用门禁；Web 构建串行。建议在经核验的隔离环境用合成数据/受控 API 响应完成：

1. 登录后分别打开 `/client`、`/client/ai?workspaceId=<有效空间>`；验证布局/手机宽度、实际 Agent 字段、重复点击只入一任务、queued→running→文本/JSON/图片结果，保存编号后重新读取。
2. 无空间、目录空、模型不可用、执行策略关闭/503、403、失败、unknown 分别核对文案；保持默认 live 关闭，不能为 UI 测试启用真实付费调用。
3. read-only/execute-only/无授权账号，以及越空间/越成员任务编号进行真实 HTTP 拒绝验证；401 应进入原登录。Worker 纯测试没有替代这项授权验收。
4. 延迟 context/Agent/提交/轮询/图片响应时快速切空间、离开页面；确认网络 signal/定时器取消、旧响应不回填、私有 Blob URL 释放。观察页面冻结恢复及错误后的人工恢复。
5. 合成断网或503后确认提交复用原幂等键；unknown 不触发 POST 重试。图片 GET 必须携带 Cookie 和 workspace header，过期/拒绝后不展示旧图片。

当前后端没有用户任务列表/个人空间创建/执行配置 readiness 原因接口；本卡通过已有空间及任务编号读取交付切片，不宣称完整个人空间模型、历史任务中心、个人 Agent 资产、多厂商真实验收或全40需求完成。后续任务必须引用总控实际 I-* 集成 Task ID，不能引用本候选 Task 当正式 CODE_VERIFIED 依赖。

## Writer 交接

本候选只做一次本地提交，标题为 **提供个人用户通用AI任务工作台**，AF 编号放正文；SHA 以交接消息及 `git log -1` 为准。未修改正式状态，未 merge/push/PR/main/tag/部署。

**在该候选提交完成后，Worker 停止本卡全部代码、测试和文档写入，将上述七文件的候选差异交回主 Agent；未获新派工前不再修改。** 总控正式验证与负责人接收仍待执行。
