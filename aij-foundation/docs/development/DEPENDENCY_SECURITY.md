# 生产依赖 critical 核验

AF-177 候选交付提供版本提案和审计工具。Worker 没有更新真实依赖；当前冻结版本仍有 **37 项生产告警：5 critical、18 high、12 moderate、2 low**。只有总控应用提案并执行真实审计后，才能确认 critical 清零；该里程碑仍不代表完整安全、产品或负责人验收通过。

## 最小版本提案

精确变更见 [AF-177-package-updates.json](../execution/AF-177-package-updates.json)：`apps/web/package.json` 的 Next 和根 `package.json` 的 eslint-config-next 均为 `16.2.6 → 16.4.1`。不增加 overrides，不修改 API manifest、React 19、Nest 11、htmlparser2 10.1.0 或 SDK 公共契约。官方 registry 的 latest 在核对时是 16.4.5；16.4.1 是覆盖本次全部 critical 修复门槛的最小稳定目标，并非声称它是最新版本。Next 16 属于 [Active LTS](https://nextjs.org/support-policy)。

| Critical 公告（维护者一手来源） | 发布日期 | Next 16 修复版本 | 条件与处理 |
| --- | --- | --- | --- |
| [GHSA-p293-qw3h-jr36](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) | 2026-08-25 | 16.3.3 | Windows 文件系统服务器的 Pages/App router；不能以开发机 macOS 排除生产风险。 |
| [GHSA-2xp9-vwfh-vxw4](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) | 2026-08-25 | 16.3.3 | AVIF 图像优化及 sharp/libheif；条件性暴露仍计入包审计。 |
| [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) | 2026-09-22 | 16.3.6 | Node next/og 的 ImageResponse 接收不可信 SVG 值；静态扫描未发现当前使用不构成豁免。 |
| [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) | 2026-10-14 | 16.4.1 | glibc Linux SVG 图像优化；实际 lock 应解析 sharp ≥0.35.5。 |
| [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) | 2026-10-14 | 16.4.1 | App router 的 Cache Components/use cache 返回多个 typed arrays；维护者要求即使未用该形态也升级。 |

[16.4.1 发布记录](https://github.com/vercel/next.js/releases/tag/v16.4.1)明确包含最后两项 critical 修复。[Next registry 元数据](https://registry.npmjs.org/next/16.4.1)要求 Node ≥20.9.0，React/react-dom 接受 ^19.0.0；仓库 Node 24.21.0、React 19.2.6 符合声明。[eslint-config-next 元数据](https://registry.npmjs.org/eslint-config-next/16.4.1)接受 ESLint ≥9、TypeScript ≥3.3.1。声明兼容不替代真实 build/lint/browser 结果。

预计相关闭包包括 @next/env、平台 SWC、@next/eslint-plugin-next 16.4.1，postcss 8.5.23、@swc/helpers 0.5.23、sharp ^0.35.5 及对应 @img 原生包。lint config 内部的 typescript-eslint 范围变为 ^8.56.0、react-hooks 范围变为 ^7.1.0；根直接 pin 保持原值，由 pnpm 独立解析内部依赖。Next/eslint-config-next registry 声明 MIT；sharp 声明 Apache-2.0，helpers 声明 Apache-2.0。总控必须审阅真实 lock、原生平台闭包和许可证记录，不把元数据读取当作完整供应链证明。

## 工具契约与拒绝规则

`scripts/verification/production-dependency-security.mjs` 导出三个无安装/更新副作用的函数：

- `evaluateProductionAudit({stdout, exitCode, signal, timedOut, outputExceeded, spawnError})`：严格接受冻结 pnpm 10 的 `actions/advisories/muted/metadata` JSON，核对全部严重级别与 advisory 数量、ID、production 路径及实际退出码；返回安全计数、包名、版本、路径和 GitHub advisory 链接。
- `validateSecurityProposal(plan, context)`：验证本卡两项精确稳定版本、冻结原版本、官方 registry tarball/integrity 声明、Node/pnpm/React/lint peers 及 htmlparser2 保留条件。它检查输入一致性，不验证 registry 签名，不产生真实 lock。
- `validateOriginalDevGate(context)`：限制总控 live test 的原始 dev 路径、分支、remote、HEAD 绑定及有效 30 分钟的显式 gate。

审计函数拒绝缺失/截断/重复键/未知 schema、未知严重级别、计数不一致、忽略列表、dev 路径、网络/error 返回、非 0/1 退出码、超时或超量输出。**未知包和未来 advisory ID 同样计入 critical**，不存在包/版本/ID 白名单。未安装时 findings.paths 为空可由 actions.resolves 补足；安装后 pnpm 的 `. > name@version` 与 `apps/web > name@version` 路径也保留。适配器来自[冻结 pnpm 10 audit 源码](https://github.com/pnpm/pnpm/blob/v10.0.0/lockfile/plugin-commands-audit/src/audit.ts)，新 schema 需要明确适配，不能当作零告警。

任何 critical 都返回 `CRITICAL_PRESENT`。critical 为零，即使 high 仍存在且 pnpm exit 1，也只返回 `CRITICAL_ZERO_RELEASE_PENDING`，`fullSecurityAcceptance:false`、`OWNER_CHECK_PENDING`。退出码 0 的空告警结果也不授予完整产品验收。

离线命令：

```sh
node --test scripts/verification/production-dependency-security.test.mjs
pnpm exec eslint scripts/verification/production-dependency-security.mjs scripts/verification/production-dependency-security.test.mjs scripts/verification/production-critical-dependencies-live.test.mjs --max-warnings=0
node scripts/verification/production-dependency-security.mjs --audit-file .artifacts/af-177/audit-before.json --audit-exit-code 1
```

CLI 返回 1 表示 critical 尚存，2 表示输入/过程拒绝，0 仅表示该输入 critical 为零。CLI 始终标注 `STORED_INPUT_ONLY_NOT_LIVE_PROOF`，不能替代下面的真实生产审计。公开合成 fixture 存于 source/helper test 文件内，不创建隐藏的产品成功结果。

## 总控真实验收

仅在 Worker 明确 STOPPED 后，总控在原 dev 应用两处 pin 并从官方包生成 lock，检查无无关直接升级/豁免；独立 frozen 安装后执行真实 API types/build/lint、隔离 production Web build 和新 AF177 环境下的原生 auth/workflow 成功及拒绝烟测。总控注册五项适用保护、真实 fresh lease 和正式 `verify:task`；本候选不修改 registry/正式队列。

总控在原 dev 创建一次当前 HEAD 绑定的 gate（只写忽略的本卡 artifacts，不含凭据）：

```sh
node --input-type=module - <<'JS'
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.artifacts/af-177', { recursive: true, mode: 0o700 });
writeFileSync('.artifacts/af-177/live-gate.json', JSON.stringify({
  schemaVersion: 1, taskId: 'AF-177', allowProductionAudit: true,
  head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  createdAt: new Date().toISOString()
}, null, 2), { mode: 0o600 });
JS
node --test scripts/verification/production-critical-dependencies-live.test.mjs
```

live test 只在 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation`、分支 dev、正确 origin、冻结 pnpm 10.0.0、有效 gate 下运行实际 `pnpm audit --prod --json`，显式包含 optional dependencies、官方 registry、TLS 校验，并禁止 registry 错误豁免。它有 60 秒子进程时限、8 MiB 合计输出上限；实际 exit 1 会保留，不能被 shell `&&` 丢失。失败也写安全 report（gate/工具前置拒绝除外）；原始 stderr/错误正文不进入 report，stdout 仅留 hash，防止反射凭据。审计前后核对 manifests/lock/HEAD 未变化。

报告位于 `.artifacts/af-177/production-audit-*/report.json`，包含真实命令、HEAD、输入 hash、实际退出码及所有剩余告警路径。此 live test 不接收 fixture 或替代命令，不启动服务、DB 或浏览器。其通过不能替代前述真实产品验收。

## 剩余风险与批次依赖

如果闭包外的冻结路径不变，预计仍有 10 项：effect 1 high、deepmerge-ts 1 high、multer 4 high/1 moderate/1 low、body-parser 1 high、qs 1 moderate。其路径和官方 advisory URL 全部保留在版本提案的 `remainingBaselineFindings`；解析锁时可能改变实际数量，最终以总控 post-change 真实报告为准。这些告警需要后续独立定界，不能通过本卡宣称全安全，也不能为了清扫它们升级无关框架或 Prisma 主版本。

负责人验收：查看实际生产 report critical=0 和剩余明细，检查 API/Web 构建及原生页面证据、真实认证/流程拒绝路径、正式 verify:task 记录，确认独立环境已清理自己启动的进程。正式接收前保持 OWNER_CHECK_PENDING；I178/I179 必须依赖总控真实完成的 I177 集成 Task ID，候选 Task 完成不构成该依赖。


## 总控实际接收结果（2026-11-06）

最终正式 `.artifacts/verification/AF-177/run-DrYmac/report.json` PASS，实际配对pin16.4.1、Sharp0.35.5/native生产构建、API/PG/SDK与原生390px浏览器通过，专用服务已CLOSED。真实生产audit exit1，critical0/high7/moderate2/low1；完整10项仍在live安全报告中，不等同全安全/发布许可。Next新版独立TypeScript插件与根base重复注册的真实lint失败已通过精确scope修正，原推荐规则保留；Web扩展设置覆盖jsx/mts/cts避免rootDir提示。详见[执行记录](../execution/AF-177.md)。原始before审计和失败证据不回填。
