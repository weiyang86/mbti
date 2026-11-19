# AF-170 候选执行记录

任务原名：提供个人工作流草稿与图结构校验接口。状态：SOURCE_CANDIDATE / NOT_CODE_VERIFIED；正式集成、CODE_VERIFIED 和 OWNER_CHECK_PENDING 由总控控制。自查不是独立复核或负责人验收。

## Writer 与基线

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W09-AF170`；Orca instance `d485d18f-8b99-4da0-90ad-9293b3c8ea4c`。
- Task `task_1cad861c45f2`；Dispatch `ctx_3488de976b9c`；Writer `term_b370d657-8f64-4613-9bff-3f42603eff08`；Coordinator `term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支 `weiyang86/AIJ-W09-AF170`；起始 HEAD 与 origin/dev 都为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；初始 status 干净。remote fetch/push 均 `git@github.com:weiyang86/aij-foundation.git`。
- 每个源码/文档写入阶段前复检 git status/branch/HEAD/remotes；固定的上述 Task/Dispatch/Worktree/terminal 不变。未写主 dev、轻企、正式队列、registry、AGENTS、manifest/lock、生产 module/index 或迁移目录；未 push/merge/tag/发布。
- Worker 从约13:07 UTC登记至约13:48 UTC，约0.7小时（小于1.75小时）；卡片4小时预算给 root 留下约3.3小时，满足至少2.25小时要求。没有 helper/subagent，未自动续卡。

初始唯一授权 bootstrap：13个路径从 `179751f0922104fc7eee454c87ca4f4d07796fc0` 读取原始 git blob，所有 SHA256 与派工逐项一致，单独提交 `3140596eb1f8f887dc40fc23bc3fcdd12a4facf9`。当前再次逐字节比较该提交，13/13 均未改。完整冻结清单在本工作区忽略的 `.artifacts/AF-170/bootstrap-frozen.json`；它是 source-only 编译前置，不是已集成基线，root **只接收后继候选 delta，不 cherry-pick bootstrap**。

真实前置集成 Task（派工给定）：contracts `task_bb2bf1841ea9`；SDK transport/预览 `task_716ae25e1295`；Skill `task_623c04531bae`；Agent `task_8225f38866ac`；Agent run `task_5731129d1d35`；Memory/schema `task_f597249cbeb2`；run recovery/构建器 `task_634f404155e8`；Workspace事务围栏 `task_34f986fd3442`。本候选 Task 不能取代这些真实依赖或未来 I-* 接收 Task。

## 实际候选差异

仅11个新增允许路径，均未混入 bootstrap：

- `apps/api/src/plugins/aij-ai/ai-personal-workflows{.dto.ts,-graph.ts,.service.ts,.controller.ts}`：实际严格 DTO、纯函数 Graph v1 校验器、参数化 PostgreSQL 持久化事务、私有 Cookie/Workspace/Origin controller、早期 no-store/重复key verify 接线导出。
- `packages/sdk/src/personal-workflows.ts`：实际 ClientApi 工厂、强类型草稿/版本/pin、浏览器纯结构校验与规范化；无独立 transport、运行方法或 trusted snapshot 输入。
- `scripts/verification/personal-workflows.test.mjs`：10组直接调用实际实现的离线测试，以及严格类型声明与 ESM/CJS 编译/执行，受控临时HTTP解析fixture真实400/413并关闭。
- `scripts/verification/personal-workflows-live.test.mjs`：root-only freshAF170 Cookie/API/PG/packed SDK 真实验收脚本，Worker NOT_RUN。
- `docs/execution/AF-170-schema.prisma`：三模型及仅三条既有回关系的精确提案；`AF-170-migration.sql`：完整SQL提案；本执行记录；`docs/development/PERSONAL_WORKFLOWS.md`：API/Graph/SDK契约及总控接线/人工步骤。

图支持全部指派节点：start/end、本人 Agent、typed eq/neq/exists condition、成对 parallel/join、有界 loop、human-approval 占位。condition 也必须成对 join，所有分支按明确输入/输出端口闭合，使用拓扑排序和嵌套分支 token 栈校验；不注册尚未支持的 node type。总64节点/128边、深度4、输入20、loop1..20、规范UTF8≤64KiB，拒绝脚本/任意表达式/隐式执行、跨分支/子图逃逸、环/孤岛、重复/未知字段和引用；不把无效图修成有效图。

持久化代码实现 current+version+pins+audit 原子事务、永久code/墓碑、精确初始digest重放返回current、严格CAS/noop、活动100配额、20条分页安全摘要、独立版本读取、同owner/scope查询、旧Agent版本pin，以及有序Agent行锁。允许引用disabled配置，但从不声明可运行。deleted Agent 拒绝新保存，历史读取不复制或重新加载Agent/Skill指令/Memory。SQL提案提供5个RESTRICT外键（含3个composite owner FK）、唯一/页面索引、形状/范围检查、配额、身份/initialDigest/nextRevision/墓碑保护、历史/绑定不可变、快照与pin精确完整性 deferred triggers；没有修改旧表/旧模型。

影响：数据库只提交提案，未连接/迁移；接口未接线/启动；页面无改动；权限复用既有 assets.read/manage，不新增授权；日志/审计仅ID/revision/action/合法correlationId；没有 RuntimeJob/Run/Trace/budget/Memory/grant、上游模型、工具或任何自动副作用。没有可供访问的运行地址。

## Worker 验证

| 实际命令 | 结果与边界 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS；独立copy安装，无版本/锁变化，不共享或symlink其他workspace依赖 |
| `node scripts/build-workspace-package.mjs packages/contracts`、`packages/runtime-contracts`、`packages/core` | PASS；仅小包编译前置 |
| `pnpm --filter @aij/api exec prisma generate --schema prisma/schema.prisma` | PASS；只用冻结bootstrap compiler source，无DB连接/环境文件加载 |
| `pnpm --filter @aij/api typecheck` | PASS，两组tsc --noEmit；最终日志 `.artifacts/AF-170/typecheck-final.txt` |
| `node --test scripts/verification/personal-workflows.test.mjs` | PASS 10/10，fail/skip/todo=0；最终 `.artifacts/AF-170/source-final.txt` |
| `pnpm exec eslint apps/api/src/plugins/aij-ai/ai-personal-workflows*.ts packages/sdk/src/personal-workflows.ts scripts/verification/personal-workflows*.test.mjs --max-warnings=0` | PASS；最终 `.artifacts/AF-170/lint-final.txt` |
| `node --check scripts/verification/personal-workflows-live.test.mjs` | PASS，仅语法，不是live执行 |
| `DATABASE_URL=postgresql://aij_disabled@127.0.0.1:1/aij_disabled pnpm --filter @aij/api exec prisma validate --schema ../../.artifacts/af170-schema/schema.prisma` | PASS；仅scratch提案合成Schema无DB校验；未写实际Schema |
| bootstrap逐字节复检 | PASS 13/13，origin/dev仍94b0236，无生产Schema/module/index额外修改 |
| `git diff --cached --check` | PASS；首次行尾空格已修复；仅本卡11文件 |

实际覆盖：嵌套 condition/parallel/loop/approval + own disabled Agent pin、规范排序/digest/no caller mutation；错误端点/端口/重复/环/不可达/串线/错join；跨子图ID重复、64节点和深度4边界、65/超深/大数组拒绝、危险prototype/getter/symbol/sparse array/孤立surrogate；未知字段、typed条件/输入/loop/label范围、转义重复JSON key；实际Service的重放current、CAS/noop、版本分页安全投影、foreign owner/space/ref拒绝、审计故障回滚、100配额与有序锁；实际Controller权限元数据、Origin/cross-site、空query/body；SDK严格声明输出和ESM/CJS调用，SDK与后端规范图一致。离线SQL driver只模拟查询回包，不证明PG事务/约束或真实并发；临时HTTP fixture只验证真实parser/middleware，不是应用/API启动。

失败/修复如实保留：首次 noEmit 因 core/runtime-contracts 尚未构建出现模块缺失及派生类型错误，构建小包后通过；首次lint报两个控制字符regex规则及后续live fixture未用saveCatalog变量，改为逐codepoint检查并移除未用变量后通过。自查修复大小写路径导致早期verify绕过（加/i并增加真实loopback测试），修复live fence code含underscore导致DTO过早拒绝，补齐packed consumer路径在环境清理前的保存和真实permission code。提交前diff-check发现SDK返回行尾空格，去除后重新检查；这些是本Writer自查，不是独立Review。

NOT_RUN：正式 `verify:task AF-170`（Worker不注册runner）、实际SQL deploy/status/约束/trigger/迁移Schema parity、freshAF170真实Cookie/API/PG、actual packed公共SDK消费者矩阵/strict consumer、重型API/Web build、应用启动、真实pools0、总控代码/PR Review与负责人验收。SQL只做源码自查，未宣称被PG编译或运行；root-only脚本仅lint/语法检查，可能在真实环境发现需返修的前置/实现问题。未运行Docker、migrate、seed、外部/付费模型或生产服务。

## Root 接收与验收步骤

1. 接收明确STOPPED后仅集成本候选11路径。按API指南接线实际 ai-runtime.module、三个模型/三个回关系、单独正式migration、SDK index export；旧 Runtime/Agent/Memory 字段和原迁移保持字节不变。保留SQL-only CHECK/trigger，审查schema/SQL字段/FK/唯一键一致性。
2. root注册五个保护面和runner：database/migration、runtime-environment、database/seed、auth-support、client-auth-fixture；保持 freshAF170、真实Schema与新lease，禁止复用旧验收库或放宽保护。
3. JSON parser之前安装导出的私有缓存middleware，并组合本前缀duplicate-key verify/96KiB原始body限制；保留root已验证的AuthExceptionFilter private缓存/真实413。生成客户端，串行heavy build/实际packedSDK（含ESM/CJS/strict类型），准备指南内consumer样例。
4. root独占运行指南中的 `AIJ_AF170_ROOT_LIVE=1 AIJ_AF170_PACKED_CONSUMER=... node --test scripts/verification/personal-workflows-live.test.mjs`：实际两个Host，每Host Prisma1connection；阻塞者/观察者都使用独立保护PG Client，覆盖Cookie/签名跨产品/过期/撤销、read-only/owner/空间、Origin/CSRF/unknown/重复key/413、CAS/noop/replay、old pin/删除拒绝、SQL审计回滚/不可变/复合scope/缺pin deferred回滚、生命周期/组织/项目/member/workspace/role/permission行锁、100配额竞争、无Runtime/Memory/budget/upstream和关闭pools0。失败回交Writer，不扩门禁、不用脚本存在冒充成功。
5. 人工API验收：创建start→end草稿；GET/current和version1相同；编辑name拿revision2，旧CAS拒绝且version1保持；相同初始POST拿current2；另一OWNER无法读/改；用脚本示例保存nested graph并核对本人Agent pin；删除后current/history404、初始POST409。所有页面/执行/触发仍未实现，无UI浏览器场景可声称通过。
6. root完成正式verify:task与适用门禁、执行/队列、精确原名正式本地提交与已授权Git流程、总控Review后才完成真实I-*集成Task，下游画布/执行器必须依赖该真实Task；本卡状态不代表负责人接收。

Writer交接：候选本地提交标题逐字为“提供个人工作流草稿与图结构校验接口”；确切SHA由最终worker_done回执给出（文档不自引用SHA）。本卡完成候选交付后 **STOP ALL WRITING**，待总控接收或新派工返修，不续写本卡、不启动下一卡。
