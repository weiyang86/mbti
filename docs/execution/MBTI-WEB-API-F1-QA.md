# MBTI Web API F1 补充验收与契约核查

本报告是内部 QA 记录，不定稿或改写业务契约。范围仅 F1 的 8 个操作；没有修改 Web、后端、Prisma 或输入包，没有迁移、seed、启动第二个 API、push 或 merge。

## 来源与本轮结论

- Run：`run_594d408d15de`；Task：`task_3ea09f166e25`；Dispatch：`ctx_fb66abc90a1a`。
- 工作树：`/Users/lei/orca/workspaces/mbti/mbti-web-api-f1-qa`；基线：`3c0b9eb5c6fa52e56a7418a1b27e73827bd4070b`。
- 输入包：`/Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane`，已读 `RUNBOOK.md`、`API-REVIEW.md`、`MBTI-WebAPI-13.openapi.yaml`、`fixtures/quiz-candidate.json` 和 `smoke.py`。
- 候选 OpenAPI：`0.4.0-fastlane-candidate.1`，统计为 F1 8 项、F2 5 项；根 `docs/api/openapi-v0.1-draft.yaml` 未修改。
- PR #20 消费核查使用本地 Git 对象 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f`，不依赖远程页面当前内容。
- **2026-11-09，补充真实 HTTP 验收 PASS，退出码 0**：`http://127.0.0.1:4056/api/v1`，服务由后端 owner 提供。未读取或复用独立 `aij-foundation` 仓的库、依赖和验收结果。
- **NOT_RUN**：本 Worker 的重启前保存/重启后复验、原包 smoke 实跑、H5 页面/双浏览器/跨设备/CORS、过期 token。原 smoke 与服务重启由总控及后端 owner 协调，不能把本报告当成这些项目的通过记录。

## 接口验收矩阵

所有成功响应均为裸业务对象。受保护操作用 `X-Guest-Token`，错误最少为非空字符串 `code`、`message`；脚本不依赖具体错误码字符串或错误文案。

| # | F1 方法与路径（省略 `/api/v1`） | 候选输入/成功字段与状态码 | 原 `smoke.py` 已覆盖 | 本脚本补充与实测 |
|---|---|---|---|---|
| 1 | `GET /health` | 无凭证；200；`status` 必需、`version` 可选 | 已检查状态与字符串 | 不复制；初次探活未就绪见执行记录，之后总控提供 ready 服务 |
| 2 | `POST /auth/guest` | 无 body/凭证；201；`guest_token`、未来 `expires_at` | 两个独立游客与过期时间格式 | 以本次新建 A/B 隔离测试数据，201；不输出 token |
| 4 | `GET /quiz/versions/current` | 200；`question_bank_version`、12 个 `questions`；题目 `id/index/dimension/prompt/options`，选项 `id/label` | 12 题、各维 3 题、同版本固定题文/顺序、golden 计分 | 缺/错凭证各 401；只读取真实题库构造补充测试输入，不复制 golden 流程 |
| 5 | `POST /quiz/sessions` | 可选 `question_bank_version`；201；`id/question_bank_version/status/answers`；初始 `in_progress` | 冻结版本与空答案 | 显式 pin 读取到的版本；缺/错凭证各 401 |
| 6 | `PUT /quiz/sessions/{session_id}/answers` | `{answers:[{question_id,option_id}]}`；200 返回完整 `QuizSession`；未传题目保留 | 两题逐次增量、非法 option 422、跨人写入 404 | 覆写一题保留另一题；跨维合法 option/未知 option/未知 question 都 422；拒绝后状态未被污染；补第 12 题保留前 11 题；已提交迟到答案 409；缺/错凭证各 401；提交前后跨人均 404 |
| 7 | `POST /quiz/sessions/{session_id}/submit` | 可选 `life_stage/recent_status`；**201** 返回 `ResultSnapshot`；已交卷 409，缺题/非法 422 | 空会话 422、并发 201+409、快照字段、golden | 11/12 题 422 且列表无结果；barrier 同时发起两个请求恰为 201/409；分页全量核对仅一个结果；重放 409；迟到写入后详情完全相同；缺/错凭证各 401；提交前后跨人 404 |
| 8 | `GET /results` | `limit` 1–100，默认 20，`cursor` 字符串；200；`items`，`next_cursor` 字符串或 null；提交时间倒序、ID 稳定断序 | 新号为空、A 两条、B 空、不覆盖历史 | A 3 条/B 2 条，分别走 limit=1/2/100 至结束，无漏项/重复/串人；不同 limit 顺序一致且重复读取稳定；summary 与详情一致；双向跨人 cursor 均 422；缺/错凭证各 401 |
| 9 | `GET /results/{id}` | 200 返回本人 `ResultSnapshot`；他人 404 | 交卷/详情一致、跨人 404 | 缺/错凭证各 401；迟到保存和重复交卷后完整详情不变；跨人 404 |

`ResultSnapshot` 必需 `id/source/type_code/question_bank_version/submitted_at`；测评分支还要求 `dimension_counts`（E/I/S/N/T/F/J/P，各维总数 3）；`session_id` 和阶段背景为可选字段。`ResultSnapshotSummary` 必需同名 5 字段，不要求计分。补充脚本通过同一新游客的完整列表计数核对“一会话只落一个结果”，没有要求不存在于候选契约的会话读取 API。

## fixture 与 PR #20 差异

静态核查确认：fixture、PR #20 的 `web/src/api/mock/questions.ts`、基线 `UIhtml/mbti-buddy-prototype.html` 的 12 题题干、顺序及 A/B 文案逐字一致；ID 为 `q1`–`q12`、index 为 1–12，维度按 EI/SN/TF/JP 重复三次，选项 ID 为对应维度的小写字母。fixture 两组 golden 输入分别选所有第一项/第二项，预期 ESTJ/INFP。标准 smoke 负责真实服务同版本文本及计分校验，本脚本不再实现一套评分逻辑。

| 证据位置（PR SHA 如上） | 差异与影响 | 验收边界 |
|---|---|---|
| `web/src/api/client.ts` | 从构建变量 `VITE_GUEST_TOKEN` 取全局凭证，无 `POST /auth/guest` 初始化、独立浏览器持久身份或到期处理 | 必要接线由 Web owner 完成；本脚本只证明 API 身份隔离，不能证明页面刷新复用身份 |
| `web/src/api/quiz.ts`、`results.ts`、`types.ts` | 路径、`{answers}` 包装、snake_case 字段及裸对象与 F1 候选基本一致；请求层接受任意 2xx；没有 GuestSession 类型/封装 | 候选交卷成功为 **201**，并非 200；脚本严格断言 201。总控已说明早先派单 200 为笔误 |
| `pages/test-intro/test-intro.vue` 的 `beginNewTest` | 先 `createQuizSession()` 不传版本；答题页另取 current，可能跨一次题库切换 | 按 RUNBOOK 先缓存题库和版本，再 pin 该版本建会话 |
| `pages/quiz/quiz.vue` 的 `load/restoreDraft`、`store/quiz-draft.ts` | 草稿有 `questionBankVersion`，但恢复只匹配 sessionId，又使用新 current 的题文，没有对照或恢复原题库 | F1 不增加未约定的版本读取接口；旧题库无法恢复时按 RUNBOOK 提示重新开始并保留历史 |
| `pages/quiz/quiz.vue` 的 `persistOne/submitAll` | 单题保存不等待，最后整批保存后提交；可出现迟到请求；409 分支会清草稿并引导历史 | 已真实验证提交后迟到保存为 409 且结果不变；“提交前旧单题请求覆盖较新整批答案”的顺序问题不在本次固定并发测试覆盖内 |
| `api/mock/questions.ts` 对比 dev 同路径 | PR 与 dev 内容/顺序不同，却都标 `qb-v0.4-teach-1` | 候选 fixture 单独用 `qb-v0.4-prototype-1`，不能覆盖旧版；OpenAPI schema example 仍残留 teach（见 unknowns） |
| 首页与结果页的 `listResults({limit:50})` | 首页用 items.length 作记录数；结果页只在这 50 条内找严格更早的同版本结果；没有消费 cursor | API 分页通过不代表页面全量计数/同时间前驱逻辑通过，页面验收另记 |

## 补充脚本运行方法

[脚本](../../scripts/mbti-fastlane-check.py) 仅用 Python 3.9+ 标准库，直接访问 `--base`。普通 check 每次创建两个游客、A 三个测评结果/B 两个结果，保留合成数据供排查，不调用 F2 删除接口，不访问数据库。与原 `smoke.py` 分别运行，不把输入包拷进仓库。

```bash
MBTI_API_BASE=http://127.0.0.1:4056/api/v1
python3 /Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane/smoke.py --base "$MBTI_API_BASE" --phase F1
python3 scripts/mbti-fastlane-check.py --base "$MBTI_API_BASE" --phase check
```

退出码 0 表示所选 phase 通过；1 表示断言、网络或文件失败；参数解析错误为 2。每次请求只打印固定测试标签、方法及状态码，不打印 token、响应体、URL、cursor 或异常值；API 重定向被拒绝，不向其他 origin 转发凭证。没有 HTTP mock、镜像业务实现的单元测试或服务管理逻辑。

### 持久化两阶段（由服务 owner 重启）

`--state` 必须由操作者显式给出；仓内文件必须被 Git ignore，或指定仓外文件。文件只存合成游客秘密、会话/结果 ID、快照与列表基线，以 0600 独占创建，不覆盖现有文件、不接受文件符号链接；不要提交、展示或附到日志中。以下路径使用仓库现有 `tmp/` ignore，不需要改 `.gitignore`。

```bash
mkdir -p tmp
python3 scripts/mbti-fastlane-check.py --base "$MBTI_API_BASE" --phase prepare-restart --state tmp/mbti-f1-restart.local
# 将服务实际 stop/start、前后 PID/启动时间以及同一数据库/配置的证据交由服务 owner 记录。
# 本脚本不会 kill、启动或自动重启 API；待 owner 确认已重启后执行：
python3 scripts/mbti-fastlane-check.py --base "$MBTI_API_BASE" --phase verify-restart --state tmp/mbti-f1-restart.local
```

prepare 运行完整补充验收，再额外建立一个保存两题的草稿。verify 不领新游客，用保存的同凭证、同 5 个 result ID、同 session ID 验证详情/列表完全一致、已交卷仍 409、跨人仍 404、迟到写入仍 409。F1 没有 GET session：verify 只重放草稿中的第一题相同答案，要求第二题仍在，以此验证草稿持久化。verify 不提交草稿，可在有效期内重复执行；过期凭证应失败，不静默换游客。

prepare 单独通过不代表持久化通过。verify 自身也不能识别 owner 是否真的重启过服务，须与 owner 的停止/启动证据一起归档。复验必须使用 state 中同一 `--base`；origin 改变会失败，避免把秘密发送到另一个环境。完成后由操作者删除该秘密文件。

## 2026-11-09 实际执行记录

| 实际命令或检查 | 退出码 | 观察结果 |
|---|---:|---|
| `orca ports --worktree path:/Users/lei/orca/workspaces/mbti/mbti-web-api-fast-integration --json` | 0 | 初始 integration 尚无监听端口；没有启动或修改服务 |
| `curl --silent --show-error --fail --connect-timeout 2 --max-time 3 http://127.0.0.1:4056/api/v1/health` | 7 | 初次 connection refused。之后总控消息确认 API ready，遂执行补充验收；此处未轮询 |
| Python `ast.parse` + 内存 `compile`，目标 `scripts/mbti-fastlane-check.py` | 0 | 语法通过，不生成 pycache |
| `python3 scripts/mbti-fastlane-check.py --help` | 0 | 三 phase、显式 base/state/timeout 参数可用 |
| `python3 scripts/mbti-fastlane-check.py --base invalid` | 1（预期拒绝） | 拒绝非法 base，未发 HTTP 请求 |
| `python3 scripts/mbti-fastlane-check.py --base http://127.0.0.1:4056/api/v1 --phase prepare-restart --state docs/execution/mbti-f1-secret.json` | 1（预期拒绝） | 拒绝非 gitignored 仓内秘密状态路径，未创建文件/游客 |
| Python 标准库静态核查：读取输入 fixture/OpenAPI，`git show` 固定 PR questions，再与原型 QUIZ 比较 | 0 | F1=8/F2=5；12 题/选项文本及顺序完全一致；ID/index/维度及两组 golden 输入一致 |
| `python3 scripts/mbti-fastlane-check.py --base http://127.0.0.1:4056/api/v1 --phase check` | **0** | **真实 HTTP 全部通过**；具体成功与拒绝证据见下表 |
| `git diff --check`（精确暂存后含 `--cached`） | 0 | 无 whitespace 错误；只提交本任务两文件 |

精确 `git add -- scripts/mbti-fastlane-check.py docs/execution/MBTI-WEB-API-F1-QA.md` 退出码 0，但 Git 对共享对象库中的 AppleDouble `objects/pack/._pack-f00f29c8fa0b9d3c330b8414340b55cf2aff5fff.idx` 发出 `non-monotonic index` 警告。未清理或修改共享 `.git`；暂存清单仅上述两个文本文件，没有 `._*`、环境文件、日志或产物。

| 实际 HTTP 证据 | 本次结果 |
|---|---|
| 新游客、建会话、正常保存/详情/列表 | 游客及建会话 201；保存/详情/列表 200 |
| 缺凭证与错误随机凭证 | 两组各 6 个受保护操作全部 401，错误有 code/message |
| 非法 option、其他维度的合法 option、未知 question、11/12 题交卷 | 四种情形全部 422；未产生结果，原答案未被拒绝请求改写 |
| 同会话同步起跑并发交卷 | 恰为 **201 + 409**；全量分页结果恰一条；重放 409 |
| 迟到答案 | 409；之后详情与原始完整快照相等 |
| 跨游客写入/交卷/详情 | 404；写入和交卷分别覆盖 in_progress/submitted |
| A/B 列表与分页 | A 恰 3 条、B 恰 2 条；limit 1/2/100 无漏项/重项/串人，顺序一致且可重复 |
| A cursor 给 B、B cursor 给 A | 两个方向均 **422**；具体错误码字符串未固定 |

脚本实跑目标是当时 owner 提供的运行实例，不等同于本 QA 提交已经集成部署。总控应把最终集成 SHA、后端 owner 的运行 SHA/配置、原 smoke 和重启证据绑定后再作 F1 总体验收。

## unknowns / needs_human_review

以下均未写成正式业务契约，也不以脚本观察结果擅自定稿。

| 状态 | 具体问题 | 当前处理/所需决定 |
|---|---|---|
| needs_human_review | 输入 OpenAPI 是内部 candidate；仓内权威位置与发布确认仍由 Remy 指定 | QA 按任务给定 candidate 验证；保留根 docs/api draft，不宣称候选已发布 |
| needs_human_review | `QuizVersionPayload.question_bank_version` 的 schema example（输入 YAML 约 820 行）仍是 `qb-v0.4-teach-1`，而示例请求/题库与 fixture 是 `qb-v0.4-prototype-1` | 不自动改契约；请 owner 统一示例，并决定旧版是否仍可新建会话、历史题库留存和旧草稿恢复规则 |
| needs_human_review | 列表 `next_cursor` 在 schema 非 required，但 RUNBOOK 的新号示例显式 null | runner 接受终页省略/null；有后续记录则必须给可推进 cursor；是否强制总是显式 null 待确认 |
| needs_human_review | cursor 格式、过期、跨身份使用、非法 cursor 的具体拒绝码未定义；ID 断序方向也未明示 | 本次跨人实际 422，仅记录；runner 接受跨人 cursor 的结构化 4xx，若返回 200 则继续验证全链只含调用者数据，不把 422 固定成新契约；只验证一致排序，不擅定 ID 升/降序 |
| needs_human_review | 同一 answers payload 内重复 question_id、空数组、混合合法/非法项的原子性和结构错误细分码未定 | 不添加推断断言；本次验证独立非法项 422 后状态不变；混合批次原子性 NOT_RUN |
| needs_human_review | token 的寿命长度、过期测试入口/安全短 TTL 配置、撤销与游客找回策略未定 | 验缺失/错误 token 401及 expires_at 在未来；实际过期 401 NOT_RUN，不伪造数据库时间或改服务配置 |
| needs_human_review | `session_id` 文案称测评结果 present，但不在 required；F1 又无会话 GET/答案回放接口 | runner 不把该可选字段当必需；外存 session/result 对应关系，以专属新游客完整列表验证单结果；不私加读取端点 |
| needs_human_review | 阶段字段长度/允许标签、题库未来切换、提交前旧保存与新保存竞态未完整约定 | 不新增业务字段或顺序合同；本次只验证明确约定的提交后不可变性；前端版本/竞态另交 owner 评审 |
| NOT_RUN | 真实 stop/start 后持久化、H5 refresh/独立身份、浏览器预检、跨设备入口 | 服务 owner/总控执行上面两阶段及 UI 验收，附运行 SHA、配置归属与重启证据；不以本机 HTTP 通过代替 |
