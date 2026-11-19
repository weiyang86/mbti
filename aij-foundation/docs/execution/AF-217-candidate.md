# AF-217 候选执行记录

任务名称：提供个人工作流发布与手动执行页面。状态：CANDIDATE / NOT_CODE_VERIFIED / ROOT_WIRING_AND_REAL_GATES_NOT_RUN；不是负责人验收，也不是 CODE_VERIFIED。

## 实际身份、来源与差异

- 日期：2026-11-08 Asia/Shanghai；保守起始时刻以注册 Worktree 创建时间 01:48:24 +08 为界，覆盖派工后的身份/技能/合同读取、bootstrap、安装、实现、校验及记录。本轮 worker 有效工程耗时保守记 **0.50h 上界**，最终停止不晚于 02:18:24 +08；未使用 helper/subagent。AF217 总卡4h剩余最多3.50h（包括总控接收、接线、真实门禁与修复），worker自身1.5h上限未超。
- Task `task_f13743945dc6` / Dispatch `ctx_60a0c733cd63`；terminal `term_bf6aabaa-736d-47f0-9bed-27717222ceb7`。
- Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W21-AF217`；instance `45fb62ee-c79a-4418-a93b-cba421ca5325`；分支 `weiyang86/AIJ-W21-AF217`，初始 clean。
- 初始 HEAD 与 origin/dev 均 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；remote `git@github.com:weiyang86/aij-foundation.git`；已用 Orca 发出 initial read-only identity，messageId `msg_20f07535e989`。
- 只读 root CONTRACT SHA256 `038af86823af97bd7650f8d3dd3cf91b55d04d4f84c38eacadac954924829614`、SOURCE_BOOTSTRAP SHA256 `b17b864c7587471a2ed98507429f0c019d4f0f9ef70502d54fd71939745a82b5` 均匹配。
- 固定来源 `f0e12d76b0c2c5dccf4d1c56369019e979e52902`，逐个 `git show` 验证1009源blob的 SHA256，再逐个验证落盘内容。独立 bootstrap `2a8c159e26938fb13911a194e5ef463bae4c46b6` / `W21 verified source-only bootstrap`，随后 `git cat-file --batch` 再验证1009个已提交blob；514个变化路径全部属于manifest，无清单外变化。
- 只新增六个 allowPaths：执行 panel、RAM 状态 `.mjs` 与声明 `.d.mts`、状态 units、本记录及 `docs/planning/auto-ai-program-20261105/W21/AF-217-ROOT_WIRING.md`。候选标题 `提供个人工作流发布与手动执行页面`，候选确切 SHA 在完成后 Git 回读与 worker_done 中报告，避免自引用提交哈希。

## 实现与影响

`ClientWorkflowExecutionPanel({request,scope,onWorkflowChanged})` 使用既有 AntD/adminTheme/PageHeading 与原公开 SDK 七方法、原 workflows.get。显式读取当前发布、发布/取消发布确认与 CAS、预览原发布输入/预算/配置、手动严格平面字符串 JSON、一个不透明键的一次提交、手动原 Run GET 及同键恢复；独立访问验证使原发布/预览故障不阻挡原结果权限的读取尝试。无自动读取、POST、重试、轮询、发布或启用。

每次网络操作前后以原 me/context、真实64hex sessionGeneration、全部角色/权限、原 workflow head revision/digest、prop scope、generation 与 bounded AbortSignal 做围栏。尝试过的 publication POST 无论哪种错误均保留 opaque lock，必须原 head+publication 读取后另行当前授权 ack；run POST 保留原键/publication直到原键 GET 确认终态和预算settled/released，再单独显式结束。失焦/隐藏/null/换身份或头漂移清除私有字段并取消晚到工作，只在RAM留原不透明归属和恢复标识。

数据库：零 schema/migrate/seed/DB 操作。接口：零新增接口或 SDK export；只调用原 owner。页面：候选子组件已完成，原页面**未挂载**，待总控接线。权限：零新增或修改权限；保留发布/新执行/结果读取独立权限。日志/存储：无 body 日志、浏览器持久化、私有 URL 或 HTML 插入。复杂草稿不改写，不声称多步骤可执行；费用只展示原估计，未报告实际用量/费用不推算。

应用技能：`/Users/lei/.agents/skills/orchestration/SKILL.md`、`orca-cli/SKILL.md` 与 `frontend-design-review/SKILL.md`。前端自查遵循既有组件与样式，使用可换行的单列详情、带label/aria的控件、原 AntD Modal 与键盘取消、明确权限/错误及 AI 内容提示；未访问或声称 Figma、浏览器或独立 Review。

## 实际命令与结果

所有命令在独立子 Worktree，Node `v24.21.0` / pnpm `10.0.0`，未改 CLI/model。

| 命令/检查 | 实际结果 |
| --- | --- |
| `git status --short --branch` / `git rev-parse HEAD` / `git remote -v` / `orca worktree show --worktree current --json` | exit0；身份如上，初始clean并注册 |
| `shasum -a 256 <root CONTRACT> <root SOURCE_BOOTSTRAP>` | exit0；两哈希匹配 |
| Python逐路径 `git show <source>:<path>` + SHA256前后校验，再精确 `git add -- <1009 paths>` | exit0；1009/1009校验成功 |
| `git commit -m 'W21 verified source-only bootstrap'` | exit0；SHA如上 |
| Python `git cat-file --batch` 校验bootstrap1009blob + 初始到bootstrap路径集合审计 | exit0；1009/1009匹配，514变化路径，无清单外路径 |
| `pnpm install --frozen-lockfile --ignore-scripts --store-dir .artifacts/af217-pnpm-store` | exit0，2m9.6s；私有store/node_modules，不共享或复制原根凭据、env、上传目录 |
| `pnpm --filter @aij/contracts build && pnpm --filter @aij/sdk build && pnpm --filter @aij/ui build` | exit0；只构建独立小包，未构建API或Next |
| `node --test scripts/verification/client-workflow-execution-state.test.mjs` | exit0；28/28 PASS，0失败/跳过，synthetic transport + 实际compiled public SDK + 实际状态控制器 |
| `pnpm --filter @aij/web typecheck` | exit0；实际Web tsc，无构建/服务器 |
| `pnpm exec eslint --config .artifacts/af217-eslint.config.mjs apps/web/app/components/client-workflow-execution-panel.tsx apps/web/app/components/client-workflow-execution-state.mjs apps/web/app/components/client-workflow-execution-state.d.mts scripts/verification/client-workflow-execution-state.test.mjs --max-warnings=0` | exit0；原Next parser/plugin匹配投影，保留全部规则，未改全局配置/依赖/规则 |

定向 units 覆盖：未知/缺失输入键、错误/重复解码键/原型键/嵌套/Unicode/长度；发布确认取消零写入、准确CAS与epoch/head漂移；复杂草稿保留；默认关闭/发布预览503独立结果读；一次键/一次POST；所有4xx和未知提交保锁、原键GET终态与预算释放；另读Run不能当作原键证明；同属/跨属scope与session/role/permission/member/workspace围栏；写入后及读取后的晚到撤权；null/失焦/hidden统一 suspend边界与uncooperative晚答复；超时；未知响应键；明确错误消息。真实隐藏/native布局没有用这些 units 冒充。

共享Git对象库读取存在既有 `non-monotonic index .../.git/objects/pack/._pack-f03e767c944ca97bc7cba847811aab0e60e02cb8.idx` 的重复警告。上述读取/哈希/提交均成功；未改、删或修复共享Git元数据。初次身份消息尝试使用 CLI 不支持的 `--type report` 返回exit1；按 CLI 实际枚举改为 `--type status` 后exit0且有真实messageId，未重复成功发送。

## NOT_RUN 与下一步

正式root `pnpm verify:task -- AF-217` / registry gate、root全局lint接线、真实PG/HTTP/current-session/Job/owned-upstream正反路径、defaultoff真实读、未知响应同键/无额外Run、desktop390/键盘/真实hidden/late-response/unmount 均 **NOT_RUN**。未运行 schema generate（本纯Web候选不需要）、DB/migrate/seed/Docker/server/GUI/full API/Next/root verify/vendor。未推送、PR、merge、main、tag、部署或发布；40个目标仍 NOT_RUN_TARGET_ACCEPTANCE，vendor DEFERRED_NOT_PASSED，owner PENDING。

地址：没有启动服务，不能声称任何URL已可访问。人工验收、准确原宿主挂载、`.d.mts`原Next parser配对及总控实测清单见 `AF-217-ROOT_WIRING.md`。下一依赖是总控精确接收候选、真实root接线和注册门禁，完成真实I-*集成Task后才能由下游引用；本Task不冒充I-*或CODE_VERIFIED。

Writer交接：精确原名候选提交并回读后立即 **STOP ALL WRITING**，再发送一次实际Task/Dispatch的worker_done；交接后不编辑、不自动续卡。总控应只接收上述六文件delta；若真实门禁失败须明确新交接，不能将本候选视为已验收。
