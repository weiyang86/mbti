# AF-181 候选执行记录：修复剩余生产高危依赖并核验兼容性

状态：**CONDITIONAL_PROPOSAL / ROOT_VALIDATION_NOT_RUN / OWNER_CHECK_PENDING**。本候选不等于正式 CODE_VERIFIED，也未证明当前生产 HIGH 清零。

## Writer 与基线

- 注册 Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W12-AF181`；instance `db127089-f67e-4bc5-94ae-b1e4e026df5b`。
- Orca Task `task_f5367f62fcca`；Dispatch `ctx_eb7aac159ba8`；terminal `term_43756642-47ff-4ec2-8bb2-ec63cf9c87f0`；coordinator `term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支 `weiyang86/AIJ-W12-AF181`；起始 HEAD/origin/dev `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；origin fetch/push 均 `git@github.com:weiyang86/aij-foundation.git`；初始 status 干净。
- 每个写入阶段先回读 status/branch/HEAD/remotes；固定 Task/Dispatch/Worktree 身份同上，实际命令证据保留于 Worker 工具记录，机器工作区回读 `.artifacts/af-181/checkpoints/worktree.json`。从 bootstrap 起所有后续写入均在同一分支与 HEAD `173f81d2e77f917bde48aaf5bac21afab38a9c1c` 上，只有本卡六个 allowPaths 的未跟踪差异；未改其他 Writer 内容。
- Worker 独占本卡，未启动 subagent/helper；原 dev、轻企仓库只读边界保持，没有拷贝 env/凭据/数据/其他工作区依赖。

## 单独 bootstrap

逐项 `git show 55719998d8d6aafe18260c87d5c230352a16522b:<path>`，六个 blob 的 SHA-256 全部与派工一致后才恢复；来源 integration Task `task_5e77aca82404`。独立提交 **173f81d2e77f917bde48aaf5bac21afab38a9c1c**「恢复 AF-181 授权只读源码基线」，仅包含授权 package.json ×3、pnpm-lock.yaml、eslint.config.mjs、production-dependency-security.mjs。之后这些文件始终只读，结束前重新校验四个依赖文件 hash 与派工相同。

Root 不应把 bootstrap 当作本卡实现 diff 或已集成基础；root 应只精确接收后续候选提交的六路径差异，不把过时 bootstrap 再覆盖回原 dev。

## 实际交付差异

1. `docs/execution/AF-181-package-updates.json`：before manifests/hash、真实 AF-177 10 项完整安全报告快照、精确 direct pins/edge overrides/lock targets、官方 registry/SRI/license/engine/peer 及隔离兼容证据；`applied=false`、`codeVerified=false`。
2. `scripts/verification/production-dependency-remediation.mjs`：精确 AF181 方案、前后目标、lock v9 inventory/SRI/override 检查；复用唯一现有生产 audit evaluator，加 HIGH 与 CRITICAL 都为 0 的判定；明确 AF181 root/HEAD/time gate 和严格 gate JSON 解析。
3. `scripts/verification/production-dependency-remediation.test.mjs`：53 项有意义的成功/拒绝测试，覆盖未知 optional HIGH/CRITICAL、剩余低级别风险、malformed/truncated/network/muted/重复键/错误 counts/exit、扩范围方案和锁文件/来源漂移、旧 AF177 gate 与真实子工作区 live entry 拒绝。
4. `scripts/verification/production-high-dependencies-live.test.mjs`：仅原 dev、固定实际 `pnpm audit --prod --json`，60 秒/合计 8 MiB、去凭据环境与独立 user/global npmrc；保存安全真实报告及 before/after hash，HIGH/CRITICAL/target/输入变更都失败，不提供 skip 或注入接口。
5. `docs/development/DEPENDENCY_HIGH_REMEDIATION.md`：官方公告、窄 major 例外、兼容性边界和 root 接收步骤。
6. 本执行/STOPPED 记录。

没有应用 manifest/lock/Schema/module/index/SDK/API/页面/权限/数据库变化。只有测试工具的安全 report 日志新增；无应用启动、访问地址或常驻服务。

## 安全发现与窄例外

原 dev `.artifacts/af-177/production-audit-SkYqHC/report.json` 和 `production-audit-mMNjJz/report.json` 为实读来源，critical0/high7/moderate2/low1、exit1；原报告未覆盖。新门禁对所有模块/ID/路径适用，不压低 severity、不忽略 optional、不以 exit1 代表干净。

deepmerge-ts 官方 GHSA-ggr8-5vv4-36mx 影响所有 `<8.0.0`，首个修复 8.0.0；registry 最新 7.x 7.1.6 仍受影响，Prisma/config 6.19.3 仍钉 7.1.5。因原同 major 限制，Worker 通过 **msg_76d615d44101** 询问并停止；总控回应 **msg_a5424697d5a2**，在原 dev planning AF-181 的 ROOT COORDINATION AMENDMENT 中只允许 bounded isolation 与精确 config-edge 8.0.0 条件提案。没有扩大成全局 override、Prisma major 或实际依赖写权限。

最终提案：Prisma/client 成对 6.19.3（官方 config 已采用 effect3.21.0）；仅 `@prisma/config@6.19.3>deepmerge-ts=8.0.0` 和 `@nestjs/platform-express@11.1.19>multer=2.5.0` 两条 override；body-parser2.4.0、qs6.16.1 在既有兼容范围刷新 lock。Nest11/Next16.4.1/React19/Node24/pnpm10/htmlparser2 10.1.0 保留。实际闭包与真实 HIGH=0 尚待 root。

## 验证及失败轨迹

| 验证 | 实际结果 |
| --- | --- |
| 六 blob bootstrap SHA-256 | 全部相符；独立 bootstrap commit 已记录 |
| 官方 metadata + 10 个官方 tarball SHA-512 | 全部 SRI_MATCH；不是签名或发布授权证明 |
| 独立 scratch before/after 安装 | 两组 `@prisma/config6.19.3` + deepmerge7.1.5/8.0.0，`--ignore-workspace --ignore-scripts`，成功 |
| 真实 config/deepmerge CJS+ESM、3 defineConfig+5 merge、config load、invalid Map config 拒绝 | 两组通过；Map 碰撞/循环行为差异已实际复现，保留条件限制 |
| `node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck false --target ES2022 --module NodeNext --moduleResolution NodeNext --types node <两组compatibility.mts>` | exit0；是隔离公共类型比较，不是应用 API typecheck |
| Worker `pnpm install --frozen-lockfile --ignore-scripts --config.manage-package-manager-versions=false` | exit0；本工作区独立依赖，应用 manifest/lock hash 未变 |
| `node --test scripts/verification/production-dependency-remediation.test.mjs` | 最终 53/53，通过/失败/skip/todo=53/0/0/0 |
| `pnpm exec eslint <本卡三个mjs> --max-warnings=0` | 最终 exit0 |
| `git diff --cached --check` | 候选提交前执行，结果见最终工具回读 |
| 原 dev 实际 `production-high-dependencies-live.test.mjs` | **NOT_RUN**；Worker 子工作区实跑只证明预期 AUDIT_ORIGINAL_DEV_REQUIRED 拒绝，在 source test 内检查 exit1 |
| root 正式 `verify:task AF-181`、完整 API/Web build/types、compiled SDK、browser、auth/knowledge/fileCSV HTTP、Prisma generate/guarded migrate/seed、post-change audit | **NOT_RUN / ROOT_ONLY** |

保留的失败/修正：第一次 scratch 安装遗漏 `--ignore-workspace`，pnpm 发现本 Worker workspace（非原 dev）；两条进程立即取消 exit130，未改 manifest/lock，随后独立 `--ignore-workspace` 安装并执行 frozen workspace install。首次隔离测试复用了同名配置文件，加载缓存使无效配置拒绝断言失败；改为独立 invalid.config.mjs；另一次比较误用不同函数 identity 导致深比较失败，改按实际函数执行值检查；这些首次失败不计通过。首次 tsc 因前一测试失败未生成 fixture 而报缺文件，fixture 修正后两组严格 tsc exit0。首次 51 项 source tests 有一项暴露原 evaluator 接受 `../` 路径；保持旧 evaluator 只读，AF181 wrapper 对这类路径 fail-closed，最终通过。初次 lint 的 no-regex-spaces 三处错误已改为精确计数表达式；初次 pnpm exec eslint 在取消安装后缺 executable，frozen 独立安装后恢复并实际通过。没有放宽 gate 或改旧报告。

原始 Worker 证据：`.artifacts/af-181/{registry/,scratch/,compatibility.json,compatibility-input-hashes.json,frozen-install.txt,source-tests.txt,lint.txt,checkpoints/}`。兼容结果摘要也已放入 tracked 方案，ignored 材料可由 root 只读核验，不迁入依赖或数据。

## root 后续与交接

先接收 Writer STOPPED，再由 root 复核官方元数据、决定是否接受条件 major 例外并应用真实 pins/lock；完整闭包 diff、新包 SRI/许可证/来源、Prisma config/generate/隔离迁移 seed 保护、API/Web/SDK/真实成功拒绝、全生产 critical0/high0、正式 verify:task 和最终代码/PR review 均由 root 串行执行。即使 audit 两级为 0，moderate/low、完整 release/security/owner acceptance 继续明确待验；任何失败须保留并 STOP 拆卡，禁止降门槛。

无 root I181 集成成功证明；I182/I183 下游只引用总控真实 I181 ID。候选精确标题提交「修复剩余生产高危依赖并核验兼容性」仅含上述六路径，实际候选 SHA 以 worker_done 回执和 `git show` 回读为准；不自动 push，也不修改 dev/main/远端 Issue/PR/queue/registry。

预算：Worker 从 2026-11-05 20:40 UTC 注册/启动起计，交付时约 0.5h elapsed（含询问等待，实际交付时间见回执），低于 1.25h Worker 上限；整卡 4h 含 root 的剩余预算由总控登记。此处只记 Worker，不把未知 root 耗时估作已完成。

**STOP ALL WRITING / STOPPED**：候选提交和最终只读回读完成后，Writer 交出所有范围，不继续修改、不启动下一卡；由一次 worker_done 确认交接。
