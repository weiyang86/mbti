# MBTI F1 开发服务与交接

2026-11-09，本文件是本仓 F1 实现者自查记录。基线 `3c0b9eb5c6fa52e56a7418a1b27e73827bd4070b`，对照前端 PR #20 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f` 和输入包 `MBTI-WebAPI-13.openapi.yaml`；候选 SHA 为包含本文件的提交，未 push、merge 或操作 main。

## 实际入口与数据

- 开发 API：`http://127.0.0.1:4056/api/v1`；同机 LAN 地址 `http://192.168.0.200:4056/api/v1`，监听 `0.0.0.0:4056`。
- 实际 H5 来源：`http://192.168.0.200:5173` 和本机 `http://127.0.0.1:5173`，由独立 Web Worker 维护。仅允许这两个精确 origin；预检放行 Content-Type、X-Guest-Token 和请求方法，未批准来源无 ACAO。
- Node `24.21.0`、pnpm `10.0.0`，本树重新按锁文件安装依赖，无上游 node_modules 链接。
- `RUNTIME_PROFILE=project`、`PROJECT_ID=mbti-foundation`。Docker PostgreSQL 16 的开发实例 `mbti-foundation-development-postgres`（回环 55436，数据库/角色 `mbti_foundation_development`）与测试实例 `mbti-foundation-test-postgres`（回环 55437，数据库/角色 `mbti_foundation_test`）分开持久卷、配置和随机凭证。
- 容器 project/environment/root 标签、端口映射、卷、实际数据库/用户/session_user/服务器端口及独立控制 schema `mbti_local_control` 的归属标记均在迁移前核验。未访问其他项目数据库。
- 凭证、PID、日志和重启凭证证据仅在原始 F1 树 `aij-foundation/.local-data/mbti-foundation/<development|test>/`，凭证文件权限 0600，目录及 `.artifacts/` 均忽略。

## 启动与恢复

在本工作树的 `aij-foundation/` 执行，所有命令均为本项目专属入口，不调用上游 db:*、base:dev 或 ai:local：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @aij/api prisma:generate
pnpm -r --filter './packages/**' build
pnpm --filter @aij/api exec nest build
node scripts/mbti-local.mjs init dev
node scripts/mbti-local.mjs check dev
node scripts/mbti-local.mjs migrate dev
node scripts/mbti-local.mjs seed dev
node scripts/mbti-local.mjs start dev
curl -fsS http://127.0.0.1:4056/api/ready
```

重启 API：`node scripts/mbti-local.mjs stop dev` 后 `node scripts/mbti-local.mjs start dev`。start 等待实际 READY；数据库容器设为 unless-stopped，init 可恢复已停止的本项目容器，不清库。不要删除原始 F1 工作树、本地配置或持久卷，否则会丢失凭证恢复入口。更换 H5 地址时只改本机忽略配置的 `MBTI_H5_ORIGINS` JSON 数组，再重启服务。

集成树继续使用本项目的同一组开发数据时，无需复制凭证。在集成树 `aij-foundation/` 的每条项目命令前设置：

```sh
export MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation
node scripts/mbti-local.mjs check dev
# 先在新树独立安装/生成/构建；与 Web/QA 协调切换时间。
node scripts/mbti-local.mjs stop dev
node scripts/mbti-local.mjs migrate dev
node scripts/mbti-local.mjs seed dev
node scripts/mbti-local.mjs start dev
```

该可选 owner 必须属于同一个 Git common directory 和 mbti-foundation 项目；数据库归属和配置路径仍由原始 owner 树验证，代码/Prisma 迁移/依赖则来自当前集成树。不同仓库或上游 owner 会拒绝。

独立数据库测试：

```sh
node scripts/mbti-local.mjs init test
node scripts/mbti-local.mjs migrate test
node scripts/mbti-local.mjs seed test
node scripts/mbti-local.mjs start test
node scripts/mbti/verify-f1.mjs
node scripts/mbti-local.mjs stop test
```

## 8 项行为及实际验证

成功响应直接为业务对象；错误使用 `{code,message}`，包括解析器前置的非法 JSON 错误。宿主 /api/ready 保持既有 envelope，与业务健康分开。

| 操作（均在 /api/v1） | 实际成功和拒绝 |
| --- | --- |
| GET /health | 200 裸对象，宿主 /api/ready 200 READY |
| POST /auth/guest | 匿名 201，48 随机字节的 base64url 不透明 token，90 天有效，只存 SHA-256 摘要 |
| GET /quiz/versions/current | 200 固定 12 题；无凭证/无效/过期 401 |
| POST /quiz/sessions | 201，固定绑定版本；未知版本 422；旧教学版本仍可用 |
| PUT /quiz/sessions/{id}/answers | 单题和整批均 200 按题 upsert；跨游客 404；错题、错选项、重复题目 422；交卷后保存 409 |
| POST /quiz/sessions/{id}/submit | 201 不可变结果；缺题 422；跨游客 404；重放/并发败者 409 |
| GET /results | 新游客空列表；仅本人，limit/cursor 稳定倒序；非法参数或他人游标 422 |
| GET /results/{id} | 本人 200；另一有效游客 404；无凭证 401 |

会话行在答案保存和交卷事务中均先 `SELECT ... FOR UPDATE`；交卷在锁内读取最终持久化答案。每会话唯一结果及每会话/题目唯一答案由数据库约束兜底。数据库触发器同时冻结已发布题库、结果更新、已提交状态及其答案，避免迟到保存覆盖终态。计分只使用该版本服务端 option→字母映射。

候选 `qb-v0.4-prototype-1` 的题干、顺序和选项逐字匹配输入 fixture；四维各3题，全选第一项 ESTJ，全选第二项 INFP。原 dev `qb-v0.4-teach-1` 作为独立不可变版本保留，不覆盖旧标识。

实际检查命令和退出码：

| 命令 | 退出码/结果 |
| --- | --- |
| pnpm install --frozen-lockfile --ignore-scripts | 0 |
| pnpm --filter @aij/api prisma:generate | 0 |
| pnpm -r --filter './packages/**' build | 0 |
| node scripts/mbti-local.mjs init/check/migrate/seed dev 及 test | 最终均 0；两库各38项迁移，重复 migrate 无待办，重复 seed 不改历史 |
| pnpm typecheck（全工作区，含 API 与宿主 Web） | 0 |
| pnpm --filter @aij/api exec nest build | 0 |
| pnpm lint | 0 |
| pnpm test | 0；97项基础配置 + 79项API测试 |
| node scripts/mbti/verify-f1.mjs | 0；46项真实HTTP检查，并核验凭证仅摘要、过期、数据库不可变约束、保存/交卷竞争 |
| python3 /Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane/smoke.py --base http://127.0.0.1:4056/api/v1 --phase F1 | 0 |
| 同一 smoke 命令以 http://192.168.0.200:4056/api/v1 为 base | 0 |

首次本机 smoke 的 A 结果：`7a7e95f2-46eb-48b0-9c22-4c2f676a57bd` ESTJ、`caff224a-d9ce-416d-9935-61fa47be9fe1` INFP。最终 LAN smoke 的 A 结果：`2be289f0-8a59-45ee-ae4b-f8c75621149a` ESTJ、`968d3214-5f5c-4dc9-b6a7-3984513cdcad` INFP。两轮 B 均空列表，读取 A 返回404；并发交卷201+409符合输入 OpenAPI（原任务文字200为总控已确认的笔误）。

重启前保存身份和结果 `69535b1f-f2d9-4ae4-96ab-8df7b9c1179c`；两次停止/重启 API 后以同 token、同 ID 从本机及 LAN 地址读取均200，返回同一 ESTJ 业务快照。仅本机忽略的0600文件保留该token，文档与日志不输出它。

实际修正过的失败：首次迁移 P3005 因归属标记放在 public schema，已移到独立控制 schema 后两库全部迁移成功；一次仓根 eslint 命令254因工作目录错误，切到 aij-foundation 后完整 lint=0；测试 API 刚异步启动时一次连接拒绝，现 start 等实际READY并完成46项复测。额外 Prisma 全库 schema diff 为2：MBTI模型外键默认动作差异已显式对齐，剩余为导入宿主既有手写复合外键/命名，未自动生成或应用删除这些约束的迁移。共享 .git 的 AppleDouble pack sidecar 会打印 non-monotonic index 噪声，未删除或暂存这些元数据，Git读取仍可完成。

## 待总控验收

本后端 Worker 没有执行浏览器 H5 端到端验收；前端接线及真实浏览器身份复用、A 连测两次、B 隔离和浏览器重启持久化由 Web/QA/总控验收，不能用编译代替。LAN HTTP 从当前主机成功，不代表另一台设备已实测。未进行生产部署、真实微信/支付/外部模型调用。游客失效后的账号恢复与长期留存规则仍为后续产品决定（unknowns / needs_human_review），本卡不追加正式契约。
