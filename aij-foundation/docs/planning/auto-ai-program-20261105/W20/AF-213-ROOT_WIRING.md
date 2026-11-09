# AF-213 root wiring — candidate only

任务：提供个人Python Skill执行管理页面。Worker `task_a38b13e8889d` / Dispatch `ctx_97ba38a1c028` 只新增授权文件，没有改 Skill library、SDK barrel、权限 owner、registry、队列或共享源码。此文是总控接线说明，不能作为已挂载页面或 CODE_VERIFIED 证据。

## 原组件中的实际组合

在原 `apps/web/app/components/client-skill-library.tsx` 导入 `ClientPersonalScriptPanel`，在其 `<main>` 中**始终挂载一次**，放在 detail、权限、历史和编辑条件块以外。禁止 `key`、条件卸载、用重建 store 清除未知写入锁。原 `createSkillLibrary` 和原 `clientApi` 继续负责宿主，子面板调用原 `createPersonalScriptExecutionClient` 七个方法及原 `createPersonalSkillsClient.get`。

```tsx
const scriptScope = state.phase === "ready" && !state.busy &&
  !state.issue && !state.editor && !state.confirmation && !state.historical &&
  state.principal && state.context && state.detail && canRead
  ? {
      memberId: state.principal.id,
      workspaceId: state.context.workspaceId,
      skillId: state.detail.id,
      revision: state.detail.revision,
      name: state.detail.name,
      instructions: state.detail.instructions
    }
  : null;

// 永久保留这一实例；busy / 无详情 / 编辑 / 未保存 / 历史 / 撤权时传 null。
<ClientPersonalScriptPanel
  request={clientApi}
  scope={scriptScope}
  onSkillChanged={() => {
    const current = store.getSnapshot();
    if (current.detail) void store.openDetail(current.detail.id);
    else void store.refresh();
  }}
/>
```

新版本成功创建、未知版本写入被明确核对后，`onSkillChanged` 只要求父组件重新读取原 Skill 当前 head。父组件读取期间传 null；再出现时重新鉴权，只 GET，不写入。面板只保留相同 owner 的不透明版本 ID 作为手动读取选择；没有版本列表、版本请求键恢复接口，也不伪造这些接口。

## 授权与隐私约束

每个接口动作前后使用原 `/client/auth/me`、`/client/workspaces/context`、原 Skill GET，比对实际身份、workspaceCode、roleId、roleCode、权限集合和 scope 的 head/名称/指令。显式重新验证可建立新的权限基线，同时清除草稿。服务端会话仍由原 Session/Workspace guard 验证；原 `me` 只暴露 id/email/nickname，没有 sessionId，本卡不读取 cookie、不编造可比较的 sessionId。

| 动作 | 原权限组合 |
| --- | --- |
| 查看面板能力 / Skill head | `workspace.ai.assets.read` |
| 创建源码版本 | `workspace.ai.assets.manage` + `workspace.ai.scripts.manage` |
| 读取原源码 | `workspace.ai.assets.read` + `workspace.ai.scripts.manage` |
| 提交执行 | `workspace.ai.assets.read` + `workspace.ai.execute` + `workspace.ai.scripts.execute` |
| GET 恢复 / 执行状态 / 下载 | `workspace.ai.assets.read` + `workspace.ai.read` + `workspace.ai.scripts.execute` |

提交可使用手动填写的已知版本 ID，不要求源码管理权限；原服务端会核对当前 owner/head。源码管理权限不代替执行或结果读取权限。`configured=false` 阻止提交，仍允许当前授权的已有结果读取。显示原 capability 的 ready / not_configured / not_permitted，不提供管理员启用开关。

blur、hidden、pagehide、scope/request 变化、会话/角色/head 拒绝均清除源码、输入、输出、名称、Blob URL，取消原 signal 并用 epoch 隔离不响应 abort 的传输。scope 在 layout effect 中接收，render 同步隐藏不匹配 scope。仅保留未决原写入的 owner/请求键/版本与运行 ID 等不透明 RAM 记录；不同 owner 看不到原标识，锁仍阻止新写入。无 storage、URL query/hash、日志、持久化内容；不在测试或报告输出真实输入/结果。

未知版本创建只能读取原 Skill head，再单独明确确认，确认时再次鉴权与复检 head。未知执行始终按原 key GET；404/409/410、null、失焦、身份变化均不自动解锁。仅在原 key 再次返回可确认终态、且用户明确结束原请求时解除执行锁；UNKNOWN / CLEANUP_UNCONFIRMED 不解锁。关闭整页会丢失 RAM 恢复标识，UI 已说明，不能以关闭页面作为重放策略。

下载只接受原 SDK 校验后的 SUCCESS；每次点击都重新下载并复检授权，不提供可绕开鉴权的旧 Blob 链接。SDK 校验大小、严格 JSON、checksum、headers、来源；面板在消费后将返回 Uint8Array 清零，失焦/过期/撤权时撤销 URL。浏览器保存动作和实际沙箱下载验收须由总控验证。

## 总控需要完成的真实验证

原 CODE 依赖 `task_ac8e218b1859`，以及 W20 governance 的真实 I Task 必须由总控确认并登记。Worker 派工文本未列出 governance I 的实际 ID；本卡不自造、替换或完成它。本候选不满足 CODE_VERIFIED。

1. 精确接收候选提交的六个新增文件，不接收 bootstrap 463 文件差异。按上例在原 Skill library 固定挂载；保持原 AntD/adminTheme/PageHeading，不加全局样式或依赖。
2. 总控在 registry 注册真正 AF-213 检查与新增单测，核实原 I 依赖，执行 `pnpm verify:task AF-213` 与适用质量门禁。Worker 没有执行该命令，也没有更新正式队列。
3. 在总控核验的独立测试库、原服务/沙箱与真实浏览器验证：版本追加及 ref/digest；显式单次 POST；手动状态读取与原 key 恢复；成功 JSON 下载；未配置仍可读已有结果；管理/执行/结果权限独立；401/403/404/409/410；提交前后撤权/改 head；blur/hidden/null 后无迟到内容、无新键重放、无自动轮询；未知版本必须先复读 head 再确认；UNKNOWN/清理未确认仍锁定。
4. 特别检查父组件 busy/edit/history/null 切换没有卸载面板；桌面与窄屏字段 label、Tab/focus、Modal 返回检查和长 digest/JSON 换行。没有 Figma 对照或 GUI 验证声明。
5. 原 API/SDK 组合单测 `node --test scripts/verification/personal-script-api-sdk.test.mjs` 在 Worker 私有 ignore-scripts install 后因缺 `.prisma/client/default` 导入失败（exit 1，断言未运行）。由总控按原流程生成其私有 client 再验证；Worker 没有借用其他 node_modules 或生成/操作数据库。

真实数据库、Python/Docker、HTTP、GUI、原生下载、完整 API/Next build、root verify 均 NOT_RUN。本卡不改变历史 all40 `NOT_RUN_TARGET_ACCEPTANCE`、vendor `DEFERRED_NOT_PASSED`、owner `PENDING`；波次出口仍由总控汇总为 OWNER_CHECK_PENDING。
