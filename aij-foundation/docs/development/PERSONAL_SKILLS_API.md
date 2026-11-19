# 用户私有 Prompt Skill API（AF-154 候选）

本切片只提供 API 与 SDK，没有浏览器页面或菜单入口。资产属于当前已认证的 MemberUser 与当前服务端验证的 ClientWorkspace；Workspace OWNER 也不能查看或操作另一成员的私有 Skill。它独立于产品管理员 AI catalog，不参与模型调用、费用、文件、Job 或长期记忆。

## HTTP 合约

真实应用全局前缀为 `/api`。所有路由使用 Client Cookie、`x-aij-workspace-id`，并经过 WorkspaceContextGuard（内含 ClientAuthGuard）。任何响应在路由 guard 阶段设置 `Cache-Control: private, no-store`，包括认证/权限拒绝；进入路由前的 HTTP 解析错误仍遵循宿主默认行为。

| 方法 / 路径（省略 /api） | 权限 | 输入 / 返回 |
| --- | --- | --- |
| GET /client/ai/skills | workspace.ai.assets.read | `limit=1..50`（默认20）、`afterId`；`{items,nextCursor}`，列表不含 instructions |
| POST /client/ai/skills | workspace.ai.assets.manage | 精确 `{code,name,instructions}`；201，完整 Skill |
| GET /client/ai/skills/:id | workspace.ai.assets.read | 完整 Skill |
| PATCH /client/ai/skills/:id | workspace.ai.assets.manage | 精确 `{name,instructions,expectedRevision}`；完整 Skill |
| DELETE /client/ai/skills/:id | workspace.ai.assets.manage | 精确 `{expectedRevision}`；`{id,revision,deleted:true}` |
| GET /client/ai/skills/:id/versions | workspace.ai.assets.read | `limit=1..50`（默认20）、`beforeRevision`；降序 `{items,nextCursor}`，cursor 为 revision |

完整 Skill 为 `{id,code,name,instructions,revision,createdAt,updatedAt}`；版本为 `{id,skillId,code,name,instructions,revision,createdAt}`，时间使用 ISO 字符串。应用仍使用既有 success envelope，SDK 解包为 data。

所有写操作必须有精确匹配服务端 `webUrl` 的 Origin，拒绝 `Sec-Fetch-Site: cross-site`。不能通过 payload 指定 memberId/workspaceId/projectId/ownerId。未知 body/query 字段、script/file/ref、对象/数组替代文字、NUL、非法 ID 都拒绝400。instructions 可以包含任意提示文本，包括代码片段；只保存为数据，从不执行。

name 非空、首尾无空格且最多100 UTF-16 code units；code 为2..63位小写字母起始、字母数字或单段连字符 slug；instructions 非空白、最多8000 UTF-16 code units，并有32768 UTF-8 bytes 上限。每成员每 Workspace 最多100个未删除 Skill。ID/cursor 有长度与字符约束；列表按 ID 升序，版本按 revision 降序，无无界查询或 total 全表计数接口。

## 修订、重放和删除

code 是不可修改的创建幂等键，更新 DTO 不接收 code。相同 workspace/member/code 和**精确初始内容**重放返回当前记录，仍为201，不新增 snapshot/audit；修改后的当前内容不会重定义初始创建请求。初始内容不同复用 code 返回409，删除后复用也返回409。不同 code 表示不同资产。本切片不另引入 request-key。

创建生成 revision1 快照。PATCH 必须匹配当前 expectedRevision；内容变化时 revision+1、追加快照及审计，完全相同的编辑不产生写入，旧 revision 的 no-op 仍为409。DELETE 匹配当前 revision 后仅设置 deletedAt/updatedAt 并审计，**不增加内容 revision，不追加删除快照**。对本人已删除 ID 再次 DELETE 返回相同 `{id,revision,deleted:true}`，不再审计；首次删除仍必须满足 CAS。删除后 get/versions/update 均404，list 不返回；版本物理保留，code 墓碑禁止意外复活。未知 ID、别人成员 ID、其他 Workspace ID 的 get/update/delete/versions 统一404。

数据库 `ai_personal_skill_version` 有 unique(skill_id,revision)、带 owner scope 的复合 FK，SQL trigger 拒绝 UPDATE/DELETE/TRUNCATE；当前表 trigger 拒绝更改 identity/code 或任何已删除行。当前表 workspace/member/code 全历史唯一，删除不释放 code。数据库级 trigger/check 是 Prisma schema 无法表达的补充，须与模型/迁移一起保留。没有自动清理、恢复、迁移历史、加密或无限期留存承诺。

## 事务与权限 owner

每次读写都在同一 ReadCommitted 事务内重新计算当前项目/组织状态及 aij-ai 安装，取得插件生命周期锁和相关行锁，然后调用既有 `WorkspaceContextService.assertWritePermissionInTransaction`，核实 member/workspace/membership/role/permission/grant 的 active 与删除状态。锁顺序是 lifecycle → workspace membership fence → scoped asset lock/row。创建 quota/code 重放、更新 CAS、snapshot、审计在同一个事务内，不开嵌套事务。审计写入失败回滚当前表与版本表。

审计遵循既有 client-workspaces 的 MemberUser userId actor 约定，只有 module/action/status、workspace/member/resource IDs、revision 与变化字段名；不写 name、instructions、body、Cookie、凭据或 correlation header。未修改全局日志机制。新权限由现有 provisioning catalog 定义，新增 Workspace OWNER 自动获得，默认 MEMBER 仍只有 context.read；迁移只给现有 active system OWNER 追加这两项 grant，不恢复已撤销或删除的 permission/grant，不自动给普通成员授权。

## SDK

`@aij/sdk` 导出 `createPersonalSkillsClient(api)` 及本模块窄类型；api 是现有 `createClientApi` 实际 transport（Cookie include、no-store、workspace header），无需新增 transport 或持久化 token。保留所有既有 recovery 导出。

```ts
const skills = createPersonalSkillsClient(createClientApi(() => apiBase));
const current = await skills.create(workspaceId, {
  code: 'my-summary', name: '摘要', instructions: '只总结用户提供的事实。'
});
await skills.update(workspaceId, current.id, {
  expectedRevision: current.revision, name: current.name, instructions: '以三条事实总结。'
});
const history = await skills.versions(workspaceId, current.id, { limit: 20 });
```

SDK 提前检查 selector/输入范围/未知字段与 pagination，错误由现有 ClientRequestFailure（含 status）传播；409 应由调用者重新读取并决定编辑，SDK 不自动重试。

## 验证与人工验收

Worker 纯测试运行实际 DTO/service/controller/共享权限 fence/SDK 源码，SQL 替身只用于离线控制事务结果；它们不证明 PostgreSQL 锁、迁移或真实 Cookie/API。真实脚本 `scripts/verification/personal-skills-live.test.mjs` 为 **NOT_RUN Worker**，默认无显式 root flag 时跳过。

总控必须先注册新 AF-154 验证/数据库任务，集成本卡与来源依赖，在 Worker STOP ALL WRITING 后按 `docs/execution/AF-154-schema.prisma` 加入模型和两处 backrelations，生成 Prisma 并验证 schema/migration parity（包括 SQL-only triggers/checks），构建依赖/SDK/API，然后独占新鲜 AF-154 test lease 执行：

```sh
AIJ_AF154_ROOT_LIVE=1 node --test scripts/verification/personal-skills-live.test.mjs
node --test scripts/verification/personal-skills.test.mjs
```

live 脚本通过既有目标保护创建 AF-154 新库及真实 API 的 OS 分配 loopback 端口，用3个合成账号/2个 Workspace 验证 OWNER 隔离与默认 MEMBER 拒绝；覆盖并发创建、CAS 单胜、分页、原始历史、删除防复活、100配额、状态与字段/Origin/外部ID拒绝。对拒绝前后计算每张 public 表内容哈希（仅排除 session 的 last_seen_at/updated_at 认证记账列；不声称整个认证链路零写入）。通过真实 SQL audit 失败 trigger 检查三类写入回滚，通过独立 PG 会话阻塞 shared membership advisory fence 验证在途撤权；读取 pg_blocking_pids 观察实际阻塞。运行实际 ESM/CJS SDK 的 Cookie transport 并验证409传播；总控仍须补充已编译声明的 TypeScript consumer 检查。

人工步骤：以两账号分别登录并选择各自空间；使用上表端点创建、同 code 重放、编辑及读取历史；在同一空间 OWNER 身份尝试另一个成员 ID（404）；撤权后读/写（403）；删除后历史读取（404）和 code 重建（409）。没有可宣称已运行的浏览器页面或固定访问地址；只有根验收启动服务后才有实际临时 URL。

后续依赖：个人 Agent 绑定、shared/public/market、脚本沙箱、附件、完整 retention/restore 均未实现；不得将本接口当成这些能力已交付。正式 verify:task、集成 Task 的 SHA、最终代码/PR Review 与 OWNER_CHECK_PENDING 由总控持有，本地候选不是 CODE_VERIFIED 或负责人接收。
