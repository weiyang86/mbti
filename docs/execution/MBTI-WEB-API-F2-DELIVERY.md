# MBTI Web API Fastlane F2 集成交付

2026-11-09，Run `run_594d408d15de`。F2 五项 #10、11、12、14、17 及 F1 回归通过；内部候选不改写权威 `docs/api/`。

- API `http://192.168.0.200:4056/api/v1`；H5 `http://192.168.0.200:5173/#/`。同机 LAN 自测通过，另一物理设备待验证。
- 题库 `qb-v0.4-prototype-1`，旧教学版本保留；Mock 明确关闭。
- 实现集成 SHA `f3fbb5d35221a303e46af466a945179dc59b9149`。原候选：Web `f0fda4f509fadd8faff0ab5cd26f876f0ef6e5f7`；后端 `cc66d9943855ee33770dba4a0bd77c53c9ba7f0d`，含文档 HEAD `a9b791f1d29a7d5ced877e52d11dba1f23d6fa8e`。
- 后端/Web分别在专属4156/4155完成验收，证据见同目录 F2-BACKEND-DELIVERY 和 `web/F2-INTEGRATION.md`。测试库55437与开发库55436分开；总控核验归属后才把39项中的新增资产迁移应用到开发库。

## 集成后的实际复验

| 实际检查 | 结果 |
| --- | --- |
| Web请求测试、type-check、真实配置build:h5 | 退出0，15项请求测试；分享页字段标签改为用户可读的“分享图片链接” |
| 本树Prisma generate与Nest build | 退出0，独立依赖；总控精确审阅并串行集成 |
| `python3 .../MBTI-WebAPI-Fastlane/smoke.py --base http://192.168.0.200:4056/api/v1 --phase F2` | 退出0，包含F1；A两次结果 `7ee9d4ad-759d-4e83-858a-29909416bfaf` / `ccc06b31-343a-4d9d-9d7e-f9810402f4fe`，B空列表/404，并发201+409；比较200/自选422/分享200/删除204及删除后404 |
| F1仓外0600状态的 `verify-restart` | 退出0；切换至F2 API后，同两游客、5结果、草稿及拒绝语义仍在 |
| 原A浏览器读取F1两条历史 | 原身份保留；历史详情并发读取详情/types/list成功，页面显示 `ESTJ → INFP`；真实比较200 |
| 集成H5分享页面 | 从原INFP结果历史详情实际点击分享，图片complete=true，1080×1440，手机390px截图已查看，非占位；真实URL `http://192.168.0.200:4056/api/v1/share/assets/14dacd45c31108871c6080c97962a7142979cec36d4266d038812e276292a43b.svg`，匿名图片资产不授权私密结果 |
| 原B浏览器自选与删除 | 页面16型，点击INFP后自选201，结果 `ee45d63e-61ea-487d-8648-1c11464a8355`；显示无答题分布，从历史详情实际删除204后列表显示暂无记录 |
| 后端专属补充证据 | 64项HTTP+PG、46项F1回归、9项同身份/快照/草稿/图片SHA256/删除状态重启复验及全typecheck/lint/176项基础/API测试均退出0；双向跨版本422、先归属404、三场景图片隐私、真实PG写入失败503及恢复重试200、删除级联撤销资产均通过 |

本次合并没有把后端数据库测试当成页面证据，也没有把前端隔离测试当成真实服务故障注入。Web的503生成失败/图片加载失败UI现场强制注入、401再次现场注入未验；对应请求拒绝不回退由隔离测试覆盖。原Web worker和后端证据覆盖实际接口拒绝，跨物理设备、微信端和生产仍未验。

## 服务保持与恢复

API来自集成树构建。秘密配置和卷owner仍为 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`，不要删owner树、配置或持久卷。公开资源origin固定为LAN4056，不依赖请求Host，防止链接指向127.0.0.1或伪造Host。

```sh
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-fast-integration/aij-foundation
export MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation
export MBTI_PUBLIC_ORIGIN=http://192.168.0.200:4056
node scripts/mbti-local.mjs check dev
node scripts/mbti-local.mjs stop dev
node scripts/mbti-local.mjs start dev
```

H5现在以已验真实配置的静态构建运行，避免后续候选的热更新污染已交付页面。Orca终端 `term_6388bf13-8f20-4664-9b49-c89813a516a5`，当前构建 `/tmp/mbti-web-api-fast/h5-f2-f3fbb5d`，`h5-current`符号链接指向它；该路径仅为构建产物，不含凭证。恢复已有构建：

```sh
python3 -m http.server 5173 --bind 0.0.0.0 --directory /tmp/mbti-web-api-fast/h5-current
```

若临时构建目录被清理，在集成树web按锁文件安装并执行：`VITE_USE_MOCK=false VITE_API_BASE_URL=http://192.168.0.200:4056/api/v1 npm run build:h5`，将dist/build/h5复制到独立本机产物目录，再以同端口静态服务运行。后续切换已验构建时原子切换h5-current；不要把未验候选直接挂到5173。

F3在本集成F2上启动测试商品、订单、本人查询/权益和受限运营同号；支付凭证欠缺单列阻塞，不伪造pay_params或已付款，不阻断已就绪的社交卡。最终代码继续合入dev。
