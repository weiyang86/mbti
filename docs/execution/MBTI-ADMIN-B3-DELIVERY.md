# MBTI Admin B3 交付：三页配置 UI_CONTRACT

本次按用户明确授权交付配置 UI、内存草稿、本地验证和独立预览。没有现成配置 API / 插件，保存与发布禁用；不声明真实持久化、线上发布、服务端约束或角色验收通过。

## 运行与版本

- Run：`run_801f9322af2e`；Task：`task_78d8ccaae9b5`；Dispatch：`ctx_b1b158f719de`；Worker：`term_6df9ce63-e962-444a-979e-562807098b1f`。
- 工作区：`/Volumes/Lexar/日常工作/2026/mbti/demo/mbti`，始终在 `dev`，没有换树/分支、推送、部署或后台/DB操作。
- 开工 HEAD：`c893f45e7ba48b25c17bff756a4101a2ddf75202`。日志包含 B1 `271d2de`、B2a `874f0c1` / `c49ef3d`、B2b `c893f45`；开工无已跟踪文件修改。已有未跟踪 `orca-inputs/` 和大量 macOS `._*` 文件保留。
- **代码候选 SHA：`5d9df8590977463bcf39d6979151d4267125fcf1`**。本交付文档与 B3 覆盖行随后单独提交；最终完整交付 SHA 见 worker_done 回执。
- 输入：`orca-inputs/MBTI-Orca-20261109/cards/B3.md`、`ADMIN-COVERAGE.md`、`API-COVERAGE.md`、`RUNBOOK.md`、`inputs/mbti-dazi-admin.html`，根与 Aij AGENTS 及既有 admin 实现。
- 原稿 HTML SHA-256：`fb7607763dbc41472bccda10fc24f9241ec4d306d3b745eaabdb7be4a94248a6`，与既有覆盖表一致。没有修改输入原型。

## 精确文件范围

| 路径 | 作用 |
|---|---|
| `admin/src/ops.vue` | 连接既有 content/catalog/assessment 路由、顶部前台预览、内存草稿离开提示；保留 B1 会话入口与能力显隐 |
| `admin/src/config.vue` | 三页、七种编辑抽屉、筛选、应用/放弃、12题试算及禁用保存/发布 |
| `admin/src/config-preview.vue` | 独立手机布局；内存草稿、原稿参考、不可得的已发布视图分开 |
| `admin/src/config-model.ts` | 原型 UI 类型、字段/约束、分价转换、重排与纯计分函数 |
| `admin/src/config-contract-v1.ts` | 小型版本化消费者操作与默认不可用适配器，非权威 HTTP 契约 |
| `admin/src/config-fixture.json` | 仅三页所需的静态原稿内容与 frozen 12题候选 payload |
| `admin/src/config-assets/editorial.webp`、`illustration.webp`、`game.webp` | 从原稿 ART 原样提取的三张参考素材 |
| `admin/src/config.css` | 沿用 admin 配色/排版与卡片，响应式网格、局部表格横滚、抽屉和手机预览 |
| `admin/scripts/config.test.mjs` | 13 项 B3 纯模型/消费者/真实组件隔离测试 |
| `docs/execution/MBTI-ADMIN-COVERAGE.md` | 只替换 `UI-06.1`–`UI-08.3` 八行，B1/B2 行与证据不改 |
| `docs/execution/MBTI-ADMIN-B3-DELIVERY.md` | 本回执 |

未修改 `web/`、aij 后台、数据库、认证/角色、既有测评结果、订单、部署与正式 `docs/api/`；没有新增依赖、环境文件或用户数据。构建产物和本地截图不提交。

## 字段与逐控件映射

下列均为原型呈现字段，不能据此认定服务端 payload 已定稿。保存按钮在页顶和编辑抽屉均禁用，发布按钮禁用；“应用到内存预览”是不同动作，成功提示明确“未保存、未发布，刷新即丢失”。

| 原型 / 路由 | 字段与限制 | 已实现动作 / 可观察结果 |
|---|---|---|
| 首页首屏 `#/content` | `headline` 26字、`accent` 28字、`sub` 80字、`cta` 20字 | 首页与场景标签、编辑首屏、抽屉输入、内存应用、放弃/返回、未应用输入确认、手机首页预览 |
| 消费场景 `#/content` | `moments/avatar/meet/caption` 各100字 | 编辑场景、查看付费页、代入 `{type}` 配文预览；草稿和参考可对照 |
| 平台入口 `#/content` | wechat/xhs/douyin/mp 四渠道；`landing` 为 home/pricing/test-intro/discover/history；`badge` 26字 | 平台入口标签、四个编辑入口、四个模拟进入；只改变选中渠道，预览绑定该渠道与落点 |
| 商品套装 `#/catalog` | `title` 24字、`desc` 100字、分整数 `cents`、上架 `on`；basic/portrait 两档 | 修改商品名称/售价/权益说明/上架；预览购买页含两档可选价；关闭购买，不创建订单 |
| 海报与头像模板 `#/catalog` | `title` 16字、三款内置 `art`、展示位1/2/3、启用 `on` | 模板标签、编辑模板、素材切换、启停、插入式排序、手机风格预览；重排生成连续不重复1–3位；不上传用户照片 |
| 题库与计分 `#/assessment` | 固定12题/四维各3题；题干100字、A/B各70字；固定题号/维度；方向正向或反向 | 维度过滤各3行，逐题编辑，A/B得分展示；题干/文本/映射变化产生 `preview-only-*` 标识，恢复原题则回到原候选标识 |
| 试算结果 `#/assessment` | 12题各一个合法答案，四维多数票并应用反向方向 | 打开12题抽屉、A/B选择、计算四维计数和类型、关闭；修改选项清除旧试算输出；不创建 Result/Session/History |
| 人格与相处说明书 `#/assessment` | 原稿16类；角色18字、宣言48字、充电/沟通/相处细节各90字 | 搜索类型/角色/宣言、NT/NF/SJ/SP过滤各4类、空态、编辑五字段、所选人格手机预览 |
| 公共预览 | 版本/页面/渠道/人格；造型页样式、购买页套装可选 | 首页、购买、配文、人格说明、首题/导语、形象布局；禁用购买/生成/分享；轨迹与换名片只展示落点说明，不造用户记录 |
| 公共抽屉与离开 | 独立缓冲区；未应用与已应用内存修改均可追踪 | 遮罩/关闭/返回、放弃输入或继续编辑、全部草稿恢复原稿确认、页内导航/手动hash/刷新前提醒；Tab焦点循环、Escape、返回触发控件焦点 |

所有编辑文本遵守原稿的 trim、非空纯文本和禁用 `< > " ' &` 规则，长度同时在表单和本地模型校验。原稿的浏览器草稿保存/发布与 localStorage 流程没有复制。

## 静态来源、类型复用与消费者边界

| 来源 | 可复核信息 / 使用方式 |
|---|---|
| frozen fixture | `docs/integration/fastlane/fixtures/quiz-candidate.json`，最近来源提交 `e69ca1cd68d3c5aec98078b43ac3c68d1f8e4023`；SHA-256 `c22e7e775b11dc3b3b72224e8c2a16f86b112cd1c8ecab8db4f9fd1d2ca8fdc2` |
| 12题来源链 | fixture 自带 `dev@3c0b9eb5c6fa52e56a7418a1b27e73827bd4070b:UIhtml/mbti-buddy-prototype.html#QUIZ` 和 `PR20@a39d99cf8537a6e54c34e965b2c3ff6c2691a21f:web/src/api/mock/questions.ts`；本实现直接复制 frozen `payload`，没有导入旧 bank 或用户历史 |
| 初始题库标识 | `qb-v0.4-prototype-1`；保留 q1–q12 和原 option ID/文本，UI 额外的 `reverse` 默认为 false，仅描述原型计分方向 |
| content/channels/shop/styles/personas | 从输入 HTML 的 `BASE` 提取五组所需字段；没有导入经营随机样本、模拟订单、发布记录、支付参数/凭据、AI连接配置或原型移动端执行脚本 |
| 最小配置fixture | `admin/src/config-fixture.json` SHA-256 `36a23e2abf4a93c599c2cf1686ebe63b7522afb3743204fedae2f2d18a97d702`，tests 对题库 payload 与 frozen fixture 做结构相等校验 |
| 三张素材 | 原型 `ART` 原字节，非运行时生成或上传。editorial SHA-256 `b9ea1c767650234f0845328e16b2e752ee79d21dba1415863a32c72d8a146251`；illustration `0216ac8663391b6fe2f4f7823df7d08207dd022df447e87d29dcd9efe480c071`；game `927a980e7259142809334955d55c961ed88efd0409d6bc256605a930a2e94961` |
| 复用既有类型 | type-only 复用 `web/src/api/types.ts` 的 Question、Answer、DimensionCounts 与 TypeMeta.type_code；编译后无 web 运行时导入，不调用 H5 client |
| 商品schema核对 | 已读 `web/src/api/payment.ts` 的 PaymentProduct（最近来源 `21825f0a683100927a0e0e1c3ff14fb5eda20264`），其 amount 为分、tier为1/2，但包含 controlled_test_fixture/pricing_mode 等业务读取语义，不是可复用的配置写入schema；因此原型 cents/on/id 保持 UI 字段，不擅自改成正式 product_code、价格或权益API字段 |

消费者版本 `mbti-config-consumer/v1` 定义泛型 `read(scope, draft/published)`、`saveDraft(scope, value, expectedRevision)`、`publish(expectedRevision)`。`value` 是适配后的本地 UI 模型，`revision` 为 opaque unknown，**不是给服务端增加 value/revision/persistence 等权威 payload 字段**。当前默认 adapter 的三种操作全部返回 unavailable，`persistence=false`，不发请求、不尝试保存。页面通过消费者读取，不内嵌猜测的插件URL；C2 可注入真实 adapter，继续实现同一操作签名。发布仍由 C2 发布流程接入，不能靠本页开关取得发布权限。

草稿与已发布配置是两个独立读取结果。初始原稿只是参考，页面明确“静态原稿参考”；内存应用不会改变参考对象。预览提供“内存草稿效果”“原稿参考效果 · 非线上”“已发布 / 线上 · 未接通”，线上不可得时只显示说明，不回退到参考/草稿。页面卸载/刷新即恢复静态参考；配置未写 localStorage、sessionStorage、IndexedDB 或服务器。

## 验证与拒绝证据

本地单元/组件结果只计 `LOCAL_UI_TESTED`；对应真实写入、HTTP 拒绝、服务端强制执行全部 `NOT_RUN`。

| 输入 / 动作 | 操作前 → 操作后 / 拒绝结果 |
|---|---|
| 分价最小/最大 | `0.01` → 1分；`9999.99` → 999999分；零、负、超界、超过两位小数、NaN/Infinity/指数形式拒绝 |
| 本人形象低价 | 基础990分，输入本人形象9.89元 → 拒绝“不能低于”；原对象不变 |
| 最后一个上架 | basic在内存下架后，portrait再下架 → 拒绝“至少保留一个上架套装”；portrait仍启用 |
| 最后一个风格 / 排序 | 两款停用后停用末款 → 拒绝；移动illustration到3位 → editorial/game/illustration顺序1/2/3；非法素材和0位拒绝 |
| 渠道隔离 | xhs落点改pricing、栏目语改新值 → wechat保持原值；非法外部URL不在固定落点中，拒绝 |
| 编辑缓冲区 | 首页主标题改“内存标题”并返回 → 显示放弃/继续；应用后仅草稿变化；参考手机预览仍为原标题；卸载后重新挂载恢复原标题 |
| 题目/映射验证 | 相同A/B、重复题目ID、重复选项ID、非法方向/跨维度映射拒绝；真实编辑组件显示“两个选项须不同”，候选版本不变 |
| golden试算 | fixture全A → ESTJ，E/S/T/J各3票；全B → INFP，I/N/F/P各3票，均与fixture golden counts逐项相等 |
| 反向试算 | 全A且q1/q5反向 → ISTJ，E1/I2，其他三维仍各3票；只创建临时计数，不返回个人结果ID |
| 非法答案 | 少题、重复题号、未知题号、未知option_id → 拒绝；不会补默认个人答案 |
| 存储/网络隔离 | 模型/组件在VM中将fetch与浏览器持久化全部设为throw；读取/保存/发布默认adapter均 unavailable；实际浏览器捕获45个请求，无API或非GET/HEAD请求 |
| 保存/发布 | 三页与编辑抽屉所有持久化按钮禁用，发布禁用；未产生任何成功保存/发布版本、订单、用户权益或用户测评历史 |

## 实际命令与退出码

环境 Node `v24.21.0`、pnpm `10.0.0`。最终代码上的命令如下；测试包括既有B1/B2，不改其测试与实现。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `git status --short`、`git branch --show-current`、`git log -6 --oneline`、`git rev-parse HEAD` | 0 | 开工dev与要求的基线/祖先一致；无已跟踪修改 |
| `pnpm --dir admin test` | 0 | 31/31通过，其中13项B3；无skip |
| `pnpm --dir admin lint` | 0 | 无错误/警告 |
| `pnpm --dir admin typecheck` | 0 | vue-tsc通过 |
| `pnpm --dir admin build` | 0 | 31模块，153.45kB JS，35.09kB CSS；dist不提交 |
| `git diff --check`、`git diff --cached --check` | 0 | 无空白错误 |
| `shasum -a 256 …` | 0 | 原型、候选题库、静态fixture与素材如上 |
| `orca ports --json` | 0 | 开工空列表；没有尝试恢复缺失的F1 owner |
| `orca terminal create --title 'B3 isolated layout check' --command 'cd admin && pnpm dev' --json` | 0 | 仅本地Vite4255布局服务器 |
| `orca tab create/reload/viewport/snapshot/focus/keypress/select/eval/screenshot/network/console` | 0 | 以下隔离布局与键盘证据；不是认证/服务端证据 |
| `orca tab close --page 34074f77-7f65-420a-9eee-46a828817dd9 --json` | 0 | 只关闭本次隔离标签 |
| `orca terminal close --terminal term_d3028a80-68f2-4a6a-a924-f2c91db6fd23 --json` | 0 | ptyKilled=true；临时HTML已删除 |
| `git add <上述11个精确代码路径>`、`git commit -m 'feat(admin): 实现 B3 三页内存配置与隔离预览'` | 0 | 代码候选提交如上 |

实现迭代中出现过typecheck退出2（混入H5运行时类型环境与表单联合类型）、lint退出1（全角空白）、测试退出1（隔离renderer/跨VM Error及断言作用域）。已修正，以上最终四项全部退出0；没有把早期失败当成通过。Git命令持续报告现存 `.git/objects/pack/._pack-*.idx` 的 non-monotonic index 提示，但读取/提交退出0；未修改Git元数据或清理用户AppleDouble文件。

## 1440px / 390px 隔离布局证据

仅在忽略目录临时创建 `admin/.local-data/b3-config-layout.html`，直接挂载真实 ConfigPage；页首注明“隔离组件布局检查 · 未登录、无 API / DB · 不代表真实会话或角色验收”。没有替换登录、伪造服务端会话或注入角色。临时入口已删除，浏览器标签与服务器终端已关闭；截图只在本机忽略目录保留。

- 1440×1000：首页两列、商品两列、三款模板三列、题库表格检查；原稿三张素材正常载入。
- 390×844（Orca mobile）：首页/渠道/商品/模板单列，人格两列；题库640px局部横滚，document scrollWidth=390，无全页横向溢出；预览抽屉宽390，内部独立滚动、底部按钮可见。
- 实际用键盘进入第1题编辑、改反向并应用，显示 `preview-only-1cczv8v` 与内存提示；不保存。人格预览初始聚焦dialog，Tab到关闭按钮，Shift+Tab循环到完成预览，Escape关闭并返回“INTJ 手机预览”触发按钮。
- 45个网络记录未截断：无 `/api/` 请求、无非GET/HEAD请求；console只有Vite调试记录。初次临时HTML使用运行时template导致空页，已改为render/h后重载检查；此问题仅在未提交的隔离入口。
- 本机截图：`b3-content-desktop.png`、`b3-catalog-desktop.png`、`b3-styles-desktop.png`、`b3-assessment-desktop.png`、`b3-content-mobile.png`、`b3-channels-mobile.png`、`b3-catalog-mobile.png`、`b3-styles-mobile.png`、`b3-assessment-mobile.png`、`b3-personas-mobile.png`、`b3-manual-preview-mobile.png`，均位于 `admin/.local-data/`，不提交。

这是隔离组件截图/布局与选定键盘行为证据。未声称真实已登录三页、原稿/实现全尺寸并排像素验收、触屏真机、跨浏览器持久化或服务端授权通过。原稿的持久化/模拟下单脚本被替换为明确禁用和独立呈现；不支持的轨迹/换名片数据预览说明不可得。

## unknowns / needs_human_review 与剩余证据

| 项目 | 状态 / C1/C2待办 |
|---|---|
| 唯一配置插件、真实管理读取/写入/发布URL、权限码 | `needs_human_review`；本次不制造API；C1/C2定义唯一配置owner与真实adapter |
| 规范payload、字段映射、类型/商品/模板稳定标识 | `needs_human_review`；原稿id/title/cents/on与现有H5 code/name/amount/saleable等如何映射须导师定稿；UI字段不能升格为正式契约 |
| 权益条目与素材资源标识 | `needs_human_review`；原稿只有权益说明，不擅自新增授权/计数payload或图片上传接口 |
| 正式题库版本、题目方向映射、同版兼容性 | `needs_human_review`；冻结候选fixture只用于参考/试算；preview-only哈希不是服务器版本，正式版本/旧结果兼容由C2确认 |
| revision、并发保存、发布审计/事务与冲突恢复 | `needs_human_review`；consumer将revision保留opaque；真实原子写入/拒绝证据 `NOT_RUN` |
| 服务端约束 | `NOT_RUN`；C2须独立强制价格范围/最后上架/最后启用/题库映射，不得把本地校验当服务器通过 |
| 真实草稿保存、重启持久化、发布与已发布投影 | `NOT_RUN`；C2负责跨浏览器读同版本、草稿不改线上、发布后生效与历史快照不回写 |
| 四角色HTTP200/403/401、字段投影/脱敏 | `NOT_RUN`；沿用B1可见性而非新增客户端角色；原F1本地DB owner缺失仍只阻塞真实会话集成，没有重建/重置/猜配置 |
| 对外H5读取与结算 | `NOT_RUN`；未改web、订单/权益/既有结果；H5只应消费C2安全的已发布投影，不能复用包含管理方向/内部字段的整个UI模型 |

本卡授权的B3 UI_CONTRACT范围已完成。代码/证据提交后停写，由总控续派C1/C2实现与真实服务验收。
