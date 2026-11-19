# F2 前端候选联调

2026-11-09，Run `run_594d408d15de`，Task `task_b0f64905a57d`，Dispatch `ctx_965941c28396`。本树基线 `7d43d023b3ea0e0cc2e4af576089c2b17be9319f`（已集成 F1）；原始 dev 为 `3c0b9eb5`，只读参考 PR #20 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f` 的消费者意图。本说明记录前端实现与实际证据，不定稿或修改根 `docs/api/` 契约。

## 变更范围

- 保留 dev 页面风格，仅接线 `web/`。历史详情并发请求本人详情、16 型元数据和本人列表；展示元数据和真实测评计数。比较只选择当前列表中更早、同版本、`source=quiz` 的记录，调用静态 `/results/compare`，422、401、404 及网络错误有可见反馈，失败可重试。
- 自选页从 `/types` 读取 16 型，创建 `source=self_select` 后读取服务端快照；保存期间锁定重复点击。结果及历史均明确标记自选，无答题计数、不参与测评比较。
- 删除等待 `DELETE` 成功后提示并重载阶段列表；错误保留页面和反馈，不先删本地数据。历史列表读取失败不再显示空记录成功状态。
- 分享页真实调用 `POST /share/preview`，要求同步 `status=ready` 和绝对 HTTP(S) `preview_url`；用该 URL 加载图片并展示返回地址。图片加载完成才显示就绪，生成失败与图片加载失败可重试。移除本地卡片占位及 `job_id` 作为图片的回退。
- F1 请求客户端、独立游客和原题库草稿恢复未改动；答题页逐题 `await`、`saving` 锁、末题整批 `await` 后再 submit 均保留。没有合入 PR #20 整套 UI、社交/付费代码，没有修改后端、Prisma 或运行秘密。

## 启动及恢复

本树独立 `npm ci`，Node `v24.21.0`。本候选只使用 **`http://127.0.0.1:4155/#/`** 与专属测试 API **`http://127.0.0.1:4156/api/v1`**，请用该精确浏览器源；不要替换 F1 的 5173/4056，也不要把本候选 API 指向 F1 开发库。

```bash
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-f2-web/web
npm ci
VITE_USE_MOCK=false VITE_API_BASE_URL=http://127.0.0.1:4156/api/v1 npm run dev:h5 -- --host 0.0.0.0 --port 4155 --strictPort
```

临时 H5 保持运行，Orca terminal `term_3dac0820-fe33-48cc-ace3-96f87dd36bc0`。API 生命周期与测试数据库由 F2 后端 owner/总控管理，前端 Worker 没有安装/链接后端依赖、改 schema、运行迁移或操作 F1 服务。集成后须从集成树用相同构建参数启动 H5 复验。

## 实际验证

所有下述 API 验证关闭 Mock，使用真实 Nest/Prisma/PostgreSQL 专属测试服务；请求层的隔离测试另列，不能替代 HTTP 验收。

| 检查 | 本 Worker 观察到的结果 |
| --- | --- |
| 服务 | 初次 4156 尚未启动（curl 退出 7、HTTP 000）；整理代码后在浏览器正常操作中就绪，`GET /types` 200、OPTIONS 204；4155 H5 HTTP 200。F1 4056 health 与 5173 H5 探测各 200，未停止或替换 |
| 自选、元数据 | 页面加载 16 个类型；点击 INFP，`POST /results` 201，结果 `34fe5ab2-f107-41c8-951b-6d68fbdae17f`、版本 `self-select-v1`；结果和历史均显示自选及无答题分布，不出现测评分数 |
| F1 UI 回归 | 第一轮 session `c22a8adc-b2c8-4dfa-a474-02c65c3345a3`，前三题后刷新仍在第 4 题，随后完成；全第一项得到 ESTJ `e02cf02d-ce5b-4a53-b656-b3eb4d6dbcd9`。第二轮 session `5ebc8deb-d5aa-4fd1-8e28-1b1ca6aa70a2`，全第二项得到 INFP `341ab62b-4ce1-4750-ac44-e7c96e5cfaf0`；两轮题库均 `qb-v0.4-prototype-1`，24 次 PUT 全部 200，2 次 submit 均 201 |
| 历史详情、比较 | 从阶段列表打开第二轮；详情、types、list 三个 GET 同时发出且均 200，静态 `/results/compare?baseline_id=…&target_id=…` 200，页面显示 `ESTJ → INFP`；动态 `GET /results/{id}` 独立返回真实快照 |
| 不可比 | 用 A 当前请求层比较真实 quiz 与自选返回 422 `INCOMPARABLE_RESULTS`，保留服务端错误；历史消费者主动排除自选。页面对比较 422 有明确说明及重试入口 |
| 同步分享及图片 | 从自选结果页进入分享，POST 200，返回 `status=ready`。浏览器实际加载返回 URL 的 SVG，GET 200、`image/svg+xml; charset=utf-8`、1239 字节，`complete=true`、自然尺寸 1080×1440；390px 截图已查看，显示真实图片和返回 URL，无本地占位 |
| B 归属隔离 | 独立 B profile 通过同一源码请求层读取 A 自选详情、对比、删除及分享，均真实返回 404 `NOT_FOUND`，未换游客、重放写操作或伪造成功 |
| 删除 | A 在自选历史详情点击删除，DELETE 204；跳回列表只剩两条 quiz。再次 GET 被删详情为 404，列表不含已删 ID |
| F2 smoke | `python3 /Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane/smoke.py --base http://127.0.0.1:4156/api/v1 --phase F2` → 0；包含 F1 链路、重交 409、跨身份 404、自选比较 422、分享和删除。该脚本的两条 quiz 结果为 `e964b34d-8032-427c-931e-8bf024ea3e7f` / `f8c1638e-fb9d-44c4-bc31-bd4fe44ede0e` |

分享资源在浏览器成功加载时的返回地址为 `http://192.168.0.200:4156/api/v1/share/assets/9f974942dbd3ac7445f858f128100081aa33ee04bb15de1773e9311bf37f9940.svg`，对应自选结果随后已按删除流程删除；不要把删除后的资源可达性推断为留存承诺。

Orca 内置浏览器 A isolated profile `62194468-757e-4438-a1b9-646bf64889f4` / page `56bdfee7-3148-4b27-a13f-f74225f51030`；B profile `83e579f5-94d0-47b3-8757-dc4218599cc0` / page `8e3d219b-840c-446e-a8b8-4d86bdef0405`。保留 A 两条 quiz 供总控重启后复验。A 的脱敏 Network 元数据留本机 `/tmp/mbti-f2-web-A-network.json`（174 条、`truncated=false`），从首屏后开始捕获，不据此声称游客初始化请求次数；B 的 404 是通过请求层捕获的真实 HttpError，首次 Network 读取前未捕获到请求条目。文件无请求头或凭证，未提交。A 控制台仅 Vite 连接调试消息。

## 本地检查及未验项

| 命令 | 退出码 |
| --- | --- |
| `npm ci` | 0 |
| `npm run test:api` | 0，15 项（F1 原有 11 项及 F2 并发首访、裸响应/204、静态对比路由与拒绝不回退、同步预览输出检查） |
| `npm run type-check` | 0 |
| `VITE_USE_MOCK=false VITE_API_BASE_URL=http://127.0.0.1:4156/api/v1 npm run build:h5` | 0 |
| `git diff --check` | 0 |

锁文件已有 npm 审计提示 75 项及构建 Sass 弃用提示；本轮未升级依赖。Git 对上游共享对象库中的 `._pack-*.idx` 输出既存 `non-monotonic index` 诊断，但上述 Git 读取/检查仍退出 0，本 Worker 未改共享 Git 元数据或 `._*` 文件。

本 Worker **未验**：两个不同真实题库版本的固定数据比较 422（由后端 owner/总控准备 fixture）、4156 重启后的记录/资源持久性、强制触发服务端 503 生成失败与浏览器图片加载失败分支、真实 401 页面的再次现场注入、跨物理设备、小程序或生产。拒绝不回退与 F1 401 不重放由隔离测试通过；不能将其写成对应真实服务故障的验收。已向总控明确本轮浏览器流程完成，可给 4156 短重启窗口。

比较范围延续当前页面的最近 50 条列表，未增加分页或任意历史记录选择器；跨版本/自选不会作为自动比较候选，服务端拒绝仍可见。候选提交 SHA 以本次 worker_done 回执为准，提交后停止写入，不 push/merge。
