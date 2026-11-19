# AF-224 · 提供文档章节读取与局部草稿组合SDK

状态：Candidate not CODE_VERIFIED；同 Writer 自查，不冒充独立复核。root 正式 I223→I224→I225 接收与负责人验收待完成。

## 身份、基线与源码

- Task：`task_f3fabfde50a6`；Dispatch：`ctx_ce3e0a50e3ca`。
- Writer terminal：`term_330ce8b2-d5cc-40ac-aa80-24d7c27274a9`；coordinator：`term_26cef18e-31e9-4c43-8f62-bd8db5c92ea5`。
- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W23-AF224`；instance `14c0ce09-f79e-4f45-a58f-7c37e72b1388`；已注册 root child。
- Branch：`weiyang86/AIJ-W23-AF224`。起始 `git status --short --branch` 仅分支行，无继承/未提交差异；HEAD 和批准 origin/dev 起始均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- Remote fetch/push：`git@github.com:weiyang86/aij-foundation.git`。本卡无 fetch/push/main/tag/PR/部署操作。
- 完整读取冻结 root `W23/CONTRACT.md`、`W23/SOURCE_BOOTSTRAP.json` 与总控纠正路径的 planning `AF-224.md`；没有读取 root live 源码、其他候选或用户原型。
- 只使用 `git show 5289bd1eabff8d2c8891ba0baeab7f1bf323c8d2:path` 恢复 manifest 1061 个精确 blobs；逐项验证 Git OID、100644/100755 mode、bytes、SHA256，路径及父目录无 symlink；无删除路径。manifest SHA256 `16075959b0ea95f4c71c218bf2e9a594314fb746fe32acfa02a2683a741a0014`。
- 独立 source-only bootstrap commit：`614e757d2d0e5d80ecd62707b9bc2257a8211133`（2026-11-08 21:34:13 +08:00）。后续复核其 committed tree 1061 OID/mode 与当前文件 SHA256 全部匹配。
- 本卡 candidate 是 bootstrap 的直接下一提交，准确 SHA 由完成回执给出，可用 `git log -1 --format=%H` 回读；本文件属于该提交，避免将自引用 SHA 写入自身。root 只提取 candidate delta，不 cherry-pick/bootstrap 混入源文件。

## 实际差异与影响

仅四个 allowPaths：新增 `packages/sdk/src/personal-document-sections.ts`、`scripts/verification/personal-document-sections-sdk.test.mjs`、本执行记录与 `W23/AF-224-ROOT_WIRING.md`。新模块导出冻结 factory、四个 readonly wire/input/output 类型、async compose helper。公开 index/package/build/lockfile 未改。

请求验证隔离 workspace token、UUID URL 段与 numeric revision 1..200，拒绝 coercion/query 注入；响应严格 descriptor/plain shape/字段/hash格式/长度/连续范围/128块/id/index/title/level。拒绝 getter、额外 symbol/隐藏字段、非 plain 原型、稀疏或带额外字段的数组。原始 HTTP/abort 拒绝对象保持身份；模糊成功响应仅抛安全 TypeError，不伪造 400/403/409。

组合只在 RAM 中使用已校验字符串做前缀 + replacement + 后缀，检查 body 实际 SHA256 和 UTF16/UTF8 长度；拒绝错 id/revision/hash、surrogate/CRLF/行内边界、C0/C1 禁用控件、非法 Unicode、超字节上限、非末块非空 replacement 无换行。保留 BOM、组合字符、字面 U+FFFD、emoji、原 LF/CRLF/单CR；不正规化、不补行尾、不改输入。结果只含 draft 六字段且 frozen；无缓存/存储/重试/后台读/HTTP 写。

数据库/schema、接口实现、页面、权限、日志、审计、版本、Run/Job/费用：本候选均无新写入或接线；仅新增 SDK 对冻结 GET 的调用声明。访问地址：无应用/API服务实际启动；测试临时 loopback HTTP 随测试精确关闭。

## 验证与证据

Node `v24.21.0`，pnpm `10.0.0`。独立安装的 node_modules 是本 child 的实目录；只复用下载缓存，workspace 依赖链接实际解析在本 child 内，没有借用 root 的 node_modules/源码/上传目录，未复制真实 env 或客户数据。安装默认忽略依赖 build scripts，未执行 DB/native 节点。

| 命令/检查 | exit | 实际结果 |
| --- | --- | --- |
| 基线 branch/status/HEAD/remote 与 `orca worktree current --json` | 0 | clean、批准起始 SHA、注册 child 身份一致 |
| manifest 逐 blob 校验、bootstrap 与后续 1061 项复核 | 0 | OID/mode/大小/hash 全一致，无删除 |
| `pnpm install --frozen-lockfile` | 0 | 800 包，lockfile 未变；17s |
| `pnpm --filter @aij/contracts build` | 0 | 小包生成 dist 供现有 type imports 解析 |
| 首轮 `node --test scripts/verification/personal-document-sections-sdk.test.mjs` | 1 | 新模块 array descriptors 的 TS2551，未执行后续测试；已修正 PropertyDescriptorMap 类型 |
| 修复后同命令 | 0 | 24/24 通过；后补 descriptor trap/no HTTP/WebCrypto缺失测试 |
| 最终同命令 | 0 | 28/28 通过；实际 strict 编译新模块，独立 ESM/CJS runtime + NodeNext source types + synthetic loopback |
| `pnpm exec eslint packages/sdk/src/personal-document-sections.ts scripts/verification/personal-document-sections-sdk.test.mjs --max-warnings=0` | 0 | 最终定向 lint 无警告 |
| `git diff --cached --check` 与 allowPaths/直接父提交复核 | 0 | 交付前核验；只包含本卡四个新增文件 |

可重跑测试按实际新模块生成 `.artifacts/AF-224/personal-document-sections.{mjs,cjs,d.mts,d.cts}` 与 types consumer。其 runtime 没有 require/import 依赖；测试没有改 public index，也没用 ts-node/runtime source bypass。声明/SDK正式公开入口的包外消费仍属 root 待验。日志保存在本 child `.artifacts/AF-224/`：`af224-install.log`、`af224-contracts-build.log`、`af224-tests-initial.log`、`af224-tests-second.log`、`tests-final.log`、`af224-lint-initial.log`、`lint-final.log`；仅本地忽略输出，不加入候选。

其他非零命令完整保留：最初 `orca orchestration check --from ...` exit 1（本版本 check 使用 `--terminal`，已按 help 修正并成功读取）；错误 root spec `W23/AF-224.md` 的 cat exit 1（问总控后改读 parent planning/AF-224.md）；探索性读取不存在的 `packages/sdk/src/client.ts` exit 2 和 `packages/sdk/tsconfig.json` exit 1（实际 ClientApi 位于已有 index.ts，采用显式独立编译参数，无需新造契约）。这些不是通过证据。

Git 在 source 读取/部分 status/log/tree 命令 stderr 报共享对象库已有 `._pack-...idx non-monotonic index`，Git 命令实际 exit 0；blob hash/OID/mode 均通过。Writer 没有修改或清理共享 Git 对象库；此诊断保留供 root 知悉。

NOT_RUN：root `verify:task`、真实 I223/API/auth/Workspace/权限/PG、原 SDK PATCH CAS/409与历史导出、正式公开 index/full SDK 打包、仓库外 fresh 私有包消费、浏览器/native、应用/API/Next重构建、schema generate/DB/seed/migrate/Docker/付费调用。离线 port 的 401/403/404/409 是合成拒绝传播测试，不能冒充实际权限结果。

## 人工验收、依赖与交接

root 接线详见 `docs/planning/auto-ai-program-20261105/W23/AF-224-ROOT_WIRING.md`：接上公开 exports，先真实 I223，再新包外部 ESM/CJS/NodeNext/浏览器消费与真实当前文档/index组合，最后按原 PATCH 明确保存/CAS拒绝/旧历史导出检查。新增 SDK 本身没有页面可人工访问。

Writer 有效工程时间约 0.35h（含校验、bootstrap、实现、28项离线测试、自查、文档与提交；等待总控纠正 spec 路径不计有效工程）；低于 1.5h Worker 上限，整卡 3.5h 剩余归 root。无已知候选实现失败；正式验证、公开接线与 I 依赖尚未完成，不将候选上调为 CODE_VERIFIED。无子代理/Trea。

交接声明：候选提交完成并回读后 **STOP ALL WRITING**；原 Writer 停止本卡所有写入，由总控精确接收 candidate delta、串行正式验证及治理。正式队列和 registry 未由 Worker 修改。
