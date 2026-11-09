# AF-207 候选交付：提供个人工作流执行API与公共SDK

状态：CANDIDATE_ONLY，非 CODE_VERIFIED，非 Owner 接收。Task `task_9795c1250c4a` / Dispatch `ctx_264b27d5c868`；Writer terminal `term_235e6d6d-8bd9-4b95-9920-a9e664e02b2a`。无子代理。

## 来源与独立工作区

- Orca registered Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W18-AF207`；instance `0712b9ae-e7ea-4095-a2fa-afe1ed8236fe`，baseRef refs/remotes/origin/dev。
- Branch `weiyang86/AIJ-W18-AF207`，first HEAD / verified origin/dev `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，初始 status clean；remote `git@github.com:weiyang86/aij-foundation.git`。
- 只读核对 main root 当前 AGENTS 与固定 W18 CONTRACT。manifest SHA256 `a1315d50f341bdf17ea202aa3626035523598ce6188004c61301a15386e39bc0`；885 blobs 全部以 `git show 2ee9172a30be7694dc2cb097a43fbce1f0a14e65:path` 逐字节 SHA256 核对后落地，只添加 manifest.files；未读取其他 Worker 候选或复制 root dirty AF203/AF191。
- 独立 source-only commit `03e42d794d0bc177ffaf1b91778006d379ebb9e8`，标题 `W18 verified source-only bootstrap`。Root 只接收该 bootstrap 之后六文件 candidate delta，不接收 bootstrap。
- 当前候选提交标题为 `提供个人工作流执行API与公共SDK`，其最终 SHA 在 Worker 交接消息中给出（本文属于该提交，不能循环内嵌自身 SHA）。
- pnpm frozen install 使用本 Worktree 私有 node_modules，未共享其他目录依赖、env、uploads；schema-only generate 不连接数据库，不载入 env。

## 实际变化与影响

六个允许路径：

1. `apps/api/src/plugins/aij-ai/ai-personal-workflow-execution.controller.ts`：七个独立路由与精确权限/HTTP 状态码，原 Guard principal 与 claims.sub 绑定、原认证事务闭包、原 Origin/CSRF、原执行开关、严格 query/body、早期 private/no-store/nosniff middleware 与 UTF8/duplicate-key/size/nonfinite parser hook；结构化抽象发布/run 端口，不导入 A/B 候选。
2. `apps/api/src/plugins/aij-ai/ai-personal-workflow-execution.dto.ts`：原资产 ID 验证器、UUID publication、revision/epoch 界限、原输入字段/值/20字段限制、精确 key/accessor/prototype 拒绝与固定错误。
3. `packages/sdk/src/personal-workflow-execution.ts`：七方法，原 ClientApi 单 transport，signal；严格双向 JSON 形状、原 Run 状态/预算状态、personal:agentId 来源一致性、请求身份、CAS 回应、ISO/decimal/digest/epoch/ID 校验；显式 key GET 恢复，不重试、不储存、不日志。
4. `scripts/verification/personal-workflow-execution-sdk.test.mjs`：实际实现的 ESM/CJS、严格 TS、原 Guard/ClientApi、真实 Readable/Web stream 路径及小协作者验证。
5. `docs/planning/auto-ai-program-20261105/W18/AF-207-ROOT_WIRING.md`：真实 owner useExisting/module、原 parser hook、权限 registry、SDK index、后续验收要求。
6. 本记录。

未修改数据库/schema/migrations、原 runtime、共享依赖、SDK index、module、permissions、正式 queue/registry/state；没有页面或日志变更。真实运行/预算/Job/Trace/输出仍由原 owner 保有。未启动 server/browser/Docker；无实际访问地址。没有真实凭据或 vendor 成功证据。

## 命令与结果

最终运行的全部所需 Worker 检查：

| 命令 | 结果 |
|---|---|
| manifest hash + 885 次 git show/SHA256/精确落地 + source-only commit | exit 0 |
| pnpm install --frozen-lockfile | exit 0，800 packages，独立依赖 |
| pnpm --filter @aij/api exec prisma generate --config prisma.config.mjs | exit 0，仅 schema generation |
| pnpm --filter @aij/contracts build | exit 0，小包 |
| pnpm --filter @aij/sdk build | exit 0，旧 index 小包回归；新模块 index 导出由 root 处理，因此不冒充新模块已在打包产物中 |
| node --test scripts/verification/personal-workflow-execution-sdk.test.mjs | exit 0，15/15，0 skipped，含新 SDK strict NodeNext 和新 API/DTO strict decorators 类型检查 |
| pnpm exec eslint apps/api/src/plugins/aij-ai/ai-personal-workflow-execution.controller.ts apps/api/src/plugins/aij-ai/ai-personal-workflow-execution.dto.ts packages/sdk/src/personal-workflow-execution.ts scripts/verification/personal-workflow-execution-sdk.test.mjs --max-warnings=0 | exit 0 |
| git diff --check / staged diff check | exit 0 |

小协作者明确不是 PostgreSQL/provider/真实 HTTP 或安装包验收：TS transpile 新 SDK ESM+CJS，编译 strict TS；实际原 ClientApi 使用 fetch collaborator 返回真实 Web ReadableStream；原 parser hook 消费真实分块 Readable 的字节。验证成功、当前 principal/claims/session 闭包、跨产品 JWT 拒绝、权限 decorator、Origin、开关关闭、未知字段/访问器/原型/界限、重复转义 key/UTF8/超长/非有限、身份/epoch/decimal/ISO/status 错误及 unknown/network/503 不重试、显式 GET 恢复。

开发中失败如实记录，均已修正并新鲜重跑：初次两个 SDK 断言误写预期请求数 27（实际正确 26）；首轮 lint 的测试未用解构变量/getter 返回；独立 API 编译脚本误指不存在的 apps/api/node_modules/@types（实际 pnpm hoisted 在本 WT root）；原 transport 测试最初漏原 success envelope.message；原 Guard collaborator 最初用了非 JWT 三段格式 cookie。以上均没有跳过/放宽生产校验。Git 对共享 object store 内既存 AppleDouble `._pack-*.idx` 输出 non-monotonic index 诊断，但 git show/hash/add/commit/status exit 0；未修改对象库或隐藏诊断。

## 未运行、依赖与交接

NOT_RUN（按派工边界）：root verify:task、DB/migration/seed/PG、真实运行 owner/provider HTTP、并发/ABA/撤权/lease/settlement/cleanup/audit rollback、API/Next 重构建、全量 lint/regressions、outside installed tarball ESM/CJS strict consumers、browser/native/Linux/vendor。全40/native14不通过或不推定，External `DEFERRED_NOT_PASSED`；真实凭据为空。

Root 按真实 I205→I206→I207 依赖集成；I161 task_5731129d1d35、I170 task_5943982f67fa、I189 task_47a05b50c759 已完成，不把 AF203 原生 pending 当本后端 CODE 依赖。人工验收与 root 具体操作见 ROOT_WIRING：完成 owner/module/parser/permissions/index 接线，使用当前会话发布→preview→提交→read/recover，并检验撤权/新合法会话恢复、未知不重试与严格 HTTP 拒绝路径。没有部署/发布/push 或远端 Issue/PR 行为。

本次约 0.20 有效工程小时 / 0.20 elapsed 小时（约 08:13–08:25 CST），低于 Worker 2.25h 上限。完成候选本地 commit 后明确 STOP ALL WRITING 并交回 Writer；只有 root 可接线、正式验证与接收，本候选不更新任何正式任务状态。
