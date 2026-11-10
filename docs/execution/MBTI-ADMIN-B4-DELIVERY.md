# MBTI Admin B4 — 双图工作室、阶段复测、交换与雷达

B4 完成三页的内存编辑、离线试片、异常和匿名手机效果。持久化、发布、真实模型、真实队列/聚合、服务器四角色与公网联调仍未执行；本地测试不能代替这些验收。

## 派发与基线

- Run：`run_801f9322af2e`；Task：`task_1a71399aff6f`；Dispatch：`ctx_61124b7035ec`。
- 目录：`/Volumes/Lexar/日常工作/2026/mbti/demo/mbti`，始终在 `dev`；初始 HEAD `cef9e2d6b50279891cd05d2267fbdab3a64fc079`，其父含 B3 `5d9df8590977463bcf39d6979151d4267125fcf1`。
- 初始没有已跟踪文件修改；已有未跟踪输入包与大量 `._*` AppleDouble 文件均保留。Git 同时报告 `._pack-….idx non-monotonic index` 噪声，没有清理或修改 `.git`。
- 单 Writer、无子 Agent、无切分支/新树、无 push/部署。候选提交 SHA 见本次 worker_done 回执；文档与实现同次精确路径提交。
- 只修改覆盖表的 `UI-05.1–4`、`UI-09.1–2`、`UI-10.1–2` 八行；未改 B1/B2/B3/B5、Foundation、H5、历史订单/结果、权威 API 文档及 `config-contract-v1.ts`。

## 输入与可追溯来源

已读 B4 卡、RUNBOOK、ADMIN/API-COVERAGE、运营 HTML、图像包 README / core / server / 手机原型；默认值及表单范围来自原型：阶段七标签、30/90 日，兴趣优先、每日 8 次、500 米、阈值 10。复制 core 到 `admin/vendor/mbti-image-kit/core.mjs`，逐字节保留。

| 来源 | SHA-256 |
|---|---|
| `orca-inputs/MBTI-Orca-20261109/inputs/mbti-image-kit.zip` | `25bebe3bf3674b0ab4893e1ce350fe03b0305f2266b1b4dcd5a6fdf26d2824f2` |
| 包内 `README.md` | `ff599db7ae3f24faa44c4442b0544fa413c8e3f17a938de617cc6fbf2b107ffe` |
| 包内 `core.mjs` / 仓内 vendor 副本 | `8b4e8d8f64ba5710a4d0121c29d13d6c5dc07187c10f2df747247f5052e50a82` |
| 包内 `web/mbti-dazi-mobile-v04.html` | `dd5a4ad8adbf6badee4f12cc97b5805c94370c37a22de737860e0299c1522031` |
| 运营原型及包内 `web/mbti-dazi-admin.html` | `fb7607763dbc41472bccda10fc24f9241ec4d306d3b745eaabdb7be4a94248a6` |

测试固定 core 哈希，无需未跟踪 zip 即可运行。输入包未提交；没有导入其浏览器存储、虚构运营人数、模拟角色或真实网关配置。

## `#/ai`：两槽、同意、离线 API

第一槽始终为人像、第二槽始终为风格；初始都为空。明确同意之前两个 file input 禁用，处理函数也再次检查同意与页面能力。选择仅解码本机 File，允许 JPG/PNG/WEBP、非空且不超过 8 MB，边长 240–8000，缩放至最长边 1280 后保存在当前页内存。没有文件名、EXIF 或原始文件持久化。两个槽独立替换/清空，也可恢复两张为空；取消同意清除全部图片、结果及记录。

替换图、改配方/人格/模式立即清旧结果；图片解码有每槽版本屏障，生成有生命周期/版本屏障，旧任务不能覆盖新输入、重置或离开页面后的状态。

精确离线调用入口（不是 HTTP）：

```ts
runOfflineSample(
  { portrait: localJpegDataUrl, style: localJpegDataUrl,
    consent: true, mode: 'offline', recipe: 'portrait' | 'balanced' | 'style' },
  { fail?: boolean, render?: typeof composite }
): Promise<string> // data:image/png;base64,...，仅内存
```

- 先检查同意、两图、模式和配方；缺任一图/同意或选择 real 时，在 core / render 前抛出本地拒绝。
- `core.mjs` 实际导出的是 `makeGateway`，不是浏览器合成器。B4 使用其原样双图校验器，并显式注入封闭内存 `upstream`；没有启动包内 server、读取环境密钥、原生 fetch 或网络 fallback。
- 内部数据沿包的 `mbti-image/v1` 顺序校验：`images[0].role=portrait`、`images[1].role=style`、`consent=true`、`n=1`、`adapter=wan`、`model=wan2.6-image`、`size=960*1280`。`wan` 等字段在这里仅是校验器的固定契约标签，不代表调用该供应商。
- 浏览器原生 Request 会剥除调用者设置的 Origin；离线适配器使用纯内存 `{url, method, headers: new Headers(...), body: Blob.stream()}` 结构供 core 读取，不发送 Request。固定的 `offline.invalid` / vendor URL 只作内存分支标签，不会 fetch、导航或传给 img。非空 env 值是公开的 `OFFLINE_MODE_MARKER_NOT_A_CREDENTIAL`，不是凭据；不用于生产授权。
- 真正渲染在本机画布：固定 384×512，人像构图 + 风格均值迁移和空间混色，权重为 .38/.60/.78。两图参与像素运算；相同输入与配方在同一运行环境确定性输出。跨浏览器编码字节一致性不作承诺。
- 固定无个人信息的映射文字；不开放个人提示词输入。结果明确标“离线本地样例 / 非模型输出”；人格仅做旁侧/手机排版，不写入名片或结果历史。
- 失败演练仍须两图及同意。失败清结果，固定中文错误，手动重试仅重新做本机合成，没有真实任务重拨或模型调用。
- 配方子页可调整融合优先级、带入试跑、恢复均衡；替换参考回到独立风格槽。保存试片、保存配方、真实模型提交、系统参数始终禁用，依赖见权限表。
- 调用记录仅在当前页内存最多 20 条，显式白名单：`source=admin-local`、`mode=offline`、`status`、固定 recipe 枚举、`at`、整数 `durationMs`、固定 `errorCategory`。不记录输入/输出图片、Base64、文件名、提示词、密钥、原始错误或请求头；无控制台输出/浏览器存储/服务端日志。它不是服务端审计。

## 与当前 Foundation 的契约核对

| 项目 | 输入包契约 / 当前源码事实 | B4 分类 |
|---|---|---|
| health | 包：`GET /api/mbti-image/health` → `{contract,adapter,model,ready,reason}` | 只用 core 内存测试确认无配置 `200/ready:false`；真实 health、代理与供应商状态 **NOT_RUN**，UI 写“未检查”，不发探测请求 |
| generate | 包：同源 JSON `POST /api/mbti-image/generate`，有 requestId、两槽 data、prompt、size、consent、n；200 返回主视觉 data URL | 离线走原样 core + 内存 renderer；真实接口/服务器试跑权限尚无精确验证，**UI_CONTRACT**，不能把本机 success 视为模型成功 |
| 现有 MBTI 分享 | `mbti.controller.ts` 的 `POST /api/v1/share/preview` → `MbtiShareService.preview`，消费 result_id / scene / template_id，事务创建 SVG 分享资产，返回 preview_url | 与双图请求和响应不兼容；B4 不调用，不以它代替模型试跑，不创建 ShareAsset |
| 运营上下文 | `mbti-ops.controller.ts` 的 system-context 只声明 `UI_CONTRACT / CONFIGURATION_PLUGIN_NOT_CONNECTED` | 不构成模型 health 或配置可用证据 |
| 雷达现状 | `mbti-radar.service.ts` 返回 `count:null,status:unavailable`，reason 为 not_enrolled / location_source_not_configured；H5 radar-state 保留 unavailable | 不用现有 guest 参与接口作为运营配置/人数接口；实际 H5 不支持计数时，预览默认也呈现来源未接通 |
| admin dev 代理 | `vite.config.ts` 原有 `/api` 代理到 `MBTI_ADMIN_API_ORIGIN` 或默认 127.0.0.1:4256 | 未改、未探测。隔离 QA 没有配置 API 代理；没有将代理 404/502、登录页 200 或连接失败标成权限拒绝 |

内存状态证据：core health 无配置 200/ready:false；generate 无配置 503；同意 false 403；双槽倒置/缺第二槽 422；本机 fail 演练经 core 返回本地失败类别，重试成功。这些是进程内 Response 状态，**不是实际 HTTP/服务端权限验收**。401/403 的真实四角色、网关 413/409/429/504、真实幂等/费用/超时扣费及重启持久化均 **NOT_RUN**。

## `#/retention`：计划和观察窗

标签 1–10 个、去重、每个最多 12 字且纯文本；快捷天数 1–3 个不同整数、范围 1–365，排序后应用到内存。非法输入保留原计划并显示本地拒绝。用户仍可自选日期，阶段默认私密；更名不改旧快照。可编辑的快捷回访天数不改变 45/52 天指标观察规则。预览只显示计划入口，不伪造用户阶段记录、复测结果、率或人数；不发送提醒或生成日历文件。

第 0 天首测；当天重测不计长期复测。阶段复测率分母只纳入**满 45 天**首测队列，明确剔除 <45 天者；分子为同一队列第 28–45 天同版本复测者。按首测渠道与成熟日期归属统计周期，源映射待确认。对比打开率另保留**第 52 天**成熟观察窗，让最后合格复测留足后续 7 日；分母为同批已满观察窗的同版复测者，分子为后续 7 日打开对比者。52 天是观察窗，绝不是推送时点。四指标及四渠道表均为 `—`；没有源数据，不能把未知显示成零。

测试覆盖 44/44.99/45/51/52 天界限、标签/天数非法范围与去重、预览应用和卸载重建恢复。队列查询、同版关联、对比事件、渠道/时区/截止、成熟分母和真实指标全部 **UI_CONTRACT / needs_human_review**，没有运行聚合或读取 H5 私有作答。

## `#/social`：推荐、限额和隐私

可内存选择相同 MBTI / 共同兴趣优先，申请上限为 1–30 整数；雷达开关为布尔，半径固定 500/1000/3000 米，匿名阈值为 10–200 整数。非法配置不应用。预览只有匿名占位，没有真实名片、联系方式、人员列表、位置、轨迹或真实计数；不请求 GPS，不读取参与选择、不发送申请/消息。

`radarProjection(enabled,minimum,count)` 仅为本地规则函数：关闭→disabled/count:null；无来源→unavailable/count:null；`count<minimum`→hidden/count:null/“人数较少”；达到阈值才 `floor(count/10)*10 + '+'`。低阈值与包内手机原型文字/十人分桶一致；当前仓内 H5 的真实服务仍是 unavailable，不能冒充 hidden 或有真实人数。预览默认显示当前 unavailable，可明确切换“低于阈值”或“虚构条件分桶样例”；后者仅由配置阈值构造条件，绝非实测统计，不暴露精确样例人数。关闭开关后旧预览也立即隐藏。

不代替用户同意换卡；微信/QQ/电话逐项授权保持原边界。真实推荐、每日限额执行、聚合、位置来源/主动参与/撤回、全局关停及旧请求屏障必须由后续服务端实施。

## 各动作权限与精确 UI_CONTRACT 依赖

沿用 `ops-policy.cjs`：页面入口要求真实 session 的 `mbti:ops:draft:write`，即 owner/editor 预期可见；support/reader 不显示这三页。组件另以 canEdit 守卫本地选图/试跑/应用函数，false 即使直接调用禁用按钮的处理函数也无作用，能力失效清图。没有创建浏览器角色、token 或替代会话。以下本地能力绝不等于服务端写授权，真实角色 HTTP 验收 **NOT_RUN**。

| 动作 | 当前允许与拒绝 | 尚缺依赖 |
|---|---|---|
| 两槽选择/替换/重置、确认/取消同意、配方/人格/模式选择 | owner/editor 页面能力 + 明确同意后本机选图；拒绝无同意；不上传 | 任何未来上传须独立服务端身份/双图验证/保留策略；权限 code unknowns / needs_human_review |
| 离线生成、失败演练、手动重试 | 还须两图完整 + offline；缺图、不同意、real 或 canEdit=false 均拒绝 | 不依赖真实模型；不能授权真实试跑 |
| 配方编辑/恢复/带入、临时风格参考 | draft 页面能力，仅当前内存；参考图继续走同意门 | C2 配方草稿/资产引用/版本冲突、服务端编辑权限映射待定；保存配方禁用 |
| 试片保存/真实提交/health | 全角色禁用真实提交与保存；不发 health | 精确双图模型端点与包络、服务端试跑权限、授权/权益、费用、持久幂等/审计、图片保留/删除、试片资产保存；全部 UI_CONTRACT |
| AI 系统连接参数 | B4 全角色禁用；owner 的 systemWrite 不由 draft 推导 | B5/C2；现有呈现权限 `mbti:ops:system:write`，精确操作字段/端点/校验未接通 |
| 调用记录、手机效果/收起 | 当前页白名单内存/安全排版；手机生成/分享禁用 | 服务端任务审计、试片读取及安全公开投影未接通 |
| 阶段标签/快捷天数校验及应用/手机效果 | draft 页面能力，纯内存；创建记录/设置提醒禁用 | C2 计划草稿/版本/公开投影；提醒渠道与用户选择/独立发送权限；不在本次实现 |
| 成熟队列/同版复测/对比查看 | 仅口径与空值；无查询/导出/用户结果 | 成熟队列服务、时间/渠道/去重/版本/对比事件事实及聚合读取权限待定 |
| 推荐顺序/每日申请限额及应用/预览 | draft 页面能力，匿名占位；申请按钮全角色禁用 | C2 持久规则、推荐排序、每日限额/幂等/服务端执行与读写权限映射 |
| 雷达开关/半径/阈值、条件预览 | draft 页面能力，规则投影；无定位请求 | C2 持久规则、合法位置来源/同意、匿名分桶与阈值在服务端执行、全局关停/撤回/旧请求屏障、聚合权限 |
| 保存草稿/发布 | 三页全角色禁用，无调用 | 保留 `mbti-config-consumer/v1`，未扩展其 content/catalog/assessment scope。C2 必须提供 B4 scope/字段映射、read/saveDraft/publish 适配、opaque revision/conflict/权限和有效版本；新增 UI 字段均 unknowns / needs_human_review，owner 发布能力也不解锁缺失服务 |

## 验证与副作用证据

`admin/scripts/b4.test.mjs` 共 15 项 B4 测试，与此前 31 项合计 **46/46**。实际挂载组件，给 fetch/XHR/socket、localStorage/sessionStorage/IndexedDB、history、navigator、postMessage、console 设置拒绝陷阱；所有动作完成后 effects 为空。覆盖两图/同意的七种缺失组合、real 拒绝、独立重置、取消同意、过期生成/解码、失败重试、脱敏记录、canEdit=false、配方、计划、雷达与不可用配置边界。无业务 API、存储、结果历史、订单、名片授权、消息、模型或下载副作用。

第二图因果性有两层证据：Node 中实调 core 离线 API（渲染器注入可检查的合成像素），固定人像和 recipe，style A/B 得不同输出，同一输入重复相同；匿名浏览器另走真实 File→createImageBitmap→JPEG→core→384×512 canvas PNG，使用无人物的合成色块，同样检查替换第二图清旧结果、输出不同及重复相同。浏览器不登录，不伪造角色，只挂载组件，canEdit 是组件测试参数。

匿名浏览器最终命令 `python3 /tmp/mbti-b4-browser-qa.py` 退出码 **0**。本地证据 `/tmp/mbti-b4-browser-evidence.json`，运行日志 `/tmp/mbti-b4-browser-final.txt`；这两者只保留规则状态、布尔断言和资源分类，未保存原图/成图/文件名/请求体。画布结果 384×512、第二图改变输出=true、重复相同=true；失败清结果和手动重试通过；三页 390px 页面无横向溢出，桌面 1440px 已检查。全部副作用陷阱为空，69 条捕获资源均为本地 GET 模块/样式或内存 data 图资源，API=0、非 GET=0、外部来源=0；内存 data 图的 GET 记录不表示网络上传。

最终视口截图已逐张打开检查（临时路径，未纳入 Git，无真实人物）：

- ai desktop screenshot：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/720a5ab5-c515-4564-8278-54b8a1a70b49-screenshot.png`。
- ai mobile screenshot：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/c7e50bbc-69a6-4412-bebf-1312e94a2913-screenshot.png`。
- retention mobile screenshot：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/dd3957d8-7e5c-4fef-b0d4-167c5e190c1a-screenshot.png`。
- social mobile screenshot：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/365d85f2-fb29-4116-83fd-4c8b7dc9d940-screenshot.png`。

截图/网络只属于隔离组件，不是 `/ops/` 登录后台或线上服务通过证明。临时独立 Vite 使用去除外部字体导入的既有样式，不改产品样式；QA 服务及测试入口在收尾时停止/删除。

## 实际命令与未验项

| 命令 | 退出码 / 结果 |
|---|---|
| `git branch --show-current` / `git rev-parse HEAD` / `git status --short` | 0；dev / cef9e2d… / 已知未跟踪输入与 AppleDouble |
| `git merge-base --is-ancestor 5d9df85 HEAD` | 0；B3 基线存在 |
| `shasum -a 256 admin/vendor/mbti-image-kit/core.mjs .../mbti-image-kit.zip` | 0；哈希如上 |
| `pnpm --dir admin test` | 0；46/46 |
| `pnpm --dir admin lint` | 0 |
| `pnpm --dir admin typecheck` | 0 |
| `pnpm --dir admin build` | 0；Vue typecheck + Vite build，37 modules |
| `python3 /tmp/mbti-b4-browser-qa.py` | 0；匿名组件真实画布/390px/脱敏/无副作用检查 |

早期测试修正了两处测试装置（中文路径 URL 解码、模拟 renderer 的 document/selectedIndex），没有弱化业务断言。浏览器检查还发现原生 Request 的 Origin 剥除导致离线 core 拒绝，已改为纯内存 Blob/Headers 结构；最终验证对真实上传没有放行。

真实管理员 session/四角色 200/401/403、服务端保存/冲突/发布、真实双图 API/网关/代理/模型/费用/试片存储、真实复测 cohort、真实推荐/每日限额/雷达聚合及公网 H5 同版验证一律 **NOT_RUN**。Foundation 未修改，故未跑其测试/build。没有 push、部署、生产动作或其他外部副作用；后续由 C2 接通精确服务后逐项复验。
