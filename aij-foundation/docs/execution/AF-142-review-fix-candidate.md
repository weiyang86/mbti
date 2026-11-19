# AF-142 F1/F2 审核退回修订候选

状态：**CANDIDATE / ROOT_HTTP_BROWSER_NOT_RUN / OWNER_CHECK_PENDING**。审核发现是修订输入，原补充脚本和本轮纯测试均不等于产品验收通过。

## 本次派工与工时

- Task `task_593831b2f392`，Dispatch `ctx_945e17119075`，terminal `term_ef1bbaa3-70e3-430c-b158-c13cd96177ec`。
- Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W02-AF142`，instance `8b422a98-8b7e-49fe-b82c-9ef9ede94d46`。
- 开工干净，分支 `weiyang86/AIJ-W02-AF142`，HEAD `18b672927c0bd792e1f4368decdd42a3f915890b`；remote fetch/push `git@github.com:weiyang86/aij-foundation.git`。没有切分支、push 或根工作区写入。
- 读取固定 `1641e636` 审核报告及 repro，未修改/重跑该固定旧树的反例作为“新产品结果”：`/Users/lei/orca/workspaces/aij-foundation/AIJ-W02-UI-REVIEW/.artifacts/auto-ai-program-20261105/UI-REVIEW/{report.md,repro.mjs}`。三条触发路径在本卡实际状态模块测试中加入修复后回归。
- 工时估计：原实现 0.8h、验收准备 0.7h；本轮读证据/设计约 0.15h、修订约 0.35h、回归/自查/交接约 0.25h，总约 **0.75h**，累计约 **2.25h**，给总控正式构建/DB/浏览器保留约 **1.25h**。这些是有效工程工时估计，不是运行计时器数据；原卡硬上限仍 3.5h。

## F1 实际修复与恢复边界

`client-ai-workbench-state.mjs` 内新增最小恢复 journal，不增模块、不改 SDK/后端/账本。真实页面始终注入 lazy localStorage 和 Web Locks；未注入存储的纯测试实例只使用实例内记录，不代表真实页面的持久化。

1. 只有 `/client/auth/me` 得到有效 member ID、`/client/workspaces/context` 返回匹配的空间后，才载入相应成员/空间记录。记录不授予权限；现有 can/服务端权限验证不变。
2. POST 前，先在同一成员的 Web Lock 内保存最小记录。字段严格限定 `memberId/workspaceId/agentCode/key/digest/runId/status`；digest 是实际 `{agentCode, 排序后的同一 input}` 的 SHA-256。没有 Token、Cookie、密码、prompt、input 或 output 持久化。对账更新、400拒绝后的清除也使用同一锁；迟到响应不能覆盖另一页面的新 key。
3. 空间切换/重新验证不会删除未决记录。原输入可在当前实例内存中按同一成员/空间保留；返回原空间只能同键、同参数确认。未知/queued/running 的已知 runId 保留为引用，重新验证后不伪造已读取结果，而显示“读取原任务”，新提交和 newTask 都受状态模块保护，不靠禁一个按钮。
4. pagehide/卸载丢弃内存私有输入，但持久标识/摘要保留。新实例或 BFCache 恢复仍先验证真实身份/空间。无 runId 的未确认请求要求重新填写完全相同的输入，摘要不匹配就不 POST、不生成新 key；匹配才用原 key 确认。已知 unknown 只能读原引用，不能通过刷新或空间切换解除。
5. 只有已绑定原 key 的 POST 结果，或原 runId 的有效终态读取，才能解除对应记录。GET 不含 idempotencyKey，因此读取任意“成功任务”不能解除一个尚无 runId 的未确认请求。另一个成员或空间没有继承其原输入/记录；401/403 清理私有内存，opaque 保护保留，回到原账号仍须重新验证。
6. 存储读取/格式/写入失败、Web Lock 不可用时，阻断新提交；不清记录、不退回新 key。没有自动超时删除 unknown 的保护，没有清 journal 的绕过按钮。当前页面使用支持 localStorage、Web Locks 和 Web Crypto 的安全上下文；不支持时按保守阻断处理，真实浏览器能力仍须总控验证。

**尚无契约、但本卡已安全阻断的情况：**原输入丢失且用户无法准确重填，或原 Agent/schema 已不允许重填，且没有原任务编号；现有接口没有按幂等键只读定位任务的能力。unknown/过期引用也没有“证明可以安全解除保护”的接口。本卡不会凭404/410、文案确认或本地取消推断上游未执行，仍保持新 key 阻断。

建议最小后端/SDK另卡：复用现有 AiAgentRun owner，为服务端已验证的 member+workspace 提供按 opaque idempotency key **只读解析原任务引用/状态**的端点与 SDK；不提交执行、不返回私有输入、不允许查询别人成员/空间。另定义缺失/已清理/unknown 的安全结论与人工核对流程，unknown 不得自动变 failed 或据此释放预算。该接口及对账流程本轮**未实现、未授权改共享文件**；当前安全阻断已闭合，便利恢复尚未闭合，不伪造可恢复。

## F2 实际修复

- 读取收到404/410后，立即将缓存 `run.output`、`imageAssetId`、`imageBlob` 清空，设置独立 `contentUnavailable=true`；401/403仍清完整授权、输入与结果。
- `readRun` 重试开始虽清临时 issue，但不会清 `contentUnavailable`。组件按该独立标记决定内容可见性；pending、网络故障或无效响应均不能使旧内容复活。
- 只有当前 scope 内、模型校验成功的新 GET/提交结果才清标记。过期图片同样清除，旧 scope/401/图片请求仍由 AbortSignal+generation 拒绝；没有降低原权限或取消保护。

## 实际验证

| 命令 | 退出与结果 |
| --- | --- |
| `node --test scripts/verification/client-ai-workbench.test.mjs` | **0；42 tests / 42 pass / 0 fail / 0 skipped** |
| `pnpm exec eslint apps/web/app/components/client-ai-workbench.tsx apps/web/app/components/client-ai-workbench-state.mjs scripts/verification/client-ai-workbench.test.mjs --max-warnings=0` | 0 |
| `pnpm exec eslint apps/web/app/components/client-ai-workbench-state.d.mts --parser @typescript-eslint/parser --no-inline-config --max-warnings=0` | 0；保留原声明 parser 兼容验证 |
| 原候选报告的源码导入图 noEmit 命令（相同三个入口/SDK/contracts/UI source paths） | **0；860 files / 0 diagnostics** |
| `node --check apps/web/app/components/client-ai-workbench-state.mjs` | 0 |
| 两个原 root-only live 脚本各 `node --check` | 0；仅语法，不执行 |
| `git diff --cached --check`（提交前） | 0 |

新回归直接调用真实状态模块与内存转译真实 SDK；不是字符串镜像。覆盖 F1 未确认 A→B→A 同键、unknown 重新验证不重发、F2 成功→410→pending不复活→新有效结果恢复、刷新摘要校验/同键恢复、仅opaque字段存储、unknown 跨实例保留、成员/空间隔离、pagehide丢私有输入但保留键、无关成功任务不能解除原保护、存储/锁失败阻断、双实例共锁不造第二键、404及无效响应不复活。原有成功/拒绝/旧 scope/401/图片/轮询用例仍通过。

初次接入异步 SHA-256 后原测试为26/28：两个旧竞态测试在请求真正发出前立即断言 POST 数量，新增“等待实际请求开始”后保留其原取消/同键断言，28/28；追加修复回归后42/42。此为测试时序适配记录，没有把失败掩盖为HTTP通过。lint 的既有 Next pages 路径提示仍存在，退出0，无规则告警。

**NOT_RUN：**verify:task、build、DB/迁移/seed、服务/真实HTTP、新 live suite、浏览器/DOM/Web Locks/localStorage/BFCache实际行为、真实厂商/费用。未启动可访问地址。没有把纯测试、审核报告、合成 helper 或静态类型检查当作产品/负责人通过。

## 总控验收与精确交接

root 接收停写后精确集成，继续独占共享注册、正式验证、DB和构建；两个 live helper 本轮未改，原 root-only准备/close说明继续适用。浏览器重点：

1. 当前 fixture 的同一成员空间A提交丢响应，A→B→A后只允许原 key 确认；同一个浏览器重新加载后不保存原 prompt，重填不同内容不发POST，重填一致仍是旧key。
2. unknown 后点重新验证、换空间再回来、页面刷新/离开再打开，都能看到原 runId 引用，不能通过按钮或表单回车新建 key；只读原任务不自动执行。测试时不要用清 localStorage 来绕开此路径。
3. 成功私有文本→410/404→延迟重读的整个 pending 窗口没有旧文本/图片；新的有效结果才恢复。检查原有晚到401、跨空间图片、权限降级及卸载取消。
4. 同一空间开两个页；同一未决请求不会造两个 key。禁用/破坏本卡合成账号的恢复存储或 Web Lock 时应阻断，而非放行。不要删除真实用户数据/凭据。

从原始 `94b0236f775fa40a07944c5e0545ac6ce0e123f3` 到最终候选总计恰好 **11 路径**：

```text
apps/web/app/client/page.tsx
apps/web/app/client/ai/page.tsx
apps/web/app/components/client-ai-workbench.tsx
apps/web/app/components/client-ai-workbench-state.mjs
apps/web/app/components/client-ai-workbench-state.d.mts
scripts/verification/client-ai-workbench.test.mjs
scripts/verification/client-ai-workbench-live.mjs
scripts/verification/client-ai-workbench-live.test.mjs
docs/execution/AF-142-candidate.md
docs/execution/AF-142-live-candidate.md
docs/execution/AF-142-review-fix-candidate.md
```

本轮仅四个产品/状态/测试文件、两个旧报告指向和本报告；无共享依赖/后端/Schema/SDK/全局CSS/正式队列/registry改动。候选完整 commit SHA、tree SHA 在最终交接消息中给出，可用 `git rev-parse HEAD HEAD^{tree}` 复核，不把自引用 SHA 写入树内报告。

提交标题继续逐字 **提供个人用户通用AI任务工作台**，正文注明 AF-142 F1/F2 修订；无 push/PR/merge/main/tag/部署。**提交完成后，本 Writer 停止本卡所有代码、测试、文档写入并交回 root；负责人接收仍 PENDING。** 若剩余正式验证预计超过保留预算，先保留本候选并拆验收卡，不降低门禁或伪造完成。
