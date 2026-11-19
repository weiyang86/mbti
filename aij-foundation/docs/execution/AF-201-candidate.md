# AF-201 实现统一文件中心的私有生成附件能力 — Worker候选

状态：CANDIDATE_READY，非 CODE_VERIFIED，非负责人验收；正式 verify:task/队列/registry/集成归root。外部真实厂商 DEFERRED_NOT_PASSED，账号/密钥留空。

## 身份与基线

- Task `task_af60445a3739`；Dispatch `ctx_608b93879877`；Writer终端 `term_5b6e4bff-df0c-4678-9b02-7538cefe3936`。
- Orca Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W17-AF201`，instance `fd993cea-faa1-482c-aef1-5bd350ff38ec`，top-level无parent；branch `weiyang86/AIJ-W17-AF201`。
- 开始 HEAD=`origin/dev`=`94b0236f775fa40a07944c5e0545ac6ce0e123f3`，status干净；remote fetch/push `git@github.com:weiyang86/aij-foundation.git`。
- 只读main-root W17 CONTRACT/SOURCE_BOOTSTRAP；manifest SHA256 `2563c88d9844ff6a2c1c275567cd07252445fef01ef02e26a546156f5561392e` 核验通过。867条清单均用 `git show 15358325d7e6d0a90e6c55fe124c2c7ad13eb46e:<path>` 取字节、逐项sha256核验并materialize；没有读取其他Worker live源码、没有复制主root dirty文件。
- 单独源码bootstrap `45be1844f1479ad4729c3f27f2494f817ec36af2`，标题 `W17 verified source-only bootstrap`，2026-11-07 05:22:12 +08；867项覆盖已存在同字节文件，实际bootstrap差异368文件。此提交禁止作为产品候选差异集成。
- 产品候选提交标题逐字 `实现统一文件中心的私有生成附件能力`；真实SHA由最终Orca交接报告给出，候选delta仅本节下述四路径。

## 实际差异与边界

1. `apps/api/src/files/generated-file-assets.service.ts`：原FileAsset/LocalStorageAdapter/FileContentService上的可信server生成附件API；scope/spec/opaque ticket/metadata/error类型同文件导出，stage/commitInTransaction/confirm/discard/readInTransaction实际实现。
2. `scripts/verification/generated-file-assets.test.mjs`：真实私有临时FS、真实原adapter/content/router、真实DOCX库产出与9组小事务协作者测试；协作者仅模拟事务与锁，不连接或声称PG。
3. `docs/planning/auto-ai-program-20261105/W17/AF-201-ROOT_WIRING.md`：精确DI/事务/安全错误/类型/SQL锁/恢复顺序与root真实验收请求。
4. 本执行记录。

生成仅local私有；格式/MIME/Buffer/1..5MiB/SHA256/文件名/canonical私有URL/basic envelope验证。metadata无对象key/路径，ticket对象身份绑定单实例，不可伪造/跨实例/复用；复制输入字节。写FileAsset固定member owner/uploader与project/workspace/aij-ai scope。commit尝试不代表外层commit；同一原PG advisory xact lock串行create与确认/清理，显式ReadCommitted清理查询任何assetId或objectKey已提交记录均保留，DB未知不删，失败保留能力。读取精确scope/status/deletedAt并复用原完整性reader。DOCX/PDF结构检查仅基本结构，完整渲染真值仍归AF197/199。

没有schema/迁移/全局依赖/SDK index/module/配置/权限/队列/registry/state变化；没有新表、运行账本、上传白名单变化。旧client/files边界原样保留；模块尚未接线，因此尚无新增HTTP/页面/审计行为或运行地址。未碰轻企仓库、主root可写文件、其他Worker、真实env/密钥/上传/数据库；没有push/PR/Issue/tag/发布。

## 实际检查（退出码与修复轨迹）

- 身份 `pwd` / `git status --short --branch` / `git rev-parse HEAD` / `git remote -v` / `git rev-parse origin/dev` / `orca worktree current --json`：exit0，匹配派工。
- Python bootstrap脚本：manifest hash + 867源字节hash + 精确git add + 独立bootstrap commit，exit0。
- `pnpm install --frozen-lockfile --ignore-scripts`：exit0，独立本Worktree安装800包；没有借用其他node_modules。
- `pnpm --filter @aij/api prisma:generate`：exit0，schema-only编译，脚本明确不连接DB/不加载env。
- `pnpm --filter @aij/runtime-contracts build`：exit0，仅小包独立产物，不提交build输出。
- `node --test scripts/verification/generated-file-assets.test.mjs`：首轮exit1（7/7失败），原adapter拒绝macOS `/var` 与realpath `/private/var` 不一致的临时root；测试fixture改为realpath后exit0（7/7），补充后最终exit0（9/9，无skip/todo）。
- 最终9组覆盖：真实字节和scope/metadata；rollback清理与伪造/跨实例/重复票据；commit响应丢失与inactive metadata保留；未知DB/删除失败保留与重试；pending commit锁等待；create失败/仅key匹配保留；跨project/workspace/member/plugin/uploader/status/deletedAt与损坏读取；格式/大小/MIME/路径/URL/名字校验及真实DOCX/输入snapshot；pending rollback锁等待/confirm未知保留；并发票据与missing读取。
- `pnpm exec eslint apps/api/src/files/generated-file-assets.service.ts scripts/verification/generated-file-assets.test.mjs --max-warnings=0`：exit0（最后实现变更后运行）。
- `pnpm --filter @aij/api exec tsc --noEmit --strict --skipLibCheck --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --module commonjs --moduleResolution node --target ES2022 src/files/generated-file-assets.service.ts`：exit0（最后实现变更后运行），仅该服务依赖图，不是API重构建。
- `git diff --check`：exit0；候选暂存后再检查四路径与whitespace。
- 非验收性探查：初次批读包含不存在的 `scripts/verification/file-content.test.mjs`，该命令exit1，后读取已有storage-reader-routing测试参考；首次`orca orchestration check --from`无此flag，exit1，按CLI提示改`--terminal ... --full`后exit0。这些不是未修复产品失败。

NOT_RUN：正式`verify:task AF-201`、真实PG/数据库目标/迁移/seed、Docker/Linux renderer、API/Next全构建、HTTP/私有binary/登录CSRF/真实权限审计、packed SDK、真实浏览器和OS保存。均由派工明确归root独占，无PG/Docker/browser通过声明。没有运行服务或可访问地址。

## 交接与验收

root按ROOT_WIRING接线、登记正式任务并运行真实成功/拒绝/commit-rollback-unknown竞态与旧上传scope回归后才能标 CODE_VERIFIED；下游I202必须依赖真实完成I201，不以此候选冒充已集成。手工验收在root运行环境中生成Word/PDF、下载核对实际字节/头部与scope拒绝，并在当前文档撤权/删除后拒读；当前Worker不提供已运行地址。

本Worker有效工程耗时约0.17小时（约10分钟，含读取/bootstrap/实现/测试/记录；小于1.75小时上限），无后台等待或其他Worker工作量混入。候选提交和最终消息后 **STOP ALL WRITING**，Writer明确交还root；不自动接续下卡，不修改此候选等待集成。


## 原Writer回修：核心ProjectProfile ID（2026-11-07）

- Followup Task `task_9add2817750d` / Dispatch `ctx_b199a9ab34f5`，原Writer/Worktree/remote不变；进入时branch `weiyang86/AIJ-W17-AF201`、HEAD `1ffa352c7202e4b00844c5d020dd30e2f9b0df12`、status干净。仍只有原四allowPaths，bootstrap保持 `45be1844f1479ad4729c3f27f2494f817ec36af2`；root明确停止这些路径的写入后原Writer接回。
- root报告真实PG debug的7个生成附件子场景因scopeValid错误限制slug而INVALID_INPUT，原legacy HTTP文件路径及DOCX拒绝通过；失败证据路径见ROOT_WIRING，Worker未读取/复制root私有测试/artifacts。正式AF201仍NOT_RUN/NOT_CODE_VERIFIED，不能用先前候选unit通过取代PG验收。
- 修复scope.projectId接受1..128位ASCII字母/数字/下划线/连字符的核心opaque ID，包括seed UUID及Prisma cuid；不转换核心ID，不修改任何调用者/真实PG测试/存储slug逻辑。所有精确scope比较、票据身份、锁、未知DB与committed metadata保护保持。
- 文件名unsafeName改为codepoint条件 `n<32 || 127..159 || 0x202a..202e || 0x2066..2069`，不引入lint suppression，等价拒绝原范围。
- fixture中scope.projectId改为UUID，LocalStorageAdapter配置projectId仍为 `aij-foundation`。新增UUID/cuid/安全opaque ID/128长度成功链、runtime slug或其他项目读取同asset的NOT_FOUND、空/非法类型/129长度/路径/控制字符拒绝、旧文件名危险范围回归；原9组保留。
- 修复前先只更正fixture并添加回归：`node --test scripts/verification/generated-file-assets.test.mjs` exit1（2通过/10失败，INVALID_INPUT），明确复现coreID与storageSlug混用；修复后同命令exit0（12/12，无skip/todo）。
- 回修最后实现后 `pnpm exec eslint apps/api/src/files/generated-file-assets.service.ts scripts/verification/generated-file-assets.test.mjs --max-warnings=0` exit0；`pnpm --filter @aij/api exec tsc --noEmit --strict --skipLibCheck --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --module commonjs --moduleResolution node --target ES2022 src/files/generated-file-assets.service.ts` exit0；`git diff --check` exit0。
- 未运行DB/Docker/fullAPI/服务/浏览器，未新建依赖，未改共享文件；没有访问地址、没有push。root按ROOT_WIRING重新运行实际核心profile ID的真实PG门禁后才能继续I201→I202。
- 本次回修有效耗时约0.08小时（约5分钟，<=20分钟），加首轮0.17小时，累计Worker约0.25有效小时，未超原1.75小时上限。修正仍按原名提交精确四路径，提交后 **STOP ALL WRITING** 并交还Writer；最终真实SHA在本次Orca worker_done报告。
