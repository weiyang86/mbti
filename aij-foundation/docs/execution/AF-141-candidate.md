# AF-141 候选交接：支持客户端用户名密码登录并保留邮箱兼容

审核修订以 [AF-141-review-fix-candidate](AF-141-review-fix-candidate.md) 为当前候选：下文 `equals + insensitive` 的身份语义及无共同撤销锁为旧实现记录，已按 root 真实证据修订；旧纯检查不冒充新真实验收。

补充 root-only 真实 HTTP/PostgreSQL 验收脚本与 NOT_RUN 交接见 [AF-141-live-candidate](AF-141-live-candidate.md)。

## 派工与起点

- 唯一 Writer：本 Orca worker；Task `task_09c06030a1f8`，Dispatch `ctx_5dfd27e58a81`，terminal `term_679a2baa-8009-4389-ad16-d9ce18d2650f`。
- Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W02-AF141`；instance `5792afff-920f-4e12-8064-c906d96417a3`，Orca `baseRef=refs/remotes/origin/dev`。
- 分支 `weiyang86/AIJ-W02-AF141`；初始 HEAD / origin/dev 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；`git status --short --branch` 干净。
- origin fetch/push 均为 `git@github.com:weiyang86/aij-foundation.git`；未切分支、未 push。
- 当前授权读取 root 的 PROGRAM / WAVE-02 / AF-141；本地基线不包含新规划文件，root 只读。
- 预算 3 有效工程小时；阶段估计：核对/依赖/设计 0.35h，实现及目标测试 0.65h，自查/故障修正/报告及候选交接 0.25h，合计 1.25h，未超预算。这是有效工程工时估计，不是自动计费或墙钟测量。

## 实际差异及影响

仅五个允许文件：

- `apps/api/src/client-auth/dto.ts`：只扩展 ClientLoginDto；邮箱与用户名恰好提供一种，混填（另一字段为空串/null 也算混填）、两者缺失、单字段空白/null/非字符串均拒绝；两种身份 trim + lowercase。密码保持原值与既有长度约束。
- `apps/api/src/client-auth/client-auth.service.ts`：只改登录/登录限流局部。按调用方明确选择的 username 或 email 查询 MemberUser，以 `equals + mode: insensitive`、`findMany take:2` 检测歧义；同字段存在大小写等价多条时统一 401，包括另一条停用/软删的情况。不会把带 @ 的用户名回退查邮箱，也不查管理员 SysUser。
- `apps/web/app/components/client-workspaces.tsx`：只改 ClientLogin；默认邮箱以保留现有入口习惯，可明确选择用户名。切换时清除身份、密码与旧错误；只发送所选身份和密码。用户名提示大小写/首尾空格语义，401 统一提示。已运行逐字节检查，ClientLogin 前后内容完全等同基线，注册及其他空间导出保持。
- `scripts/verification/client-username-login.test.mjs`：导入实际 DTO、Service、Controller、Guard、安全函数及 JwtService/bcrypt 执行；内存 Prisma adapter 仅承担查询谓词、存储和事务边界，没有复制认证实现。没有建立 HTTP listener、PrismaClient 实例、DB 连接或通知投递。
- 本候选记录。

输入身份 1–254 字符，用户名不新增字符集限制；保留内嵌空格，不做 NFKC/Unicode 兼容折叠。查询只对存储值忽略大小写，不自动修改或 trim 库中历史用户名；带首尾空格的异常存量身份需另行数据治理，本卡未改数据。邮箱仍按原规则校验，不新增用户名注册或短信。

权限及会话沿用 ClientAuth owner：仅 active 且未软删、具备密码的唯一身份可登录；pending_verification/停用不能登录。保留原有 active 存量账号兼容（包括 emailVerifiedAt=null 或无 email 的已有 username 账号），不追溯增设邮箱验证门槛；新注册仍靠 pending_verification 阻止未验证登录。Controller、Cookie 格式、Guard、namespace/issuer/audience/project/environment、tokenVersion 与注销/撤销逻辑未修改。

数据库结构/Schema/迁移/管理员认证/依赖/锁文件无变更。数据库运行时影响仅为登录多做一次有上界身份查询及账号桶事务；沿用现有 ClientAuthRateBucket 新 scope `login_account`，key 为 namespace HMAC(memberId)，与原 identity5/IP30 共用 15 分钟规则。第五次仍按原行为允许执行并锁定后续请求；用户名与邮箱轮换、IP 轮换都共享同一账号五次额度。成功登录同事务重置所选 identity 与 account 桶，不重置 IP 桶；未知身份继续由 identity/IP 桶限制。

审计使用既有 login/login_failed/login_rate_limited 动作及最小字段，不新增原始用户名、邮箱、密码或 Token。签发/会话/lastLoginAt/审计/成功桶重置仍在同一登录事务；故障关闭与回滚由目标纯测试执行，但真实 PostgreSQL 锁与事务语义仍须主 Agent 验证。

## 实际执行命令及结果

| 命令 | 退出 | 结果 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | 当前子工作区独立安装 726 包，无凭据/env/node_modules/上传数据复制；未改锁文件。pnpm 提示依赖 build scripts 默认未执行，之后单独运行受控 Prisma generate。 |
| `pnpm --filter @aij/api prisma:generate` | 0 | 通过仓库 compilation-only 脚本，显式哑 URL 127.0.0.1:1，跳过 env 加载，Prisma 6.19.0 生成到本工作区 node_modules；无数据库连接。 |
| `node --test scripts/verification/client-username-login.test.mjs` | 0 | 最终 45/45，12 个顶层测试及 33 个子用例；fail/cancelled/skipped/todo 均 0。 |
| `pnpm exec eslint apps/api/src/client-auth/dto.ts apps/api/src/client-auth/client-auth.service.ts apps/web/app/components/client-workspaces.tsx scripts/verification/client-username-login.test.mjs --max-warnings=0` | 0 | 定向 lint 无错误/警告。 |
| 下方 TypeScript API 源码导入图检查 | 0 | API 729 文件 / Web 857 文件，均 0 diagnostics；noEmit，无应用/工作区包 build。 |
| `git diff --check` | 0 | 无空白错误。 |
| 下方 ClientLogin 范围逐字节检查 | 0 | 其他组件及导出未变。 |

45 个有效用例覆盖实际 DTO 转换与拒绝、用户名/邮箱成功及安全投影、未知身份/错误密码统一 401、混填/空值/异常类型/多字节超 bcrypt 限制、大小写重复身份、停用/待验证/软删/无密码、账号别名及 IP 轮换限流、未知身份和 IP30 限流、窗口恢复及成功桶重置、状态/密码/version 写入竞态拒绝、readiness/查询/限流存储/签名/会话/审计/桶重置故障及恢复、Controller 直接调用的 Cookie 与 Origin 路径、Guard 跨 namespace/admin/project/environment/issuer 拒绝、过期/version/当前状态校验、logout/revoke-all 旧会话拒绝。

前期失败如实保留说明：前三轮纯测试各 43/44；分别因测试用 JwtService 重新签发已带 exp 的 claims、同样的 aud/iss 与默认 signOptions 重复、内存 rollback 后测试持有旧 session 对象引用。均为测试装置错误，已修复后最终 45/45。初次导入图检查漏映射 `@aij/sdk`，API 通过而 Web 8 条派生类型诊断；补齐源码映射后 0。范围检查初次命令的 execFileSync options 误传字符串，纠正为 `{encoding:'utf8'}` 后通过；无未解决的本卡检查失败。

精确暂存命令退出 0，但 Git 输出共享对象库中 AppleDouble `._pack-eba6381e66a6b2835c1587ea94c29fe211d1f7ee.idx` 的 `non-monotonic index` 诊断；暂存清单仍准确为五个允许文件，cached diff 检查退出 0。本 Writer 未删除/修复根工作区或共享 `.git` 文件；该环境诊断由总控留意。

可复现导入图命令（仅内存编译选项，不写任何配置）：

```sh
node <<'NODE'
const ts = require('typescript');
const path = require('node:path');
const paths = Object.fromEntries(['core', 'contracts', 'runtime-contracts', 'ui', 'sdk'].map(name =>
  ['@aij/' + name, ['packages/' + name + '/src/index.ts']]));
let total = 0;
for (const [config, files] of [
  ['apps/api/tsconfig.json', ['apps/api/src/client-auth/dto.ts', 'apps/api/src/client-auth/client-auth.service.ts']],
  ['apps/web/tsconfig.json', ['apps/web/app/components/client-workspaces.tsx']]
]) {
  const raw = ts.readConfigFile(config, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(config));
  const program = ts.createProgram(files, { ...parsed.options, rootDir: process.cwd(), baseUrl: process.cwd(), paths,
    incremental: false, noEmit: true });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: p => p, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n'
  }));
  console.log(config + ': ' + program.getSourceFiles().length + ' import-graph files, ' + diagnostics.length + ' diagnostics');
  total += diagnostics.length;
}
process.exitCode = total ? 1 : 0;
NODE
```

可复现前端范围检查（在候选提交前基线 HEAD 执行，交接后亦可用固定起始 SHA）：

```sh
node <<'NODE'
const fs = require('node:fs'), cp = require('node:child_process'), assert = require('node:assert/strict');
const file = 'apps/web/app/components/client-workspaces.tsx';
const base = cp.execFileSync('git', ['show', '94b0236f775fa40a07944c5e0545ac6ce0e123f3:' + file], { encoding: 'utf8' });
const candidate = fs.readFileSync(file, 'utf8');
const start = 'export function ClientLogin()', end = 'function AuthFormFeedback';
assert.equal(base.slice(0, base.indexOf(start)), candidate.slice(0, candidate.indexOf(start)));
assert.equal(base.slice(base.indexOf(end)), candidate.slice(candidate.indexOf(end)));
console.log('All content outside ClientLogin is byte-identical to baseline');
NODE
```

## 总控正式验证与人工矩阵（未运行）

本子工作区没有服务运行、没有可宣称已运行的访问地址。下列为 root 在已核验隔离测试库/授权服务上须补的证据，不是本卡纯测试已完成的 HTTP/DB/浏览器结果：

| 层级 | 操作 | 预期与应记录证据 |
| --- | --- | --- |
| HTTP/DB | 合成 active username 登录、混合大小写及首尾空格，再以邮箱登录同账号 | 两路均 200；JSON 仅安全 member；真实 Set-Cookie 和 `/me` 200；namespace、session、login audit、lastLoginAt 原子写入。 |
| HTTP/DB | unknown username/email、错密码、带 @ 但不存在的 username、disabled/suspended/pending_verification/软删账号 | 均 401 同安全响应，无 Cookie/会话；无原始身份/密码审计；包括新注册未验证拒绝。active 旧账号空 emailVerifiedAt 的兼容与原逻辑一致。 |
| HTTP/DB | 两字段混填、混填空串/null、两字段缺失、全空白/null、未知字段、超 72 UTF-8 字节密码 | 400，无 Cookie/会话；通过真实 Nest ValidationPipe/异常响应链验证。 |
| HTTP/DB | 同一字段写入大小写等价的两个合成身份，包括另一条停用/软删；分别测试 username/email | 401，无 findFirst 任选登录；由真实 PostgreSQL collation/Prisma 查询验证。 |
| HTTP/DB | 同账号 username/email 交替错误五次，并轮换来源 IP，第六次正确密码；并发请求、15 分钟窗口恢复 | 第六次 429；并发不能超发账号预算；窗口过期恢复，成功只重置 identity/account，IP30 保护保留；桶只存 HMAC。 |
| HTTP/DB | 缺 Origin、错误 Origin、cross-site；错误 Cookie/管理员 token/namespace/issuer/audience/project/environment | 写入 403 或会话 401，不设置有效 Cookie；原客户端安全边界保持。 |
| HTTP/DB | 两种登录各得会话后 logout/revoke-all、改密/reset 或 tokenVersion 变更，再请求旧会话；并发停用/改密 | 旧会话 401；项目范围撤销保持，其他 namespace 不受项目注销影响；凭据变更全局撤销原规则保持。 |
| HTTP/DB | 在独占隔离验收中模拟签名/会话/审计/桶故障与 DB 不可用，恢复后重试 | 503，无可用孤儿会话；事务及数据库 advisory lock 真实语义通过；恢复成功。 |
| 浏览器 | 打开 root 实际运行的 `/client/login`，默认邮箱登录、改为用户名、混合大小写输入、返回邮箱；键盘/窄屏 | 明确方式与对应 label，切换清空身份/密码/旧错误；抓包仅所选字段及密码；成功跳转 `/client/workspaces`，Cookie 自动参与 `/me`。 |
| 浏览器 | 错误、429、故障后恢复、已有会话继续、退出切换账号；点击注册/忘记密码 | 提示安全一致，busy 禁止切换/提交；会话展示/退出可用，原注册及找回入口保持。 |

建议总控先精确集成允许文件，再登记/执行 `verify:task -- AF-141` 与适用门禁、串行 DB/HTTP 和浏览器矩阵。子工作区基线尚无 AF-141 正式 registry，本 Writer 按派工未改 registry/队列，也未运行全库 build、Docker、seed/migrate 或任何真实厂商/通知/付费。

## 交接与剩余

候选本地提交标题逐字为「支持客户端用户名密码登录并保留邮箱兼容」，仅精确暂存上述五文件；提交 SHA 以 `git log -1` 和 worker_done 收据为准。未 merge/push/PR/main/tag/部署，未修改正式状态；候选完成不等于正式 CODE_VERIFIED，负责人接收仍 PENDING。

没有本卡范围内已知未修复失败；用户名注册、短信、异常存量数据治理不在本卡，完整 REQ-005 未由此验收。下游必须引用主 Agent 正式完成后的真实 I-* ID，本候选 Task 不能代替集成依赖。

Writer 在候选提交及最后只读核对完成后停止全部写入并交接；后续修订需由总控明确退回同 Writer。本报告明确授权总控在收到停止写入的 worker_done 后接管精确集成。
