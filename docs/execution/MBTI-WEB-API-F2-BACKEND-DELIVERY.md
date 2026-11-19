# F2 后端候选交付

2026-11-09，Run `run_594d408d15de`，Task `task_e3db147ad51f`，Dispatch `ctx_4618cbb99359`。本卡仅实现后端；H5 由并行 F2-WEB Writer 及总控验证，不修改权威契约。

## 代码与运行边界

- 实际工作树 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f2`，分支 `weiyang86/mbti-web-api-f2`。
- 实际起点 `7d43d023b3ea0e0cc2e4af576089c2b17be9319f`，已含 F1 集成交付；原 dev 基线 `3c0b9eb5c6fa52e56a7418a1b27e73827bd4070b`，PR20 参考 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f`。
- 后端实现候选 `cc66d9943855ee33770dba4a0bd77c53c9ba7f0d`；本交接记录为随后独立文档提交，完整交付 HEAD 见 worker_done。未 push、merge 或修改 main。
- 输入包 `/Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane`，依据其中 RUNBOOK、API-REVIEW、F2 卡及 `MBTI-WebAPI-13.openapi.yaml`。
- 仅变更 `aij-foundation` 的 MBTI 业务、Prisma 资产表迁移、专属运行/测试工具及此交接记录；未修改 `web/`、`UIhtml/`、`docs/api/` 或独立底座仓。
- 本树重新安装依赖、生成 Prisma client、构建；没有链接其他工作树依赖。秘密配置及 PG owner 仍为 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`。
- 仅迁移测试库 `127.0.0.1:55437/mbti_foundation_test`，project/environment/root 标记与实际角色验证通过。未应用候选迁移到开发库 55436，也未停止/替换 F1 的 4056 API、5173 H5。

## 已运行的接口

测试 API 保持运行：`http://127.0.0.1:4156/api/v1`，同机 LAN `http://192.168.0.200:4156/api/v1`。宿主 `/api/ready`、业务 `/api/v1/health` 均 200。仅精确允许 `http://127.0.0.1:4155`、`http://192.168.0.200:4155`；两者预检 204 并返回各自 ACAO，未批准 origin 无 ACAO。

| 操作（共同前缀 /api/v1） | 实际成功与拒绝证据 |
| --- | --- |
| DELETE /results/{id} | 本人自选和 quiz 均 204 无响应体；另一游客 404；删除后详情/再删/分享/对比均 404，列表不可见；已提交 session 不复活，重交 409 |
| GET /results/compare | 静态路由在动态 :id 前；同版本两次 quiz 200，返回类型变化及 target-baseline 八字母计数差；prototype/teach 双向 422，自选与 quiz 422；先验证两项归属，自己不可比记录与他人记录两个顺序均 404；缺/重复 query 422 |
| POST /results | self_select 合法类型 201；独立版本标识 self-select-v1，DB sessionId/dimensionCounts 均 NULL，详情和列表无伪造计分；注入 session/version/counts/owner 字段不会落库；非法类型/来源 422 |
| GET /types | 200，完整 16 个合法唯一类型码/中文名称/tagline，展示文案沿用项目已有 type-metas；未创建新业务字段 |
| POST /share/preview | 同步 200、status=ready、绝对 preview_url；另一游客 404 且先于样式校验；无效 scene/template 422；真实 PG 写入拒绝返回 503 SHARE_PREVIEW_UNAVAILABLE，仅 code/message，恢复后同请求可重试 200 |
| GET /share/assets/{opaque-key}.svg | 无需 token 实际返回 200 image/svg+xml，1080×1440 或 avatar 1080×1080；无效/伪造 key 404；只读取已生成图片，不授权结果、答案或通用私有文件；结果删除级联撤销资产，原 URL 404 |

F1 高熵游客凭证、摘要存储、裸业务对象、结构化错误、404 归属隔离、不可变题库/结果和并发交卷行为沿用，专属回归通过。

## 图片内容与持久化

后端在真实请求中渲染 SVG 并经 Prisma 保存 PostgreSQL BYTEA；不是本地页面预览或空占位，没有调用或新增图像生成供应方。图片仅包含用户主动选择分享的类型码、对应公开中文元数据与固定产品文案，服务端不把 life_stage/recent_status、答案、维度计数、联系方式、result/session/owner ID 或鉴权字段传入渲染器。三种既有 scene 为 moments/avatar/meet_card；未指定模板或 default 使用当前内置排版，未知模板返回可处理的 422。

资产路径是 32 随机字节的十六进制 key，只对应一张实际分享图片。资源使用 no-store、nosniff、CSP sandbox/default-src none、no-referrer，没有脚本、外链或嵌入私有资源。请求 Host 不参与生成 URL；`MBTI_PUBLIC_ORIGIN` 是操作方配置的精确 HTTP(S) origin，运行工具支持非秘密配置覆盖且不改 owner 环境文件。生成事务锁定本人结果行，删除与生成不会产生孤立资产。

已实际匿名打开的持久图片：`http://192.168.0.200:4156/api/v1/share/assets/eefe8c9af9fa0148863cf9e2d033b989defbfa4c7227de4e52bc76f1023f1f0a.svg`，200，`image/svg+xml; charset=utf-8`，1239 字节。补充测试逐字节核对 HTTP 内容与数据库内容，检查私密 canary/凭证/ID 均不存在，三场景尺寸正确；删除 quiz 后资产行数为 0，原地址 404。

## 实际命令和结果

下表 Foundation 命令均在本树 `aij-foundation/`；项目命令及补充测试均设置 `MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`。

| 命令 | 退出码与结果 |
| --- | --- |
| pnpm install --frozen-lockfile --ignore-scripts | 0；Node 24.21.0、pnpm 10.0.0 |
| pnpm --filter @aij/api prisma:generate | 0；仅 schema 编译、无数据库连接 |
| pnpm -r --filter './packages/**' build | 0 |
| node scripts/mbti-local.mjs check test | 0；projectId/environment/database/role/port/root 归属核验通过 |
| node scripts/mbti-local.mjs migrate test | 0；39 项迁移中仅新增 20261109020000_mbti_f2_share_assets 应用到 test |
| node scripts/mbti-local.mjs seed test | 0；repeat-safe，prototype/teach 固定版本保留 |
| pnpm --filter @aij/api exec nest build | 最终 0；首次为 1（可选配置 URL 类型及 Prisma Bytes 类型），改为显式空配置失败和 Uint8Array 后通过 |
| node scripts/mbti-local.mjs start test | 0，监听 0.0.0.0:4156，实际等待 READY |
| pnpm typecheck | 0；全 Foundation 工作区 |
| pnpm lint | 0；补充 verify-f2 文件加入后再次运行也 0 |
| pnpm test | 0；97 项基础配置 + 79 项 API 测试 |
| pnpm --filter @aij/api prisma:validate | 0 |
| python3 /Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane/smoke.py --base http://127.0.0.1:4156/api/v1 --phase F2 | 0；包含 F1，全选第一项 ESTJ、第二项 INFP；结果 950b1ad3-a2cd-4947-bc8a-331497a725d2 / b62538dd-97f4-43f7-9736-882ce662d9b8；B 读取 404 |
| node scripts/mbti/verify-f2.mjs prepare-restart | 0；64 项真实 HTTP+PG 检查，结果 56d532ac-5621-46ab-9997-662c1cfc65f1 / fe533560-f26a-4bfb-900a-4cf277d9788c；不清库，仅创建本轮合成记录 |
| node scripts/mbti/verify-f1.mjs | 0；46 项真实 HTTP/PG 检查，摘要、过期/无效401、跨人404、黄金计分、游标、提交201+409、保存/交卷锁、DB不可变约束通过 |
| node scripts/mbti-local.mjs stop test，然后同配置 start test | 均 0；总控在 Web 完成当前流程后给出窗口，仅短重启4156 |
| node scripts/mbti/verify-f2.mjs verify-restart | 0；9 项：同游客 quiz/self_select 快照、两题草稿、同图片 SHA256、删除/撤销状态、重复交卷409及跨游客404跨 API 进程保留 |
| 最后 HTTP 探测 4156 /api/ready、4156 /api/v1/health、4056 /api/v1/health、5173 / | 均 200；F1 服务持续运行 |
| git diff --check / 精确暂存检查 | 0；无 .env、凭证、产物、日志、真实用户数据或 AppleDouble 文件 |

64 项检查中的存储失败使用真实 PostgreSQL BEFORE INSERT 触发器，只拒绝本脚本刚创建的 resultId；finally 已删除触发器和函数，未干扰 Web 数据。资源更新被数据库不可变触发器拒绝。重启状态仅在本树忽略的 `aij-foundation/.artifacts/mbti-f2-restart.json`（0600）保存，不输出或提交秘密。

## 恢复与总控集成

4156 当前运行候选代码，保持当前数据。若需要重启，先协调所有4155使用方，然后在本树执行：

```sh
export MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation
export MBTI_PUBLIC_ORIGIN=http://192.168.0.200:4156
export MBTI_H5_ORIGINS='["http://127.0.0.1:4155","http://192.168.0.200:4155"]'
node scripts/mbti-local.mjs check test
node scripts/mbti-local.mjs stop test
node scripts/mbti-local.mjs start test
node scripts/mbti/verify-f2.mjs verify-restart
```

如从另一集成树运行 verify-restart，状态文件仍属于本树，使用这里的脚本和路径即可；不要复制或展示其中 token。重新执行 prepare-restart 会创建新一组自己的合成数据并替换本机验证状态。

待总控：将后端与 F2-WEB 候选集成后复验，再由总控应用迁移到 dev 并切换交付服务。Worker 未操作 dev schema/4056/5173，未声称完成集成 H5 或跨物理设备验收；微信、生产及外部图像生成供应方不在本卡验证范围，后续运行地址/域名变化需对应设置公开 origin 与 CORS。保留 owner 工作树和测试状态，不删除配置/卷；共享 Git 既有 `._pack` sidecar 的 non-monotonic-index 警告未修动对象库，相关 Git 命令均成功。
