# MBTI Web API Fastlane F1 集成交付

2026-11-09。Run `run_594d408d15de`。本记录是内部联调候选的实测交付，不定稿根 `docs/api/` 契约，不代表生产发布。

## 地址与代码

- F1 已通序号：#1、2、4、5、6、7、8、9；F2 尚未计入通过。
- 实际 API：`http://192.168.0.200:4056/api/v1`。
- 实际 H5：`http://192.168.0.200:5173/#/`。
- 从当前开发机访问 LAN 地址已通过；实习生另一物理设备待跨设备验证，需要与开发机同网或另有已配置路由。
- 最新远端 dev 基线 `3c0b9eb5c6fa52e56a7418a1b27e73827bd4070b`；PR #20 核查来源 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f`。
- 已集成实现 SHA `6fe083c5dd7f13fa239c719d4185f1a0f59041fa`。QA、后端和 Web 原候选分别为 `39e0e39e28318fdd8158291948d383c600c30a85`、`88aae055a49e102c6416387e6f92b0e338129d5e`、`286bd9b04f88201439c0a483560ef6baebab4c2c`。
- 题库 `qb-v0.4-prototype-1`；12 题题干/顺序/选项与输入 fixture 一致，第一项全选 ESTJ、第二项全选 INFP；保留旧 `qb-v0.4-teach-1`。
- H5 明确 `VITE_USE_MOCK=false`、`VITE_API_BASE_URL=http://192.168.0.200:4056/api/v1`。

## 集成后的真实检查

总控在独立集成树安装本树依赖、生成 Prisma client、构建后，将 API 和 H5 均切换到集成代码。开发/测试数据库项目归属核验通过；沿用同一 MBTI 专属开发数据，没有复制秘密、接入上游数据库或改 main。

| 检查 | 实际结果 |
| --- | --- |
| Foundation `pnpm install --frozen-lockfile --ignore-scripts`、`prisma:generate`、内部包 build、Nest build | 均退出 0；Node 24.21.0、pnpm 10.0.0 |
| Web `npm ci`、`npm run test:api`、`npm run type-check`、真实配置 `npm run build:h5` | 均退出 0；11 项请求/身份/草稿测试通过 |
| 原后端候选全工作区 typecheck/lint/test | Worker 退出 0；97 项配置 + 79 项 API 回归；独立测试库 46 项真实 HTTP/摘要/过期/DB 不可变约束通过 |
| `python3 /Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane/smoke.py --base http://192.168.0.200:4056/api/v1 --phase F1` | 集成服务实际退出 0；A `765f29ac-b32a-4829-a7b5-01e6ce696322` / `511109b1-c671-4c18-8a25-fb540bb40d04`；B 空列表/详情 404；并发 201+409 |
| 补充脚本 `prepare-restart` / `verify-restart`（同 LAN base、仓外0600状态文件） | 均退出 0；同两游客、5 个结果、分页和两题草稿跨 API 进程重启存活，迟到写 409，跨人 404 |
| 集成 H5 A 两轮实际点击 | 第一项全选结果 `8a3d4793-93ab-43e4-8988-d3b6962d4b32` ESTJ；第二项全选 `4b177e28-89d8-410f-ad90-b111a9e66e83` INFP；两次交卷 201 |
| 中途/结果刷新 | 首轮第 4 题刷新仍为原会话 `2f10c83e-e76e-4f1e-87d9-dca9cf8aee07`、原题库、原进度；结果刷新仍可读；第二轮新会话 `5ed636f3-b6f3-4fc3-be35-e6bc3939e0aa` |
| 集成 H5 B 独立 profile | 本人列表 0 条，读 A 首轮结果 404；调用既有真实请求层检查，无 Mock |
| H5 Network | 捕获181条且truncated=false，其中API 55条：24 PUT 200、2建会话201、2交卷201、10 GET200、17 OPTIONS204；捕获晚于首次游客签发，不能以此捕获声称初访签发数量。原Web Worker完整323条网络已证明单浏览器游客POST一次，另有11项隔离测试覆盖并发首访 |
| A 在 API 再次重启后 | 原浏览器刷新 INFP 页面成功，同请求层读列表恰2条、同两ID详情ESTJ/INFP；没有换身份或重放交卷 |

集成切换前 API PID `80750`、entry 位于后端 Worker；切换后 PID `84288`、entry 位于集成树。完成两轮集成 H5 后，API 同配置再 stop/start 为 PID `86584`，entry 为 `/Users/lei/orca/workspaces/mbti/mbti-web-api-fast-integration/aij-foundation/apps/api/dist/main.js`。PID 仅为本次证据，恢复时使用项目脚本核验当前 PID，不直接 kill 历史编号。

A isolated profile `44d419fc-789d-454b-94fc-572bb8d52ae3` / page `5ba747e6-3e6f-461a-9573-bff7a120abf4`；B profile `294207d6-07f9-474b-bb1c-cceea1af62df` / page `0d81fe14-59fe-41e2-aa21-40d0c2cd0002`。网络去敏记录只留本机 `/tmp/mbti-web-api-fast/f1-integrated-network.json`，不提交测试秘密或浏览器存储。

QA 所提“旧单题保存晚于整批保存”的风险已由总控核查 Web 候选：`next()` 在 saving 时拒绝新动作，每次 await 保存后推进，末题 await 整批后 submit；上一题/离开/选项操作也受 saving 锁保护。未新增业务字段。Orca 的一条后端向已完成 Web Worker 的跟进邮件因 helper 归属限制未投递，无代码副作用；相关保存顺序指导已由总控在已提交代码上核实，无需重复派发原任务。

## 保持运行与恢复

API 的本项目秘密配置/数据 owner 继续为 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`；不要删除该树、忽略配置或 Docker 持久卷。开发 PG 仅回环55436，测试PG仅回环55437，分离容器/持久卷/角色，归属保护见 `aij-foundation/MBTI_F1.md`。集成树自己的依赖和代码独立安装，不链接其他仓依赖。

```sh
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-fast-integration/aij-foundation
export MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation
node scripts/mbti-local.mjs check dev
node scripts/mbti-local.mjs stop dev
node scripts/mbti-local.mjs start dev
```

H5 由 Orca 终端 `term_13988a36-98bf-4d5f-8322-e95c24e4a893` 保持运行，恢复：

```sh
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-fast-integration/web
VITE_USE_MOCK=false VITE_API_BASE_URL=http://192.168.0.200:4056/api/v1 npm run dev:h5 -- --host 0.0.0.0 --port 5173 --strictPort
```

CORS 精确放行实际 LAN 与127.0.0.1的5173源。跨设备物理实测、微信端、生产、多标签同时首访未验。已有依赖审计/Sass弃用提示未在本轮升级；原宿主手写约束导致全库schema diff退出2的说明见后端记录，MBTI模型无漂移。AppleDouble Git索引旁文件警告已过滤汇总展示，没有修改共享对象库。

## 后续

F2 在已集成 F1 上实现删除、对比、自选、16型元数据、真实图片分享预览；通过F2 smoke及H5后优先F3测试订单与受限运营同号，再接F4–F6。外部支付凭证、微信/模型供应能力按卡记录具体阻塞，不伪造成功或停止其他就绪工作。所有后续代码继续合入 dev。
