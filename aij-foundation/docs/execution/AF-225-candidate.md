# AF-225 候选执行记录

状态：CANDIDATE，非 CODE_VERIFIED，非负责人验收。候选标题：提供个人文档章节导航与局部草稿预览。

## 身份、来源与写入边界

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W23-AF225`；instance `9b5e3da8-2243-4d69-8f60-4eb9ec92c933`，已注册 root child。
- branch：`weiyang86/AIJ-W23-AF225`；起始 status clean；HEAD 与本地 origin/dev 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- remote fetch/push：`git@github.com:weiyang86/aij-foundation.git`；未 push。
- Task：`task_83a9f53175da`；Dispatch：`ctx_a63ff726f675`；terminal：`term_b3c7ba9d-0332-4710-b2c4-f7b8b6f7ef2c`；coordinator terminal：`term_26cef18e-31e9-4c43-8f62-bd8db5c92ea5`。
- 完整读取 root 的 frozen W23/CONTRACT.md、SOURCE_BOOTSTRAP.json 与 AF-225.md；其他源码只来自自己 Worktree 的 immutable Git blobs，未读 live root 源码/凭据/用户原型/其他 Worker 目录。
- 源提交：`5289bd1eabff8d2c8891ba0baeab7f1bf323c8d2`；manifest SHA256：`16075959b0ea95f4c71c218bf2e9a594314fb746fe32acfa02a2683a741a0014`。
- 逐项 `git show source:path` 验证 1061 个 blob 的 OID、长度、SHA256、mode，恢复后再次核对 hash/mode，无删除；bootstrap 独立提交：`bc501ad4140bc80d6629a154a93db9c3221edcb0`。此提交只作源码基线，不混入 candidate delta。
- Candidate 为上述 bootstrap 的下一提交，原名精确提交；实际 candidate SHA 见最终 worker_done 身份回报或 `git log -1`，交付时工作树应 clean。总控只取该提交的六个 allowPaths delta，不集成 bootstrap。
- 使用 frontend-design-review、orchestration、orca-cli 技能；无 subagent/helper、无模型切换，无 Trea 等待；同 Writer 自查不冒充独立复核。

## 实际差异与影响

仅新增六个 allowPaths 文件：

1. `client-document-sections-state.mjs`：注入 sectionsApi/composeDraft，实际 public 原 SDK GET；scope/member/workspace/role/permissions/sessionGeneration、当前 id/revision 与 body SHA256 围栏；显式读取/选择/编辑/预览/确认、父同步接收/拒绝；全部网络动作只 GET。当前 401/403/404 先清私有状态再同步通知父，local 400 不冒充撤权。
2. 配套 `.d.mts`：冻结端口 structural 类型、本地 proposal、scope/state/controller API。
3. `client-document-sections-panel.tsx`：沿原 AntD/adminTheme/section 语义，目录/完整章节（含标题）编辑/前后比较/明确应用确认；单永久 controller、render 提前遮蔽旧 scope，blur/真 hidden/pagehide/unmount 清 RAM/确认，取消后安全返回按钮焦点。
4. `client-document-sections-state.test.mjs`：实际编译 public SDK + 明示合成 section/compose 端口，22 项离线测试覆盖核心成功/拒绝/晚回调路径和 SSR/listener 接线。
5. 本执行记录。
6. `W23/AF-225-ROOT_WIRING.md`：父 saved-only scope、manager 双重 source 围栏、唯一保存/未知结果 owner 和正式验证请求。

无数据库/schema/seed/migration、Controller/接口实现或权限定义变更；无日志/私有 storage/URL/HTML 注入，无模型/费用调用，无 source root/旧产品写入。页面组件尚未接入 production 父 manager，访问地址未启动；未提供实际运行的访问 URL。未来页面每次显式操作增加 me/context/current document 的只读校验；父是唯一 PATCH/版本/审计/未知结果 owner。

## 命令与结果

- 身份 `pwd`、`git status --short --branch`、`git branch --show-current`、`git rev-parse HEAD/origin/dev`、`git remote -v`、`orca worktree current --json`：exit 0；起点 clean、注册 child、SHA/remote 如上；身份回执 `msg_8d026dfcdfc2`。
- Python 精确 manifest/blob 恢复和校验 + source-only commit：exit 0，1061 个匹配；Git 反复输出共享 object pack 中 AppleDouble `._pack-...idx` non-monotonic index 提示，未修改该共享文件，所有 blob 校验及提交成功，未把提示隐藏成无告警。
- `pnpm install --frozen-lockfile`：exit 0，800 packages；本 Worktree 独立 node_modules，realpath 核对 root/apps/web/packages/sdk 均在本 Worktree，无外部 node_modules 根目录链接。pnpm workspace 正常内部 package links 不指向其他工作区；仅复用下载 cache。依赖 build scripts 按 pnpm 默认忽略，未 rebuild/native 或复制真实 env/上传数据。
- `pnpm --filter @aij/contracts build && pnpm --filter @aij/sdk build`：exit 0，生成自己的 ignored dist，实际 public ESM/CJS/types；未改公开 exports。
- `node --test scripts/verification/client-document-sections-state.test.mjs`：最终 exit 0，22/22 pass（含空正文/noop/取消、前后缀 CRLF/emoji/整块删除、只读与撤权、父拒绝/同步 null、revision/hash/source/角色/session、晚 auth/GET/index/compose/confirmation、合成 blur/hidden/pagehide/unmount、SSR escape/render scope mask）；测试运输层断言所有请求 GET，父 callback 不执行保存。
- `pnpm exec eslint apps/web/app/components/client-document-sections-state.mjs apps/web/app/components/client-document-sections-state.d.mts apps/web/app/components/client-document-sections-panel.tsx scripts/verification/client-document-sections-state.test.mjs --max-warnings=0`：最终 exit 0。
- `pnpm exec tsc --noEmit --strict --skipLibCheck --target es2022 --lib es2022,dom,dom.iterable --module esnext --moduleResolution bundler --jsx react-jsx --esModuleInterop apps/web/app/components/client-document-sections-panel.tsx apps/web/app/components/client-document-sections-state.d.mts`：exit 0；仅隔离新增 Panel/声明及其引用，不声称全 web/typecheck。
- `git diff --cached --check` 与候选路径检查：提交前执行，要求 exit 0、仅六个 allowPaths；提交后 status clean。

保留的已修正失败：首轮 offline test exit 1（19/20，断言把“回到已保存文档”误当保存成功；改为只禁止成功句首，未删测试）；首轮 targeted lint exit 1（两处 no-control-regex，改码点检测后通过）。Orca check 首次误用 `--from` exit 1（CLI invalid_argument，按提示改 `--terminal` 后 exit 0 读取一次入站消息；未轮询）。路径定位的若干不存在文件只读探查已改用 rg 实际路径，未写其他 owner。

## NOT_RUN、人工验收与交接

NOT_RUN：真实 AF223 HTTP/授权拒绝/PG，只读 owner 账本证据；真正 AF224 sections SDK/composer 与 fresh 私有包安装验证；production mount、原父 applySectionDraft、原明确 PATCH 保存与未知结果 read/ACK；真实 desktop/390px/native/blur/hidden 操作；全 API/Next 构建、root verify:task/registry/正式队列/正式 I 依赖。以上均按 spec 留给 root，不伪造通过。

人工/正式步骤：root 在真实 I223/I224 完成后依接线文档挂载永久 controller；已保存视图读取→选择→编辑完整章节→预览→明确应用至未保存全文→原明确保存，验证只新增一版且未选块逐字保持；再执行取消/noop/既有草稿拒绝/权限、session、revision 变化/失焦、隐藏、卸载和晚返回/丢保存回复单 PATCH 与恢复锁/历史与导出引用回归。

无候选实现阻塞；剩余是明确的 root 共享接线和真实验收工作，不属于本 Writer allowPaths。有效工程工时约 0.5h，低于 1.5h Worker 上限；未使用整卡 4h 剩余额度。交接后 STOP ALL WRITING，不续跑下一卡；candidate not CODE_VERIFIED，等待总控精确接收本候选 delta。
