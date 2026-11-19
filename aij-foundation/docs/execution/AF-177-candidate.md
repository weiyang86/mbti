# AF-177 Worker 候选交接

任务名称：**修复生产依赖严重漏洞并建立核验门禁**。状态：`CANDIDATE_READY_ROOT_INTEGRATION_REQUIRED`，不是 CODE_VERIFIED，不是生产 critical 已清零，不是负责人接收。

## 身份、来源与写入边界

| 字段 | 实际值 |
| --- | --- |
| Worktree | `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W11-AF177` |
| Orca instance | `e7afc186-fb97-402d-a9f0-dbe0cb77dee5` |
| Task / Dispatch | `task_50eeecfc6aaa` / `ctx_bbf620032c1d` |
| Worker terminal | `term_3e4029e6-41a1-46c0-8b9e-7cf52402a7dc` |
| Coordinator terminal | `term_a1b633bc-6ace-4602-868a-dc2c12c5849e` |
| Branch | `weiyang86/AIJ-W11-AF177` |
| 起始 HEAD / origin/dev | `94b0236f775fa40a07944c5e0545ac6ce0e123f3` / 同 SHA |
| Origin fetch/push | `git@github.com:weiyang86/aij-foundation.git` |
| 初始状态 | `git status --short --branch` 仅分支行，clean |
| 独立 bootstrap 提交 | `e71ed87c4fe59f5a352309bff3f116b1f5261b68` |
| 本卡候选提交 | 以 worker_done 的实际完整 SHA 及 `git log -1` 回读为准；提交标题逐字采用上述任务名称 |

已在 bootstrap、允许路径实现、自查修正、验证和提交写入阶段前回读 branch/HEAD/origin/status，命令输出与 `.artifacts/af-177/write-phase.json` 为证。没有遗留/用户差异，未启动其他 Writer 或 helper agent；原 dev 和轻企仓库没有写入、共享依赖或凭据复制。

bootstrap 的五个文件来自同仓库 `b7783dca67475a116e9a72a922fdba293e16cb57`，每个 blob 在写前验证指定 SHA-256，五个均一致；与起始树实际产生四个文件差异，Web manifest 原已相同。该提交仅恢复获授权的只读源码输入，不声称对应集成 Task 已完成或获得基线集成权限。之后五个 bootstrap 文件保持逐字节不变，验证记录在 `.artifacts/af-177/worker-verification.json`。

## 实际候选 diff 与诊断

仅六个 allowPaths 新增：

1. `scripts/verification/production-dependency-security.mjs`：pnpm 10 生产 audit JSON 严格解析、全部 advisory 计数/路径/退出码核验、安全报告；附本卡版本提案与原 dev gate 校验。
2. `scripts/verification/production-dependency-security.test.mjs`：公开合成 fixture、15 项离线测试，验证 critical 拒绝、未知包/ID、high 保留、坏计数/schema/重复键/error/网络、精确版本和兼容约束、CLI 出口及 root gate。
3. `scripts/verification/production-critical-dependencies-live.test.mjs`：供总控在原 dev 运行的真实生产审计测试，实际 pnpm audit、不接受注入命令/fixture、60 秒/8 MiB 上限、安全 artifact、保留 exit 1、输入文件/HEAD 防并发变动。
4. `docs/execution/AF-177-package-updates.json`：两处精确 pin 提案、五项 critical 一手公告、官方 registry integrity/engines/peers、相关传递闭包、剩余风险和 root-only 验收。
5. `docs/development/DEPENDENCY_SECURITY.md`：工具约定、官方来源、显式 gate 操作、负责人步骤和 acceptance 边界。
6. 本交接记录。

冻结锁的真实 `pnpm audit --prod --json` **exit 1**，复现 37 项：info 0 / low 2 / moderate 12 / high 18 / critical 5。安装前、独立 frozen 安装后、live 工具同形安全环境变量下均是相同结果；本卡没有将该退出码伪报为产品 PASS。5 项 critical 全在 `apps__web>next` 的 16.2.6，维护者修复门槛分别为 16.3.3、16.3.3、16.3.6、16.4.1、16.4.1。

精确提案为 **Next 16.2.6 → 16.4.1；eslint-config-next 16.2.6 → 16.4.1；overrides 空**。Next 16.4.1 稳定版官方发布日期为 2026-10-14；当前 latest 16.4.5 已记录，不把 minimum target 冒充 latest。Node ≥20.9.0、React ^19、ESLint ≥9 和 TypeScript ≥3.3.1 的相关声明均通过实际冻结 Node 24.21.0/pnpm 10.0.0 和 manifest/registry 元数据交叉检查。htmlparser2 10.1.0 保留；API、SDK 公共契约不改。来源链接、许可证声明、闭包变化及兼容风险见 [JSON 提案](AF-177-package-updates.json)和[指南](../development/DEPENDENCY_SECURITY.md)。

适用性不作 audit 豁免：Windows/AVIF/next/og/SVG/use cache 都保留在全量计数中。GHSA-2464 的 registry affected range 为 `>=16.0.0 <=16.4.0`，维护者文字为 `>16.0.0 <=16.4.0`；当前 16.2.6 同时落入两者，修复门槛均为 16.4.1，没有利用边界差异隐藏风险。

预计更新 Next 闭包后，原有闭包外仍可能留下 10 项（7 high、2 moderate、1 low），所有 affected paths/advisory URL 已逐项保存；实际 post-change 数量必须由总控审计确定，不预填成功。

## 验证结果与失败留痕

| 命令/检查 | 实际结果 | 证据 |
| --- | --- | --- |
| `pnpm audit --prod --json`，冻结生产基线 | exit 1，37 项/5 critical，预期诊断证据 | `.artifacts/af-177/audit-before.json`、`audit-before-process.json`、`audit-before-safe.json` |
| `pnpm install --frozen-lockfile --ignore-scripts` | exit 0，733 包，独立本 worktree node_modules，不跑 lifecycle；lock 未变 | 终端实际输出；逐 blob hash 再核验 |
| 安装后真实生产 audit | pnpm exit 1；修正后的 evaluator 正确保留 37 项及 installed paths | `.artifacts/af-177/audit-before-installed.json`、`audit-before-installed-safe.json` |
| live 同形安全 env 下真实冻结 audit | pnpm exit 1，`CRITICAL_PRESENT`，37 项 | `.artifacts/af-177/audit-before-controlled-env-safe.json` |
| `node --test scripts/verification/production-dependency-security.test.mjs` | exit 0，15/15，无 skip | `.artifacts/af-177/source-helper-tests.txt` |
| 三个脚本定向 ESLint `--max-warnings=0` | 最终 exit 0 | `.artifacts/af-177/target-eslint.txt` |
| 三个脚本 `node --check` | 全部 exit 0 | `.artifacts/af-177/syntax-*.txt` |
| 版本提案对真实 manifests/registry 元数据校验 | `PROPOSAL_COMPATIBILITY_CHECKED`，applied=false，productAcceptance=NOT_RUN | 实际执行输出；registry 快照 `.artifacts/af-177/registry-*.json` |
| bootstrap 五个 blob 内容/hash 核验 | 与批准来源逐字节相同 | `.artifacts/af-177/worker-verification.json` |
| `git diff --cached --check` | exit 0，无空白错误 | 最终提交阶段输出 |

两次开发阶段失败没有隐藏：首次 lint 的 `no-control-regex` 拒绝控制字符正则，已改用字符码检查；首次安装后实际 audit 的 evaluator 报 `AUDIT_SCHEMA_INVALID`，原因是 pnpm 将 findings.paths 扩充为 `. > name@version` 和 `apps/api > @scope/name@version`，已明确支持这两种安全格式并增加行为测试。修正后真实 37 项 audit 能完整评估，critical 仍拒绝。node/pnpm 输出过既有 DEP0169 警告，不作为漏洞修复或构建成功证据。

## NOT_RUN、影响与后续

NOT_RUN：真实版本修改/lock 生成、post-change 审计、根正式 verify:task、API typecheck/build、完整 lint、production Web build、DB/五保护/fresh lease、实际原生浏览器 auth/workflow smoke、compiled SDK/product/security/owner acceptance。这些全部由总控串行执行，本 Worker 没有运行 live test 来伪造 product 成功。

数据库/Schema/migration/接口/权限/页面/运行日志的产品行为均没有本卡新增变更；只新增离线审计检查及安全 artifact。无 DB/Docker/migrate/seed/服务启动/外部模型/支付/通知，无访问地址可声称已运行；本次只有公开 registry/advisory 元数据网络读取。临时 CLI 测试目录由 finally 精确清理，只有本卡忽略的公开审计 artifacts 和独立 node_modules 保留。

总控验收步骤：精确接收候选 delta → 应用两处 pin 并审查官方 lock/native closure/许可 → 注册五保护及 fresh AF177 环境 → 真实 API types/build/lint、隔离 production Web、原生认证/工作流成功与拒绝 → 原 dev gate 真实生产 audit critical=0 并保留所有非 critical 明细 → 正式 verify:task/执行记录/队列 → 原名本地卡片提交并回读。无 push、远端 Issue/PR、merge/tag/deploy/release。若无法在总卡 4h（含 root）内完成安全更新与真验收，停止拆卡，不放宽门禁。

I178/I179 必须依赖总控真实完成的 I177 集成 Task ID；本候选 `task_50eeecfc6aaa` 不可冒充它。Worker 工程时间约 0.30h（低于 1.25h 上限），root 时间由总控统记，未占用为总控预留的至少 2.75h 验收预算；没有自动续卡。

交接状态：候选精确标题本地提交及 SHA/status 回读后，**STOP ALL WRITING / Writer STOPPED**；最终 worker_done 携真实 SHA。此声明不把自查当作独立复核，不等待 Trea，不把候选成功当作 CODE_VERIFIED 或负责人接收。
