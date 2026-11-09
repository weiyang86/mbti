# AF-141 主 Agent 审核修订候选

## 身份与范围

- Task `task_375b0c529964`，Dispatch `ctx_6cb2bebc413d`，Writer terminal `term_679a2baa-8009-4389-ad16-d9ce18d2650f`。
- 原已注册 Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W02-AF141`，instance `5792afff-920f-4e12-8064-c906d96417a3`；分支 `weiyang86/AIJ-W02-AF141`。
- 本轮开始 status 干净，HEAD `c7fcf13857b06a7897731559b635107c67a1e932`；origin fetch/push `git@github.com:weiyang86/aij-foundation.git`；原卡基线 `94b0236f775fa40a07944c5e0545ac6ce0e123f3` 不变，保留两次旧候选提交，不切分支。
- 只改本卡 Service、纯测试、live 脚本、两份原报告的修订指向及本报告；DTO/Web 保持本轮起点原样。最终完整树从原基线累计八个允许路径。root 仍独占五处共享目标注册、registry/队列/治理/DB，本 Worker 未写 root。
- 原累计 1.70h 保留，本修订上限 0.80h，卡硬上限 4h且至少留 root 1h；本轮有效工程工时估计：证据/设计 0.10h，Service/回归及屏障脚本 0.40h，自查/报告/候选交接 0.20h，共 0.70h，累计 2.40h，留 root 约 1.60h。不是墙钟/计费测量，未触及修订或卡上限。

## 真实证据与合同

root 的 `.artifacts/auto-ai-program-20261105/AF-141/identity-semantics.json` 已只读核对：受保护新 AF141 lease `afba3ec18e6a12a7`，Prisma 6.19 insensitive equals 实际生成 `ILIKE $1`，username/email 各有 2 条模式命中而字面相等只有 1 条。这是 root 的真实复现，原内存 JS 相等测试未证明数据库语义；本轮没有重新运行或复用该库。

AUTH-REVIEW 原报告风险 2 当时只有静态条件分析，未执行运行复现；不反填为已复现。当前负责人/主 Agent 明确合同：已进入成员写事务、正在签发的登录须与 revokeAll 串行，撤销成功后旧在途会话不可用；之后发起的新登录正常。当前修订的真实屏障用例仍 **NOT_RUN**，由 root 最终实测定论。

## 必要实现

登录改用安全 `Prisma.sql`：字段只能由服务端静态 email/username 分支选择，值始终绑定参数；实际 SQL 使用 `lower(column)=lower(input) LIMIT 2`，选择字段保持安全投影及密码/version/status/deletedAt。没有拼入用户 SQL、不把 `%`/`_`/反斜杠转换成转义模式；失效/软删大小写变体仍参与歧义检测。未知/错密码安全响应、两别名共享账号限流、namespace HMAC 与会话事务保持。

revokeAll 在会话 UPDATE 之前对同一 member 行参数化 `SELECT ... FOR UPDATE`，与 login 的 member UPDATE 串行；取得锁后更新本 namespace sessions 和审计。不会递增全局 tokenVersion，不撤销 foreign namespace，不新增 Schema/依赖或改变管理员认证。

纯测试使用实际 Service/DTO/Guard/Controller；身份边界现在接收实际 Prisma.sql 对象，验证身份是单个绑定参数，执行字面身份行为用例；覆盖两字段的 `_`、`%`、反斜杠与邮箱 local-part，带非等价邻居时准确命中、准确身份删除后不把邻居当 owner。成员锁顺序、失败不撤销/恢复、本 namespace 与 foreign scope/version 也直接执行实际 revokeAll。此 adapter 仍不是 PostgreSQL，真实字面语义和并发锁以 live 结果为准。

## 新增 root-only 真实矩阵（NOT_RUN）

原 live 14 场景扩为 16 场景，继续新建 AF-141 独立随机 lease，保留原 opt-in、受保护 DB helper、安全聚合证据与最终 pool0。不得使用 root 复现库或其他 AF lease 兜底。

- `literal-identities`：分别临时设置真实账号 username/email 的 `_`、`%`、反斜杠（邮箱使用 DTO 实际接受的带引号 local-part），插入非等价邻居；六组真实 HTTP 大小写/trim 登录 200 + Cookie/me。把准确身份移走后原输入六次 401，邻居没有 session；finally 恢复本账号字段、删除本测试邻居。临时身份的 HMAC 加入明确本测试桶集合，后续只在场景边界清理，不放宽限流断言。
- `revoke-inflight-login`：第二个实际 API 应用/Prisma 池指向本次同一 lease，不建立第二个旧库；读出并验证两个真实 backend PID 不同。B 先以原真实 Cookie 通过 Guard/authenticate，在 Controller 已调用 revokeAll 但其原函数尚未进入处设置屏障。A 再真实登录，JWT sign 包裹器只暂停在实际 member UPDATE/session INSERT 之后；通过 B 独立连接查不到 A 的新 session，确认未提交。
- 释放 B 撤销原函数后，独立受保护观察连接轮询 `pg_stat_activity`：必须是 B 的真实 PID、Lock wait、`pg_blocking_pids(B)` 包含 A、实际语句含 member_user 和 `FOR UPDATE`。B 的 authenticate 已先完成，`FOR SHARE` 等待不能满足条件；25ms 只是有界观察间隔，不以固定 sleep 成功作证。
- 观察到阻塞才释放 A 提交，等待两个 HTTP Promise allSettled；A 登录返回 200 Cookie，B revoke-all 返回 200，A 的旧 Cookie 与 B 原 Cookie 下一次 `/me` 均 401，本 namespace 活跃 session 为零。合成 foreign namespace session 仍 active/未 revoked/未过期，全局 tokenVersion 原样；解除 hook 后新邮箱登录 200 + `/me` 200。
- 测试仅在该受控场景将真实 Prisma callback transaction 超时临时扩为 15s（maxWait 10s），避免人工屏障撞默认 5s；原事务/原 Service/原 JWT 签名仍实际执行。finally 释放两屏障、收敛两 Promise、恢复 sign/revoke/transaction wrappers、删除自建 foreign session、关闭第二 app；总 finally 再关闭捕获应用并检查 lease 的 aij-api session0。失败不伪造并发通过。

`redacted-storage` 继续检查当前所有 ClientAuth 审计/session/bucket，不输出特殊身份、Cookie/JWT、密码或原始 driver 错误；聚合 JSON 只加上述场景计数/固定标签。foreign session 的元数据状态保留不是跨产品部署通过。

## 检查与交接

Worker 没有执行 DB/API/live 脚本/服务/build/厂商/浏览器；真实 literal、revoke 屏障、pool0、浏览器均 NOT_RUN。root 构建集成后的当前 API，再按既有命令执行 `AIJ_AF141_LIVE=1 node --test --test-concurrency=1 scripts/verification/client-username-login-live.test.mjs`，读取 root 自身 `.artifacts/auto-ai-program-20261105/AF-141/live-*.json`。

| Worker 实际执行 | 退出 | 结果 |
| --- | --- | --- |
| `node --test scripts/verification/client-username-login.test.mjs` | 0 | 最终 53/53（14 顶层 + 39 子用例），fail/cancelled/skipped/todo 均 0；实际新源代码，不是 dist。 |
| `pnpm exec eslint apps/api/src/client-auth/client-auth.service.ts scripts/verification/client-username-login.test.mjs scripts/verification/client-username-login-live.test.mjs --max-warnings=0` | 0 | 定向 lint 无诊断。 |
| `node --check scripts/verification/client-username-login-live.test.mjs` | 0 | 只解析，未导入/执行 live 脚本。 |
| 下方 API Service 源码导入图 noEmit | 0 | 729 文件，0 diagnostics；未 build。 |
| `git diff --check` | 0 | 无空白错误。 |
| `git diff --exit-code c7fcf13857b06a7897731559b635107c67a1e932 -- apps/api/src/client-auth/dto.ts apps/web/app/components/client-workspaces.tsx` | 0 | 本轮 DTO/Web 原样。 |
| 临时纯 ValidationPipe corpus 检查 | 0 | `_`、`%`、带双反斜杠的 quoted local-part 三种邮箱均被实际 DTO 接受；首次检查 require 相对目录误指 apps/api/apps/api 导致 MODULE_NOT_FOUND，改用工作区绝对 DTO 路径后通过。 |

可复现的导入图检查（仅内存配置，无文件改写）：

```sh
node <<'NODE'
const ts = require('typescript'), path = require('node:path');
const config = 'apps/api/tsconfig.json';
const raw = ts.readConfigFile(config, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(config));
const paths = Object.fromEntries(['core', 'contracts', 'runtime-contracts'].map(name =>
  ['@aij/' + name, ['packages/' + name + '/src/index.ts']]));
const program = ts.createProgram(['apps/api/src/client-auth/client-auth.service.ts'], {
  ...parsed.options, rootDir: process.cwd(), baseUrl: process.cwd(), paths, noEmit: true, incremental: false
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: p => p, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n'
}));
console.log(program.getSourceFiles().length + ' import-graph files; ' + diagnostics.length + ' diagnostics');
process.exitCode = diagnostics.length ? 1 : 0;
NODE
```

没有本轮未解决的纯/静态失败；真实 DB 字面语义、并发屏障、pool0 与浏览器仍 NOT_RUN，不能据静态通过改写为 CODE_VERIFIED。只有 root 提供了旧实现身份缺陷的真实复现，本候选的修复效果尚待其运行。

候选标题仍逐字采用「支持客户端用户名密码登录并保留邮箱兼容」。最终完整 SHA 及八路径见 worker_done/git log，正式 CODE_VERIFIED 和负责人 PENDING 接收由 root 保留；候选提交并最后只读核对后明确停止全部写入，不 push/merge/PR/main/tag/部署。
