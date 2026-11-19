# AF-197 候选交付记录

状态：Candidate，NOT CODE_VERIFIED，负责人验收待定。Worker 自查不冒充独立 Review。

- 实际 Task `task_8da08fdceafe`，Dispatch `ctx_f2d91770e5e3`，terminal `term_b068250e-2ead-43e9-af7a-2f013007ecb7`。
- 注册 Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W16-AF197`，branch `weiyang86/AIJ-W16-AF197`，origin `git@github.com:weiyang86/aij-foundation.git`。
- 起点 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，开工 clean；实际 Orca Dispatch/Worktree 已只读核对。
- root SOURCE_BOOTSTRAP.json SHA256 `65075e2dfa3b1299772a79d9034f42041f2fc3a029732ed98a8dc013a273216d`，source `45042c1c988ae6bec15e0384e67ba21c9cf22575`；843清单 blob 通过 git show 读取并逐项 SHA256 校验后恢复自己的工作树。
- 独立 bootstrap 提交 `29cc374839bb408e468e452f1ece552bd559321d`，不并入候选；root 只能接之后的6个 allowPaths delta。

## 实际改动及边界

新增真实 docx9.15.2/pdfkit0.20.2 有界纯文本生成库、固定协议 CLI、offline runtime closure builder、独立内容校验测试及 root 接线说明。固定 font 大小/hash/字形覆盖、有界打开/读取/关闭，PDF流输出/实际页数保护，安全错误码，无正文/路径日志。Word 为独立 ZIP/XML 检查的真实文件，PDF 为独立 PDF.js 读取的实际中文/页内容。

数据库/接口/页面/权限/审计日志：均无改动；未启动服务、无访问地址。没有全局 manifest/锁/schema/migration/module/SDK index/queue/registry/CURRENT_STATE 写入，无 Docker/DB/外网供应商调用/付费/推送/PR/发布。公网访问仅为批准的依赖与字体下载。真实凭据留空；未读取 root 工作源码、.artifacts、.local-data 或用户 playbook；只读取指定 bootstrap 与共同契约，源码来自版本 git show。

## 命令与结果

1. bootstrap Python脚本：843个 `git show source:path`/hash 全通过，独立 commit exit0。
2. 私有 `npm install --prefix /tmp/aij-af197-private --ignore-scripts --no-audit --no-fund docx@9.15.2 pdfkit@0.20.2 @types/pdfkit@0.17.7 @types/node typescript esbuild pdfjs-dist` exit0；后续将私有 TypeScript 固定5.9.3 exit0。未修改工作树 manifest/锁；docx/pdfkit 私有 lock integrity 与依赖计划相同。
3. font 首次下载停滞，被停止，所得部分文件 hash 错误从未用于成功证据；重试45s超时 curl28，随后续传 exit0，完整 font 与 license SHA256 均匹配固定契约。所有自有下载子进程已结束；部分文件不纳入候选。
4. 首次用未来默认 TypeScript 检查退出2（node10 moduleResolution已移除）；随后使用仓库既有版本5.9.3。最初 @types/pdfkit font构造参数类型不匹配 exit2，已改用无默认font构造后设置真实 Buffer font。
5. 最终窄类型检查：复制本卡两份 TS 到私有 typecheck，`/tmp/aij-af197-private/node_modules/.bin/tsc --target es2022 --module commonjs --moduleResolution node --esModuleInterop --strict --skipLibCheck --outDir /tmp/aij-af197-private/compiled /tmp/aij-af197-private/typecheck/*.ts` exit0。
6. `AF197_TEST_DEPENDENCY_ROOT=/tmp/aij-af197-private AF197_TEST_FONT_PATH=/tmp/aij-af197-private/font-retry.otf AF197_TEST_FONT_LICENSE_PATH=/tmp/aij-af197-private/LICENSE node --test scripts/verification/document-renderer.test.mjs`：最终6/6 PASS、0 skip，exit0。PDF.js6.5.438/Python3仅测试使用；ZIP CRC/所有XML/无外部关系/字形名/TAB/空段落/末尾内容、PDF中文/实际多页/嵌入font/checksum、非法输入/accessor/缺字/缺失或错误font/hash、2048空段落的实际有界分页、CLI malformed/oversize/invalidUTF8、bundle独立真实render/全部依赖解析留在bundle/现有目录保护/标记清理/符号链接与篡改license拒绝均通过。
7. 首轮测试3/6失败：测试误将w:tabStops的w:tab计为文本TAB、2048行不足100页却预期PAGE_LIMIT、类型包无main导致测试provision错误；均修正为真实结构/实际边界与package.json解析，未降低生产限制或替换库。后续最终6/6通过。
8. `git diff --check` exit0；最终提交前再次自查只暂存6个 allowPaths 文件。

## NOT_RUN 与交接

root正式 verify:task、全局依赖/字体入库、API完整编译、Linux CLI成功、Docker/资源关闭验收、Word/独立阅读器逐页视觉QA 均 NOT_RUN，不能据此声明页面/附件API/WordPDF最终目标或原40验收完成。5MiB/100页保护未用伪造库输出强行命中；有效输入测试输出均在界内。没有执行 pnpm 全仓安装、全构建、migrate、seed、任何数据库节点。

root 必须先停止接收其他同卡 Writer，再精确接入候选并按 ROOT_WIRING 完成真实门禁；AF199真实集成依I197实际ID，不依本候选。外部 DEFERRED_NOT_PASSED、原40 NOT_RUN_TARGET_ACCEPTANCE 保留。Worker 使用约15分钟（含源码恢复/下载等待/实现/真实验证），低于2h；候选SHA在最终Orca交接消息给出。候选本地提交后 STOP ALL WRITING，Writer 完全交回 root；bootstrap禁止混入正式卡片delta。


## 清理授权修订（第二次唯一 Writer 派工）

负责人已确认原候选尚未接入 dev，并明确停止 root 本卡源码写入后交回本 Worker；继续同一注册 WT/bootstrap，Task `task_c3a5052392ff`、Dispatch `ctx_74e898fadbc5`。本轮从 clean `9ba27b25ce367ef3eef6665ccd49dadb6f3f2ed4` 开始，仅改 runtime-bundle、其测试、本记录和 ROOT_WIRING；原 renderer/CLI 及所有全局文件未改。未读取 root 私有产物或访问其复现场景。

原候选存在实际安全缺口：removeRuntimeBundle 仅信任磁盘标记，未证明目录由 builder 创建。新增真实负例：自行 mkdir 并写入完整合法格式随机 nonce 标记和 sentinel，未调用 builder；在旧实现上 `node --test --test-name-pattern 'forged marker' scripts/verification/document-renderer.test.mjs` 退出1（Missing expected rejection，目录实际被删），保留本次失败事实，不反填原版通过。

修复用模块私有 ownership Map 记录 builder 实际 mkdir 后的路径、随机 nonce、设备号/inode 和 ready 状态；公开 remove 必须持有该实例登记的完成态能力，并校验 marker 与实际目录身份。清理前一次性消费能力；同路径替代目录、人工 marker、跨实例/进程重建 marker 均不能取得权限。构建失败清理复用该次私有能力，允许清除 marker 尚未完成的真实自有目录。保持两项公开函数签名及合法同进程 build/remove；root 调用需要同模块实例，不能用磁盘 marker 作为跨进程清理授权。没有新增 Linux/API/视觉通过声明。

最终命令：`AF197_TEST_DEPENDENCY_ROOT=/tmp/aij-af197-private AF197_TEST_FONT_PATH=/tmp/aij-af197-private/font-retry.otf AF197_TEST_FONT_LICENSE_PATH=/tmp/aij-af197-private/LICENSE node --test scripts/verification/document-renderer.test.mjs` exit0，原6项真实检查继续通过，加上伪标记负例共7/7 PASS、0 skip。额外实际验证将合法目录 rename 保留，再在原路径复制有效 nonce marker 创建替代目录：拒删且 sentinel 保留；恢复实际 builder 目录后正常清理成功。实际依赖目录添加符号链接触发 mkdir 后构建失败：自有不完整输出被清理、能力不可复用。最终 `node --check` 两个修改的 mjs 与 `git diff --check` exit0；TS 源码未变，前轮窄类型检查结果仍为历史证据，本轮未重复全仓/API编译。

修订耗时约5分钟，连同首轮约20分钟，低于本轮30分钟与总 Worker 2h 上限；两派工间 idle 不计工程时间。原全部失败、外部 DEFERRED_NOT_PASSED、原40 NOT_RUN_TARGET_ACCEPTANCE、正式 verify:task/API完整编译/Linux CLI/资源关闭/逐页视觉 NOT_RUN 原样保留。新候选按原名本地提交，root 接收范围为 bootstrap `29cc374839bb408e468e452f1ece552bd559321d` 到新候选的总6文件 delta（含首版候选和本轮修复，bootstrap 不接入）；新 SHA 见最终交接。提交后 STOP ALL WRITING，再交回 root 唯一 Writer。
