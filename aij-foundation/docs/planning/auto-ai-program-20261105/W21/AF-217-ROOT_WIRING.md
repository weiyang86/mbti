# AF-217 总控接线与真实验收

状态：候选组件，非 CODE_VERIFIED；只有下述六个 NEW allowPaths 的候选差异允许接收。不得集成 source-only bootstrap 的 514 个变化路径，也不复制本工作区依赖或 ignored artifacts。

## 固定来源与交接边界

- Task `task_f13743945dc6` / Dispatch `ctx_60a0c733cd63`，Writer terminal `term_bf6aabaa-736d-47f0-9bed-27717222ceb7`。
- 初始 HEAD / 当时 origin/dev：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- 来源：`f0e12d76b0c2c5dccf4d1c56369019e979e52902`；manifest SHA256 `b17b864c7587471a2ed98507429f0c019d4f0f9ef70502d54fd71939745a82b5`，1009 个文件逐一验证了来源、落盘与 bootstrap 已提交 blob。
- Bootstrap：`2a8c159e26938fb13911a194e5ef463bae4c46b6`，标题 `W21 verified source-only bootstrap`；候选提交标题必须为 `提供个人工作流发布与手动执行页面`，确切候选 SHA 由最终 worker_done 和 Git 回读提供。
- 接收范围：本文件、`docs/execution/AF-217-candidate.md`、`apps/web/app/components/client-workflow-execution-{panel.tsx,state.mjs,state.d.mts}`、`scripts/verification/client-workflow-execution-state.test.mjs`。精确提取 bootstrap 到候选 SHA 的六文件新增 delta；不要 cherry-pick bootstrap，不带入其他 Writer 或原根目录差异。

## 原 ClientWorkflowLibrary 最小挂载

Worker 没有编辑原宿主。总控在 `apps/web/app/components/client-workflow-library.tsx` 导入 `ClientWorkflowExecutionPanel`、React `useMemo`，在已有 state/canRead 之后计算：

```tsx
const executionScope = useMemo(() => {
  if (state.phase !== "ready" || state.busy || state.blocked || state.editor ||
      state.confirmation || state.replay || state.historical || !canRead ||
      !state.principal || !state.context || !state.detail ||
      state.workspaceId !== state.context.workspaceId) return null;
  return {
    memberId: state.principal.id,
    workspaceId: state.workspaceId,
    workflowId: state.detail.id,
    revision: state.detail.revision,
    graphDigest: state.detail.graphDigest
  };
}, [state.phase, state.busy, state.blocked, state.editor, state.confirmation,
    state.replay, state.historical, state.principal, state.context,
    state.detail, state.workspaceId, canRead]);
```

在原 `main` 的详情条件分支之外、现有末尾说明之前，始终且仅挂载一个实例：

```tsx
<ClientWorkflowExecutionPanel
  request={clientApi}
  scope={executionScope}
  onWorkflowChanged={() => {
    const current = store.getSnapshot();
    if (current.detail) void store.openDetail(current.detail.id);
  }}
/>
```

禁止 `key`、条件挂载、用切换视图卸载组件来丢弃原请求锁。原页面路由、PageHeading、AntD/adminTheme、编辑器和复杂图均保留；失败 409 后从原宿主“重新读取当前草稿”获取新 scope。父刷新会暂传 null，保留组件内部原不透明锁；重新可见时没有自动读取、POST 或重试。组件独立“仅验证已有执行的读取访问”不调用 publication/preview，允许这两个服务不可用时继续按独立结果权限手动 GET。

## 精确 ESLint parser/plugin 配对

Worker 未改全局配置。冻结来源的 `eslint.config.mjs` 已对 Python 声明配置了 `scriptDeclarationParser = nextVitals.find(config => config.name === "next/typescript")`；新 `.d.mts` 需要同一原 Next parser/plugin 对，不能和 root `typescript-eslint` 的另一个 plugin 对象叠加。

总控保留全部既有规则和其他声明文件处理，只对新文件做以下接线：

```js
const workflowDeclarationFile = "apps/web/app/components/client-workflow-execution-state.d.mts";
// 在 scopedTypeScript 的 typescript-eslint/base 配置 ignores 中追加 workflowDeclarationFile。
// 在 ...scopedNextVitals 后，与既有 scriptDeclarationParser 覆盖并列：
{ ...scriptDeclarationParser, files: [workflowDeclarationFile] },
```

不要修改规则、替换全局 parser、升级依赖或对全部 `.mts` 放宽忽略。Worker 的 ignored `.artifacts/af217-eslint.config.mjs` 仅从本工作区原配置增加这个新文件常量、base ignores 项及同一个 parser/plugin 覆盖；定向四文件 lint 已 PASS。这个临时投影不是正式 root gate。

## 注册门禁和真实证据（全为总控待运行）

Worker units 使用实际 compiled public SDK + 实际状态控制器，synthetic transport 仅证明前端状态逻辑。总控拥有原测试 owner、registry、队列、全局配置、模块/barrel/schema、PG/HTTP/Job/上游及 native 验收；本候选未更改任何这些文件。

1. 注册并完整运行 AF-217 的实际 `pnpm verify:task -- AF-217`（已读原 runner.parseArguments，任务名必须包含连字符），包含新增 units、宿主接线、正式 lint/types 与所需原服务测试；本条是待办，不是声称已存在或通过的注册门禁。记录真实 I-* Task ID，不用本候选 Task 冒充集成依赖。
2. 真实当前 session / 独立目标 PG / 原 HTTP：确认授权与拒绝、64hex sessionGeneration 更换、角色/权限/成员/空间/头 revision 与 digest 漂移。publication 读只需 assets.read；发布按原 manage+workflows.publish；预览/提交按 assets.read+ai.execute+workflows.execute；结果独立按 assets.read+ai.read+workflows.execute。
3. 原单 Agent 发布/取消发布 CAS、批准 inputFields、预算估计和配置；复杂草稿原图、历史版本及旧 Run 引用不改。default-off 时禁止新提交，仍实际尝试获授权的已有结果 GET；publication/preview 503 时通过独立验证入口读取旧 Run。
4. 真实原 Run/Job/预算 owner 与自有上游，模拟提交已到达但回复未知、4xx/503/超时、publication 丢失回复。必须确认恢复始终原键 GET、没有自动 POST/轮询、新键、额外 Run/Job/预算账本；unknown/reserved 持续锁定，原键终态且 settled/released 后由用户单独结束。publication 未确认只读原 head+publication，再单独当前授权 ack，无伪造 mutation-key endpoint。
5. Desktop + 390px：键盘 Tab/Enter/Escape、显式确认与取消零写入、焦点可见与恢复、长引用和 JSON 换行、消息可读、已有结果读权限与默认关闭路径。使用真实 OS/tab 切换产生 document.hidden/blur，验证内容实际清空、恢复不自动 POST、晚到响应和卸载不泄漏；禁止 synthetic visibility/focus 或 DOM/property/event 注入冒充验收。
6. 正式 gate 全部通过后由总控记录自查、执行记录/队列及精确原名提交并完成真实 I-* Task；候选和本地 units 不改变 owner PENDING、vendor DEFERRED_NOT_PASSED 或40个 NOT_RUN_TARGET_ACCEPTANCE。

原 SDK 目前接受的 Run 状态为 queued/running/succeeded/failed/unknown，未提供取消方法，也拒绝自行拼出的 cancelled response。候选只将 succeeded/failed/cancelled 与 settled/released 的交集识别为可结束的终态；不修改 SDK、不伪造 cancelled 数据、不新增取消能力。所有实际费用/用量未报告就明确未报告；只按原纳诺值格式化预算估计。

## Writer 停止与预算

完整命令、退出结果与未运行项见候选执行记录。总控应在本次候选 worker_done 确认后接收，Writer 此后 STOP ALL WRITING；任何修复需要新的明确交接。Worker cap 1.5h，AF217 连总控总 cap 4h；本轮 worker 时间按记录上界扣除，剩余预算包含真实集成、修复和门禁，不能另起计时。
