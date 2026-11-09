# AF-174 候选交付：实现知识网页正文提取与规范化适配器

状态：CANDIDATE / ROOT_VERIFICATION_PENDING；本卡不是 CODE_VERIFIED、DEV_INTEGRATED 或负责人接收。Writer 在本地候选提交后明确 STOP ALL WRITING，通过本派工的 worker_done 交接；总控完成正式门禁后自行记录接收状态，本候选记录不冒充正式队列。

## 真实派工与每阶段边界

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W10-AF174`，instance `250a7a89-ebc9-4559-a04d-e409a424dc43`，已由 `orca worktree current --json` 回读。
- Task：`task_56258479cdcd`；Dispatch：`ctx_64b0e50c5e85`；Writer terminal：`term_f9598e80-dcd4-4dcf-9ab2-ae68b53e893f`；总控 terminal：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支：`weiyang86/AIJ-W10-AF174`；初始 HEAD 与 origin/dev：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`；初始 `git status --short --branch` 无修改。
- fetch/push remote 均为 `git@github.com:weiyang86/aij-foundation.git`。没有 fetch、push、切换分支、修改远端 Issue/PR、merge、tag、部署或发布；origin/dev 保持原 SHA。
- bootstrap、实现、测试修复、文档与提交写阶段均重新核对 status/branch/HEAD/origin/dev/remotes，命令结果留在本次终端上下文；本次生成的初始 Worktree 和写阶段元数据另存忽略目录 `.artifacts/af174/`。后续所有工作区变化仅为下面五个允许文件。
- 真实本地时间约 2026-11-06 00:57–01:15（Asia/Shanghai），有效工程耗时约 0.30 小时，低于 Worker 1.5 小时上限；本卡总预算仍包括总控验证时间。

## 单独 bootstrap（只读来源）

唯一恢复文件 `apps/api/src/plugins/aij-ai/knowledge-web-reader.ts` 来自同库提交 `8ebad0d62ae043e9ec0ca1b9b0f8df1a2b23b622`、集成 Task `task_57147e888d52`。恢复前对 git blob 计算并核对 SHA-256，恢复后和交接前回读均为 `4c538e2dbc028954b0788fcf857cc18ef6e8a74e21748e2aa765edb9cc52f6a6`。单独 bootstrap 提交：`db525c74c7f9faea0f44d762a788dfc1b8eb59a4`；以后未修改 reader。没有 env、客户数据、依赖目录、凭据或 Schema bootstrap。该提交仅为候选编译源码，不声称基线正式集成。

## 本卡实际 diff

1. `apps/api/src/plugins/aij-ai/knowledge-web-extractor.ts`：默认/命名异步函数，真实 htmlparser2 Parser 双扫描、共享事件预算、128 深度栈，严格 fetched/type/bytes/UTF-8/hash 复验，固定版本、精确结果形状、归一化标题正文和 SHA-256/字节数。article→main→body→片段可见候选，隐藏/活动子树排除，实体/Unicode、段落/列表/表格/br 边界，固定错误码与真实取消。输出/标题/块/事件超限一律拒绝，不截断。
2. `scripts/verification/knowledge-web-extractor.test.mjs`：9 组真实 parser 运行测试，Worker 模式只用自己的 scratch 消费者；支持总控显式选择实际编译 API 产物模式，两模式均核验 parser 版本。
3. `scripts/verification/knowledge-web-extractor-live.test.mjs`：总控专用实际编译模块 + AF-171 reader 自有 HTTPS fixture 测试；Worker 仅语法/lint 检查，未执行。生产 reader TRUSTED 测试 transport seam 只路由自有 loopback，不声明公网请求；304/字节/hash/默认提取/无脚本或资源副作用/清理自有 socket=0 均为待总控运行的断言。
4. `docs/development/KNOWLEDGE_WEB_EXTRACTOR.md`：接口、策略、规范化、静态 CSS/JS/HTML5 限制、真实依赖与总控运行说明。
5. 本执行候选记录。

候选提交标题逐字为 `实现知识网页正文提取与规范化适配器`，父提交为独立 bootstrap。候选提交 SHA 通过提交后的 worker_done 精确回报，避免记录自身 SHA 递归。只精确暂存本卡五文件，不包含 bootstrap、忽略 scratch 或其他卡内容。

## 实际验证、失败与证据

Node `v24.21.0`，pnpm `10.0.0`。独立执行 `pnpm install --frozen-lockfile --ignore-scripts`，退出 0，锁文件无需更新，安装 726 包；没有运行依赖 postinstall/DB 操作。隔离消费者仅声明 `htmlparser2: "10.1.0"`，执行 `pnpm --dir .artifacts/af174/parser-consumer --ignore-workspace install --ignore-scripts` 成功，实际回读包版本 10.1.0；仅该忽略目录新增 manifest、lock、node_modules。正式 API manifest/根锁保持原样，parser 转译/运行解析路径是该 scratch 的真实 CJS 导出，不是 mock 或 vendor。

| 实际命令 | 结果 | 证据（本工作区忽略路径） |
| --- | --- | --- |
| `node --test scripts/verification/knowledge-web-extractor.test.mjs` | 9/9 pass，0 fail，约 0.24 秒，退出 0 | `.artifacts/af174/unit-final.txt` |
| `pnpm exec tsc -p .artifacts/af174/tsconfig.json` | 定向真实 noEmit 退出 0 | `.artifacts/af174/typecheck-final.txt`；配置同目录 |
| `pnpm exec eslint apps/api/src/plugins/aij-ai/knowledge-web-extractor.ts scripts/verification/knowledge-web-extractor.test.mjs scripts/verification/knowledge-web-extractor-live.test.mjs --max-warnings=0` | 退出 0，无警告 | `.artifacts/af174/lint-final.txt` |
| `node --check scripts/verification/knowledge-web-extractor-live.test.mjs` | 退出 0，仅语法检查 | `.artifacts/af174/live-syntax-final.txt` |
| `git diff --check` | 退出 0 | `.artifacts/af174/diff-check-final.txt`，提交前另检查 staged diff |

最终逐项命令与真实退出码由同步 spawn 收集在 `.artifacts/af174/checks-final.json`，没有用后续 cat 命令的退出码替代验证结果。typecheck 继承实际 API 编译设置，仅 include extractor 与只读 reader；htmlparser2 的类型路径指向独立消费者，Node 类型取本工作区 hoisted node_modules。

关键通过项：精确形状/确定性；标题与候选优先级/无重复嵌套；全部排除子树及 hidden/aria/style；实体、中文/emoji、4096 边界代理对；隐式 p/li 闭合、畸形隐藏嵌套、自闭合 script/style/template、未闭合 script、SVG foreignObject；纯文本 CRLF/空白；保留空表格列及单元格内段落；真实 Buffer、byteLength、严格 UTF-8、源 checksum/type/304/空/控制字符/非法实体；深度 128 成功和 129 拒绝；双扫描/实体事件预算拒绝；2000 块成功和 2001 拒绝；1 MiB 实际源成功和超限拒绝；128 KiB 正文与 200 标量标题精确边界；预取消不读源和在解析中真实 AbortController 取消；异常/取消 reason 不泄漏；源快照；含脚本/fetch 指令的 HTML 只作数据、无全局/fetch 副作用，并审查无网络/存储/执行导入。

早期失败按实保留：第一次 harness 从 `htmlparser2/package.json` 子路径读取版本触发 `ERR_PACKAGE_PATH_NOT_EXPORTED`，改为从真实解析入口定位 package.json；没有更换 parser。第一次完整测试为 8/9：事件 fixture 用 13000 个空 i 元素只产生约 78000 个双扫描回调，没有跨 100000 上限，改为 17000（增加输入、不放宽预算），随后 9/9；失败输出 `.artifacts/af174/unit-1.txt`。首次定向 noEmit 因 typeRoots 错指非 hoisted 的 apps/api/node_modules/@types 报 TS2688，按真实独立安装布局改到本工作区根 Node 类型；`.artifacts/af174/typecheck-1.txt` 留存，后续通过。自查补充表格内段落/br 折叠策略与回归用例，未伪造修复前失败实跑证据。不存在遗留失败或环境阻塞。

## NOT_RUN / 总控必要后续

- **NOT_RUN**：正式完整 API build/typecheck、实际 API runtime parser 依赖验收、live HTTPS 脚本、`verify:task AF-174`、数据库/Docker/migrate/seed、应用启动、Web 构建、SDK/browser、外部 URL、模型/embedding/通知/支付。不得从本次 scratch 测试推断这些通过；无真实产品访问地址。
- 总控在明确 STOPPED 交接后，唯一共享请求是在实际 API manifest/锁增加精确 runtime `htmlparser2@10.1.0`，然后实际 API build，并用 `AF174_COMPILED_API_DIR` 运行本卡 unit+live。root 独占任何 DB/重型构建。无需新模型、SQL、Schema/module/SDK index 变更。
- 总控正式登记/执行 verify:task 与适用真实门禁、实际候选集成检查、执行/队列更新、原名本地正式提交及远端操作依负责人授权，完成 I-* 集成 Task 才算集成；下游依赖引用其真实 Task ID。当前依赖 AF-171 集成 Task `task_57147e888d52`；Worker 不创建虚假 I-* ID。
- 数据库/接口/页面/权限/菜单/业务日志：均无修改、无写入；只新增可复用函数和测试文档。不存在 HTTP 导入 API、知识发布、持久化版本选择、embedding 或执行 URL 的新增承诺。
- 人工验收：总控实际编译后看 unit/live 成功与拒绝路径、结果 checksum/byte counts、标题/段落/表格/隐藏过滤、取消/超限、TLS fixture 清理 socket=0；查阅静态内容限制。批次出口仍为 OWNER_CHECK_PENDING；自查不冒充独立 review 或负责人接收。
