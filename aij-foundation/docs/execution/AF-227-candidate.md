# AF-227 候选交接：提供个人文档章节生成事务源门与持久来源结构

状态：**CANDIDATE_READY，非 CODE_VERIFIED；root 接线/正式验收 NOT_RUN，负责人接收仍独立进行。** 本记录为同一 Writer 自查，不是独立复核；没有使用子代理或 Trea。

## 身份与隔离

| 项目 | 实际值 |
| --- | --- |
| Task / Dispatch | `task_c9ae4da812e3` / `ctx_87070f867e21` |
| Writer terminal | `term_4a61ee46-961d-4f5a-9f30-7b03aaeebadf` |
| Coordinator terminal | `term_26cef18e-31e9-4c43-8f62-bd8db5c92ea5` |
| Worktree | `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W24-AF227` |
| Worktree instance | `8dd85314-f14e-4cd0-8934-838e34535ce7`，注册的非 main child |
| Parent | 原 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation`，只读其 W24 CONTRACT/SOURCE_BOOTSTRAP |
| Branch | `weiyang86/AIJ-W24-AF227`，未切换 |
| 初始 HEAD / origin/dev | 均 `94b0236f775fa40a07944c5e0545ac6ce0e123f3` |
| 初始 status | `## weiyang86/AIJ-W24-AF227`，无 tracked/untracked 差异 |
| Remote | `origin git@github.com:weiyang86/aij-foundation.git`，fetch/push 相同；没有 push |

已先发身份回执 `msg_056902786956` 并继续，没有轮询 coordinator 或注入终端。根工作区只读冻结契约/清单及 W24 文件名定位，不读 live 源码、真实 env、用户原型或源产品仓库。工作区的 `node_modules` 是独立实目录；沿原 `.npmrc` 的 hoisted/copy 安装，没有共享 node_modules、凭据或上传目录。

## Source-only bootstrap 与候选范围

- 清单 SHA256：`ccc1f0f9fa3c950debb65ed2eb0954ebf57523d07281b8aef191c736fbc088db`。
- 每项均使用 `git show 165338eb41eca99d3b779964a7e9f73f402a0d23:<path>` 取回原 blob，写入前校验清单 bytes/SHA256/Git OID/ls-tree mode，写入后再次校验 SHA256/模式；1085/1085 通过。
- source-only bootstrap：`fd19cb63a62e596e017bcba228506413a873a952`，父为起始 SHA；562 个实际差异文件，其余清单文件已相同，无删除；没有 merge/cherry-pick root 历史。
- install 及最终自查后，1085 冻结文件仍逐 SHA256/模式精确相同，没有锁文件、全局依赖、正式 schema/migrations、共享 owner、public barrel、queue/registry 改动。
- 候选提交只含下列 5 个 allowPaths；最终 candidate SHA 以交接消息中 `git rev-parse HEAD` 的实际回读为准，本记录随候选提交，不自引用其 SHA。

| 实际新增文件 | 实际 diff |
| --- | --- |
| `apps/api/src/documents/personal-document-run-source.ts` | 导出冻结 selector/ref 类型与严格解析，复用原 DTO 与 W23 唯一 parser，完整 slice ≤2000 UTF16，UTF8 hash，不变异/归一化/截断；当前身份/版本/正文/section 冲突 409，非法或空/blank/超长 400 |
| `apps/api/test/personal-document-run-source.test.ts` | 18 项真实纯函数边界测试，无 DB/session/runtime collaborator 冒充真实验证 |
| `docs/planning/auto-ai-program-20261105/W24/AF-227-ORIGIN_SCHEMA.sql` | 未执行的 additive 来源关系 DDL 建议，5 个真实复合 FK、精确 ref CHECK、原 Run marker/provenance/inputSha256 guard、55000 不可变；双向来源互斥建议由 root 审查 |
| `docs/planning/auto-ai-program-20261105/W24/AF-227-ROOT_WIRING.md` | 原文档 owner 同 tx 门、锁序/权限/session 回调、inspect 变更语义、原 schema 映射与 root 真实验证清单 |
| `docs/execution/AF-227-candidate.md` | 本身份、来源、命令、影响、限制与交接记录 |

## 实际验证与诊断

Node `v24.21.0`，pnpm `10.0.0`。下表各验收命令 exit 均为 0，没有隐藏非零测试或跳过测试：

| 命令 / cwd | exit 与实际结果 |
| --- | --- |
| Python bootstrap（逐 `git show/hash-object/ls-tree`，精确清单 path 暂存，独立 source-only commit）/ child 根 | 0；1085 blobs 通过，bootstrap SHA 如上 |
| `pnpm install --frozen-lockfile` / child 根 | 0；8 workspace projects，800 packages，lockfile up to date；原 pnpm 策略跳过 dependency build scripts，未放开策略 |
| `node --test -r ts-node/register test/personal-document-run-source.test.ts` / `apps/api` | 0；最终 18 tests / 18 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo |
| `pnpm exec tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --types node src/documents/personal-document-run-source.ts test/personal-document-run-source.test.ts` / `apps/api` | 0；定向类型检查通过 |
| `pnpm exec eslint apps/api/src/documents/personal-document-run-source.ts apps/api/test/personal-document-run-source.test.ts --max-warnings=0` / child 根 | 0；无输出、无 warning |
| Python 静态映射审计及最终 frozen blob/mode 复验 / child 根 | 0；5 个 FK/UNIQUE 真实模型/表映射匹配、5 个 RESTRICT；1085 blobs/modes 仍一致；**只是静态审计，没有执行 SQL** |

覆盖：whole slice 2000/2001（含标题/换行）；空/blank；UTF8 bytes 与 UTF16 units；emoji、组合字符、LF/CRLF/CR；完整 body 65536-byte 上限；body 其他节变化、revision/id/section 不一致；新 body 含非法标题时旧 selector 仍安全 409；getter/setter/symbol/hidden/proto/额外键；null-prototype；128 节含 prelude、129 拒绝；标题 256/257 codepoint；原 fence 语义；冻结/脱离输入；错误无正文回显。

保留诊断：Git 在读取共享对象目录时反复输出 `non-monotonic index .../objects/pack/._pack-f03e767c944ca97bc7cba847811aab0e60e02cb8.idx`，上述 Git 命令实际退出 0，blob/hash/模式校验成功；未修改该共享 AppleDouble 文件或 Git 元数据。最初定位 child 的 W24 路径 `rg` 返回 2（该目录不在起始 Git tree），改为仅按授权读取 root W24；另一次误探旧 `apps/api/src/ai/` 文件路径失败，随后以本 child 的 `rg --files` 找到 `plugins/aij-ai/` 冻结源码，未把探查错误当作验证通过。依赖安装还给出 Node url.parse deprecation 与 skipped dependency build scripts 提示，没有改全局依赖或重跑它们。

## 影响、未实现和 root 责任

实际数据库影响为 0；没有连接 DB/seed/migrate/reset，没有应用服务、Docker/native、付费 provider 调用或上传。接口/页面/权限/日志现有行为没有改动；新 helper 尚无 production caller，未新增 route、permission 或 audit 写入。没有生成 Prisma client，没有全 API/Next/root verify 或小包构建；对这组纯 helper 不需要这些产物。

NOT_RUN：DDL 的 PG 语法/真实 FK/55000/跨连接互斥与 JS/PG digest 一致性；当前原 owner 同 tx rollback/锁/session callback；真实 read/execute 权限与并发拒绝；原文档 CRUD/history/export 回归；Run/Job/Trace/budget/provider/retention 路径；HTTP/private noStore/SDK/页面；本卡注册 verify:task 与正式质量门禁。离线单元和静态映射均不能证明这些通过。

root 必须审查建议 DDL 并登记实际 migration/model，接线 PersonalDocumentsService 与 DocumentsModule、原会话及 AF228 adapter，在受保护 55433 新逻辑验收库串行完成真实验证。建议的 workflow-origin 配套插入 guard 只存在于本候选 SQL 中，未修改原 workflow owner；root 需审查双向插入同 Run 行锁顺序并实测，不能把它当已生效的数据库约束。所有 root 接线细节及人工步骤见 `AF-227-ROOT_WIRING.md`。

访问地址：**无，未启动任何服务**。人工验收应在 root 实际运行后按接线说明执行 read 无 export/manage、execute 拒绝缺 manage、旧 selector 冲突、新会话查回、真实 FK/不可变及旧文档回归；生成预览/确认写回 UI 另批。下游必须依赖 root 正式验证并按原标题提交后的真实 I227 Task ID，不能引用本候选为 CODE_VERIFIED；这里没有虚构 I227 ID。

本 Worker 约 **0.3 有效工程小时**（含 bootstrap/install、实现、探查、离线校验、自查与记录，UTC 2026-11-08 约 16:00 起），低于 1.5h 上限；整卡 3.25h 的 root 部分尚待总控登记。候选精确提交、回读 SHA 并发送 worker_done 后 **STOP ALL WRITING**，交回 Writer；无存活服务/测试进程，不写主 dev，不开下一卡、不轮询 check、不 push。
