# AF-228 候选执行记录

任务原标题：接入章节生成与原运行时任务来源绑定。状态：**Candidate 已交付，非 CODE_VERIFIED，root 接线与真实验收 NOT_RUN**；Writer 自查不是独立复核，未等待 Trea。

## 身份、基线与来源

| 项目 | 实际值 |
| --- | --- |
| Task | task_8f375db3b184 |
| Dispatch | ctx_3de455fe1fa9 |
| terminal | term_8140dcd5-d697-4969-8c05-9f85cc2538c2 |
| coordinator terminal | term_26cef18e-31e9-4c43-8f62-bd8db5c92ea5 |
| Worktree | ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W24-AF228 |
| branch | weiyang86/AIJ-W24-AF228 |
| 初始 status | clean |
| 初始 HEAD / origin/dev | 94b0236f775fa40a07944c5e0545ac6ce0e123f3 |
| remote fetch/push | git@github.com:weiyang86/aij-foundation.git |
| 冻结源码 SHA | 165338eb41eca99d3b779964a7e9f73f402a0d23 |
| SOURCE_BOOTSTRAP.json SHA256 | ccc1f0f9fa3c950debb65ed2eb0954ebf57523d07281b8aef191c736fbc088db |
| source-only bootstrap SHA | 0ff64b57bfe4f3f7079b43856db519f7152a0f72 |
| candidate SHA | 本文件所在候选提交；最终 worker_done 回执提供实际完整 SHA，不能把 bootstrap SHA 当 candidate |

已先完整读 root W24/CONTRACT.md；只从 root 读取此契约和 SOURCE_BOOTSTRAP.json，未读 live root 源码/真实 env/用户原型。Python 对清单 1085 路径逐个执行冻结 `git ls-tree` / `git show commit:path`，核对 mode、blob OID、bytes、SHA256，恢复后再核对落盘 SHA256/模式，退出 0；无删除路径，独立 source-only 提交，未 merge/cherry-pick root 整段历史。初始身份回执已送达 msg_017215801d0a。

bootstrap/Git 命令输出有共享 object pack 目录的 AppleDouble `._pack-…idx` non-monotonic index 诊断；命令均成功退出且 1085 逐 blob 校验通过，未修改该共享目录。此诊断保留为环境观察，不将其改写为无诊断。第一次身份回执误用不支持的 type=message，exit 1；更正 type=status 后 exit 0，未重复成功发送。

## 实际差异与 owner 边界

本卡 delta 只新增四个 allowPaths：

- `apps/api/src/plugins/aij-ai/ai-personal-document-run-origin.service.ts`：冻结结构类型/abstract ports、严格 selector/ref/marker/claims 解析、canonical raw-request hash、原 redaction owner 的 input digest、同 TX 必需 session callback、source admission 证据、原 Run 来源关系 INSERT + 小 audit、scope-first 关系检查、current read/execute 与清理后 metadata inspect、仅移除已知 marker 的 helper。
- `apps/api/test/personal-document-run-origin.test.ts`：27 项离线真实断言，使用明确的 document/session/SQL collaborators；未伪称其是 PG、原会话或运行时真实通过。
- `docs/planning/auto-ai-program-20261105/W24/AF-228-ROOT_WIRING.md`：root admission/pre/post IO/legacy/cleanup/DDL 与真实验收清单。
- 本执行记录。

读取冻结 Run/Memory/Agent snapshot/budget/session/document 源码理解原 owner；未复制权限/session SQL。只用已有 documentId/documentRevision 与 redactAiExternalText；未依赖 AF227 未来文件。未改 AiCenterRunService/provenance/module、schema/migrations/依赖/锁文件/正式 queue/registry/public barrel，也无 root dev 写入。候选不会启动执行器，不创建 Run/Job/Trace/reserve/settle，不重算费用，不自行开事务，不保存正文或 raw 指令副本。

潜在接线后影响：新增来源表 INSERT/SELECT 与一条 `personal_document_run_admitted` audit（只含文档 ID/revision/sectionId/Agent ID）；接口/权限行为由原 owner/root 接线生效，本候选没有注册 HTTP 页面或路由。port 缺失 503；marker/row 单缺、错 scope、digest/身份不一致拒绝；双缺 legacy noop。raw source/指令 UTF16 不截断、不归一化，SHA 对 UTF8；redacted input 扩长时沿原 owner 存储语义，不误套 raw 2000 上限。unknown provenance 保留给原 owner deep comparison。

## 验证命令与真实结果

工作区自有 node_modules，`pnpm install --frozen-lockfile` exit 0（800 packages；未复制/链接 root node_modules，未变更 manifest/lock；pnpm 默认跳过依赖 build scripts 的警告保留）。

| 命令 | 最终 exit / 结果 |
| --- | --- |
| `node scripts/prisma-schema.mjs generate` | 0，schema-only；脚本白名单环境且仅 127.0.0.1:1 不可连接占位，未读 env/连接 DB |
| `pnpm --filter @aij/contracts build` | 0，小 contracts 包本地输出，未暂存产物 |
| `pnpm --filter @aij/api exec node --test -r ts-node/register test/personal-document-run-origin.test.ts` | 0，27/27 pass，0 fail/skip |
| `pnpm --filter @aij/api exec tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --skipLibCheck --strict src/plugins/aij-ai/ai-personal-document-run-origin.service.ts test/personal-document-run-origin.test.ts` | 0，isolated tsc |
| `pnpm exec eslint apps/api/src/plugins/aij-ai/ai-personal-document-run-origin.service.ts apps/api/test/personal-document-run-origin.test.ts --max-warnings=0` | 0 |
| `git diff --check` / 最终 `git diff --cached --check` | 0（最终暂存检查在提交前执行） |

失败与修复保留：首轮单元 exit 1，TS2741 测试 object spread 丢失 abstract class method 类型，改显式 inspect 方法后 22/22 pass；补充故障注入单元时 test exit 1、isolated tsc pnpm exit 1（底层 tsc exit 2），TS2352 fake audit Promise 与 Prisma thenable 类型不兼容，改显式 unknown cast 后最终 27/27 与 tsc/lint 全通过。没有把上述失败改写成从未失败。

覆盖：marker/row 双缺与单缺、crossscope 行和所有身份列、raw/ref/redacted digest、不同行为 raw 指令 key 域、exact same-TX callback/漏调/重复/异TX/未await/503、原与 fresh session 目的、inspect documentCurrent=false、真实 Date purge 与混合内容拒绝、purge 后 Run 身份、未知 provenance 保留、getter/symbol/hidden/proto/数组污染、不发生重复 INSERT 重试以及 INSERT/audit 故障向原 caller 传播。

NOT_RUN：全部 DB/seed/migrate/原 ClientAuthSession 真时钟锁/两连接并发/FK/trigger/immutable/事务回滚、真实 Run/Job/provider/Trace/费用/nonce 的成功与拒绝路径、全 API/Next build、root verify:task、Docker/native、外部付费服务。无 API/Web 进程、无访问 URL、无页面验收承诺。离线故障测试仅证明错误传播，不证明 PG rollback。

## 接收、后续与工时

root 从 bootstrap 到候选提交的四文件 delta 精确集成，不整段接收 bootstrap 历史；薄 adapter/session useExisting/原 Run constructor/provenance/admission/dispatch/read/recover/legacy/cleanup/schema/module 都由 root 独写，详见 ROOT_WIRING。root 接收后在受保护 55433 新逻辑库串行真验、verify:task 与适用门禁通过后才完成 I228/给 I229 原 runtime driver；无 push/main/远端 Issue/PR/发布授权，本候选不操作它们。原 W23 人工验收 pending 保持。

本候选时段自 2026-11-09 00:00 左右注册派工起，工具实测核验/实现/失败修复/自查约 0.25 有效工程小时（最终交接回执给出实际结束与总计），未触及 Worker 1.5h/整卡 3.75h 预算；没有分派子代理。人工接收建议先审来源/delta 与端口，随后只按 root 真实验收记录验证并确认 OWNER_CHECK_PENDING，不据候选自动接受。

**STOP ALL WRITING：此候选提交交接后 Writer 停止全部写入，root 可在明确交接后接线/修正；不自动续卡、不轮询 check。**
