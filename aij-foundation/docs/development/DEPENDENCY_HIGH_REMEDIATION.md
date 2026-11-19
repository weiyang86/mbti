# AF-181 生产 HIGH 依赖修复的条件化方案

本交付是供总控应用和验收的候选方案，未修改应用 manifest/lock。现有真值仍为 AF-177 原 dev 报告：critical 0 / high 7 / moderate 2 / low 1，总计 10，audit exit 1。具体 ID、版本、全部安全引用/路径及原始报告 SHA 保存在 [方案快照](../execution/AF-181-package-updates.json)。未把 HIGH 清零、正式 verify:task、完整安全验收或负责人接收记为通过。

## 精确改动及依据

| 位置 | 原值 → 提案 | 理由 |
| --- | --- | --- |
| apps/api dependencies.@prisma/client | 6.19.0 → 6.19.3 | 与同版本 CLI 对齐，保留 Prisma 6 |
| apps/api devDependencies.prisma | 6.19.0 → 6.19.3 | 官方 config 6.19.3 自身使用 effect 3.21.0，关闭 effect HIGH，优先于额外 effect override |
| root pnpm.overrides | `@prisma/config@6.19.3>deepmerge-ts: 8.0.0` | 仅此依赖边；受总控 amendment msg_76d615d44101 窄例外约束 |
| root pnpm.overrides | `@nestjs/platform-express@11.1.19>multer: 2.5.0` | Nest 当前硬钉 2.1.1；Nest 11 最新 11.2.8 仍硬钉 2.4.0，无法关闭要求 2.5.0 的公告，因此避免无效升级 Nest |
| lock 中 express@5.2.1 → body-parser | 2.3.0 → 2.4.0 | express 声明 `^2.2.1`，无需 override |
| lock 中 express/body-parser → qs | 6.16.0 → 6.16.1 | express 声明 `^6.14.0`，body-parser 2.4.0 声明 `^6.16.1`，无需 override |

所有 API Nest common/core/platform-express 保留 11.1.19，满足现有 `^11.0.0` peers；Prisma/client 成对 6.19.3。保留 Next/eslint-config-next 16.4.1、React/React DOM 19.2.6、htmlparser2 10.1.0、Node 24 与 pnpm 10.0.0；没有其他框架 major、canary、宽泛 override、advisory 豁免或 unsafe fast entrypoint。

精确官方 registry 元数据、tarball URL、SHA-512 SRI、engine、peer、依赖及许可证包含在方案的 `registryEvidence`。Worker 对其中全部 10 个官方 tarball 重新下载计算 SHA-512，均与 registry SRI 相符；这不等于发布授权、签名认证或根工作区安装证明。Prisma 相关包 Apache-2.0；effect/multer/Express/body-parser/Nest 为 MIT；deepmerge-ts/qs 为 BSD-3-Clause，根集成应保留真实许可证和来源记录。

预计闭包含 Prisma/client/config/engines/debug/engines-version/fetch-engine/get-platform 的 6.19.3 补丁链、effect 3.21.0、deepmerge-ts 8.0.0、multer 2.5.0、body-parser 2.4.0、qs 6.16.1，以及这些包声明范围内必要的新依赖和已无 owner 的旧依赖清理。**完整闭包尚未在应用锁文件上生成**；原 dev 总控须检查实际 diff 和新增包的官方 metadata/SRI/license，不能以这个预计列表批准无关更新。验证器只检查精确 manifest 与重点 package inventory/SRI/override，明确不宣称审完完整依赖图。

## 官方安全来源

- [Effect 维护者公告](https://github.com/Effect-TS/effect/security/advisories/GHSA-38f7-945m-qr2g)：固定版本下限 3.20.0；Prisma config 6.19.3 使用 3.21.0。
- [deepmerge-ts HIGH 公告](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)：所有 `<8.0.0` 受影响，首个修复 8.0.0；[维护者 v8 变更](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0) 明确包含 breaking changes。
- Multer 维护者公告：[嵌套字段](https://github.com/expressjs/multer/security/advisories/GHSA-72gw-mp4g-v24j)、[字段名](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm)、[数组下标](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4)、[异步 fileFilter](https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m)；后者要求 2.5.0。另保留 [aborted uploads MODERATE](https://github.com/expressjs/multer/security/advisories/GHSA-3p4h-7m6x-2hcm)、[file size LOW](https://github.com/expressjs/multer/security/advisories/GHSA-qvfw-j98x-7q72)。
- [body-parser 维护者公告](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828)：2.x 修复于 2.4.0。
- [qs 维护者公告](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw)：6.16.1 修复本次 MODERATE。

这些已观察的版本下限不构成固定 ID 白名单。后续实际 audit 新增任何包、ID、路径或 optional HIGH/CRITICAL，门禁同样失败；即使所有这些旧条目消失，也须等待全量真实报告。

## deepmerge-ts major 窄例外的实际隔离证据

原同 major 授权内无法解决该 HIGH：registry 的最新 7.x 为 7.1.6，仍在 `<8.0.0` 范围；最新受支持 Prisma 6 patch 6.19.3 仍硬钉 deepmerge-ts 7.1.5。Worker 先询问停止；总控 msg_a5424697d5a2 / amendment msg_76d615d44101 仅授权条件方案与独立隔离比较。没有把 reachability 当成 audit 豁免。

两个本工作区 ignored scratch 分别独立安装 `@prisma/config@6.19.3` + deepmerge-ts 7.1.5 / 8.0.0，忽略安装脚本，不连接数据库，不读取应用 env。

真实发布包 `@prisma/config/dist/index.js` 的 `loadConfigTsOrJs`（约 892–918 行）动态导入 `deepmerge`，交给 c12 的 `merger`；dotenv、rcFile、giget、extend、packageJson 都关闭。`defineConfig` 本身逐项赋值，并未使用 deepmergeInto/deepmergeCustom 或改名的公共 deepmerge 类型。其 dist/index.d.ts 导入 effect.Schema，没有导入那些被改名的 deepmerge 类型。c12 合并的是加载器配置层对象；当前本库 `apps/api/prisma.config.mjs` 仅 `defineConfig({ schema: "prisma/schema.prisma" })`，不含 Map、Set、循环对象、自定义 merger 或 adapter 函数。

实际比较结果写入方案 `compatibility`，原始运行材料位于本 Worker `.artifacts/af-181/`：

| 检查 | 结果/适用边界 |
| --- | --- |
| Prisma config、deepmerge CJS require + ESM import | 两组成功，使用相同真实导出 |
| defineConfig：schema、migration/seed/typedSql 字符串配置、undefined | 两组 3 例相同 |
| deepmerge：嵌套 records、arrays、undefined、functions、Sets | 两组 5 例相同；函数按实际执行值比较，Set 联集相同 |
| 真实 loadConfigFromFile | 两组成功，schema/migrations/typedSql 路径正确；只保留 seed 字符串，未执行 seed |
| schema 被设置为 Map 的无效配置 | 两组真实加载均拒绝；当前源码也没有此输入 |
| 碰撞 Map 值 | 确认 breaking：7.1.5 后值覆盖，8.0.0 深合并；当前 schema-only 输入不可达 |
| 两个 self-cycle graphs | 确认旧版 RangeError；8.0.0 保留循环，未调用 unsafe fast 变体；当前输入不可达 |
| 公共类型 | 同一 PrismaConfig/defineConfig/deepmerge 使用代码，两组 TS 5.9.3 strict/NodeNext/noEmit/skipLibCheck=false 通过 |

`deepmergeInto` 的嵌套输入副作用变更、custom merger metadata/公共类型改名在维护者记录中成立；实际 Prisma config 调用不使用这些入口，未宣称所有 v7 consumers 都与 v8 兼容。Set/direct function 比较只补充边界证据；当前应用配置没有这些值。以后加入此类配置或更换 config/c12 版本须重审该例外。

复现隔离比较可读取 Worker 的 `.artifacts/af-181/scratch/compare.mjs` 与两组独立 manifest/lock；运行 `node .artifacts/af-181/scratch/compare.mjs`，随后用 TS 5.9.3 对两组 `compatibility.mts` 执行 `--noEmit --strict --skipLibCheck false --target ES2022 --module NodeNext --moduleResolution NodeNext --types node`。这些 scratch 安装和比较并未写入应用 lock/manifest；不能代替 root 的真实 Prisma/client generate/migrate/seed/API 回归。

## 严格验证工具与 root 接收步骤

`production-dependency-remediation.mjs` 复用原 AF-177 `evaluateProductionAudit`，不复制或替换 audit schema/count/advisory 真值。附加 HIGH=0、CRITICAL=0 判定，并对 `..` 路径拒绝输出。保留全部安全 references/paths、真实 exit1 和所有较低级别风险；不回显原始 stdout/stderr/editorial 文本。

- `validateRemediationBeforeFiles(plan, contents)` 要求四个实际 pre-change 文件匹配精确 bootstrap SHA。总控应在应用前取证并保留 snapshot，应用后不以新文件冒充 before。
- `validateRemediationProposal(plan, {manifests, registryMetadata, nodeVersion, pnpmVersion})` 接收 before manifest 与从方案精确官方 registry URL 重新读取的元数据；拒绝扩范围、ranges/canary/额外 overrides、版本/engine/peer/SRI/license 漂移。静态 snapshot 匹配不证明网络来源真实性。
- `validateRemediationTargets(...)` 接收 **实际 post-change** manifest、lock 文本和官方元数据；要求只有两项 direct pins 和两个 root overrides，锁文件的 override 声明、重点包版本和 SRI 一致，拒绝残留旧副本。锁格式适配器仅支持 pnpm lock v9，未知形态失败；不是通用 YAML 解析器或全闭包审计器。
- `node --test scripts/verification/production-dependency-remediation.test.mjs` 是纯/合成校验测试；其中未知 optional HIGH/CRITICAL、malformed/truncated/network/muted/count/exit 错误都拒绝，不能被当作 live audit 证据。

总控在原 dev 完成真实依赖变更、精确闭包复查、frozen install、Prisma config/generate/受保护隔离 migrate+seed、API/Web types/build、compiled SDK 消费者、auth/knowledge/file CSV 成功及拒绝路径后，单独注册并运行 **AF-181** 的 live gate。不能沿用 AF-177 task identity。Root 手工建立 `.artifacts/af-181/live-gate.json`，内容为：

```json
{"schemaVersion":1,"taskId":"AF-181","allowProductionAudit":true,"head":"<原dev当前40位HEAD>","createdAt":"<当前UTC ISO时间>"}
```

随后执行 `node --test scripts/verification/production-high-dependencies-live.test.mjs`。只接受原 dev 实际路径、dev 分支、正确 origin、相同 HEAD、30 分钟以内且最多未来 5 秒的 gate，拒绝重复键/逃逸键/多余字段、符号链接 gate 和子工作区；拒绝前不写 artifact、不访问 registry。子进程固定运行 `pnpm audit --prod --json`，60 秒与 stdout+stderr 合计 8 MiB 上限，不支持注入命令/结果或 skip；清理应用凭据环境，显式官方 registry/optional inclusion/不忽略 registry error，以空 user/global npmrc 隔离用户隐藏配置。

安全报告落在 `.artifacts/af-181/production-audit-*/report.json`，保留实际命令、exit、stdout hash、gate/HEAD、manifest/lock/plan 前后 hash、全量安全审计结果与 target failure。target 验证失败仍运行真实 audit 以保留观察，但整体测试失败；任何网络/JSON/进程问题失败。即使 HIGH/CRITICAL 为 0，status 也仅 `CRITICAL_HIGH_ZERO_RELEASE_PENDING`，`fullSecurityAcceptance=false`，`OWNER_CHECK_PENDING`；moderate/low/info 保留。历史 AF-174/177/179 失败与报告均不重写。

目前 root 的实际安装、Prisma/数据库/API/Web/SDK/browser/live audit、正式 verify:task、全闭包 provenance 与负责人验收 **NOT_RUN**。没有运行访问地址、API/页面/权限/数据库变更或常驻进程。Root 只有在上述实测通过后才能完成 I181；I182/I183 仍依赖真实 I181 Task ID，不能引用本候选作为 CODE_VERIFIED。

## 总控集成后的最新状态

以上候选阶段的 NOT_RUN 和“不改应用”描述作为原始交付证据保留。总控已按精确方案实际应用并完成注册 AF-181 正式 run-iIimMi、protected PG/API/SDK/生产Web及原生浏览器验收，fresh全生产审计所有级别0；见 [正式执行记录](../execution/AF-181.md)。13个实际新增包的官方下载SRI和已安装LICENSE收据已归档。当前仅 CODE_VERIFIED / OWNER_CHECK_PENDING，完整底座、安全发布与分发许可仍待验收，未push或部署。
