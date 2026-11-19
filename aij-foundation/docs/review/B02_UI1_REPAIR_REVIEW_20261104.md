# B02 UI-1 验收环境修复集中 Review

Run `run_d4eae5ba3a3b`，2026-11-04。状态 OWNER_CHECK_PENDING；沿用现有 Run，不重做 AF-129。此次两张修复卡 AF-133 → AF-132 已实际验证；只本地提交，不 push。UI-1 与 ORCA-B01 均未代标接收。

## 负责人现在可以操作

- 登录 URL：**http://localhost:3655/login**；浏览器已打开该页，服务实际运行。管理员会话页为 http://localhost:3655/admin。
- 角色/账号：合成系统管理员 `aij-admin`。
- 本机密码：仓库内 `.local-data/seed/test/aij_foundation_af029_test_e2db669860548aec/initial-admin.json` 的 `password`。此文件被 Git 忽略；旧 AF-029 和原 13655 实例的凭据均不适用于此入口。
- 本轮为 UI-1 / AF-026–029 的有限登录链验收。登录后显示“你好，AIJ 初始管理员”；该专用库当前没有菜单初始化，可以看到“暂无获准菜单”。基础账号/角色/审计菜单及真实只读闭环尚属 AF-130，不把本轮环境当作完整 base。

请亲手完成：

1. 空表单点登录：出现用户名、密码必填提示。
2. 输入 `aij-admin` 和错误密码：显示“用户名或密码不正确”，仍在登录页。
3. 使用本次本机密码登录：进入 /admin，显示当前管理员身份。
4. 刷新：仍保持登录，管理员身份正常。
5. 点击退出登录：回到 /login。
6. 直接访问 /admin：自动跳回 /login。

完成后由负责人明确决定是否接收 **UI-1 / AF-026–029**。按负责人此前“明确接收 UI-1 后再 AF-130”的指示，目前停止于该门禁；本轮“解决问题”没有被解释为已经验收通过。针对是否允许待验时继续修 AF-130 的澄清仍未获答复。接收后再核对其余真实前置，推进 AF-130；AF-131 与仓库外双项目 RC 未启动。

## 对应版本和自动证据

产品装配修复已在 `16949e4be368c0318526bda43fa97c85544de18f`，AF-132 为包含其执行记录的后续本地提交。完整运行验证以该产品 HEAD 加本卡工具/测试差异执行；源码 hash 清单和提交后的精确对应映射在 `.artifacts/orca-b02/AF-132/{verified-source-final,release-version}.json`，不伪改原报告 HEAD。

| 范围 | 结果 | 本机报告 |
| --- | --- | --- |
| AF-133 真实装配与客户认证回归 | 17 HTTP/DB + 3 配置；API build/lint/diff 通过 | `.artifacts/verification/AF-133/run-e9vpPd/report.json` |
| AF-132 显式续建工具 | 51 临时文件/失败恢复测试及定向 lint/diff 通过 | `.artifacts/verification/AF-132/run-ZUg6uV/report.json` |
| 完整 AF-029 | PASS，271 结构化 + 2 既有装配，API/Web 实际构建通过 | `.artifacts/verification/AF-029/run-Pfon1z/report.json` |
| AF-029 人工服务准备 | PREPARED；不等于负责人通过 | `.artifacts/verification/AF-029/run-2eVdFW/report.json` |
| 实际浏览器六路径 | 6/6 自动观察；不代负责人验收 | `.artifacts/orca-b02/AF-132/browser-observations.json` |

各报告有重复回归，不能把数量相加当作独立用例总数。两次完整失败 `run-AzFp1v` 和 `run-ZzV97a` 保留；分别为旧空表断言和真实客户认证隐式依赖。修复后采用同一完整第三轮通过结果。

## 修复和保留范围

AF-132 新增显式旧状态归档：核对 task/lease/Schema 变化、旧进程退出、端口空闲和双锁后，先持久保存原字节副本/hash/恢复清单，才解除旧活动状态。旧库、卷、密码、JWT key、日志和 lease 快照保留。三个旧回归改为精确验证两份现有迁移初始化的四行权限目录，其它业务表仍须为空，原认证/越权/审计断言不删。

AF-133 修复管理员客户目录仅在两种认证都开启时装配。客户开关关闭时，无需客户密钥；管理员登录/me 保持 200，客户及目录入口 404。没有虚假密钥、Guard 放宽、Schema/迁移/Seed 或权限修改。

原 AF-043 Web 与本聊天 AI 校验实例已分别按确切归属 SIGTERM 停止，不按端口杀进程；AF-043 实时 CWD 失效的定向恢复证据明确保留，未改原严格停止工具。PostgreSQL 55433 保留运行。只使用合成测试数据；未执行真实收费 AI、支付、生产、部署或发布。

## 运行维护和后续

新库 `aij_foundation_af029_test_e2db669860548aec`，Web PID 3716 / API PID 3680。实际 birth/CWD/command、URL 和 health/ready 证据见 `.artifacts/orca-b02/AF-132/owner-release-runtime.json`；后续以实时核验为准，不凭旧 PID 停进程。

精确停止：`node scripts/verification/ui1-manual.mjs stop --task AF-029`。恢复：同脚本 `prepare --task AF-029`，保持当前账号/密码。若将来 Schema 再变化，先完成归属核验及旧服务停止，再显式 archive 对应 lease，不修改快照或重置旧库。

卡片预算 AF-132 3h、AF-133 2h；本轮有效工程耗时粗估约 1.2h / 0.5h，均未超限，等待时间不计。AF-130/131 与双项目 RC、可分发固定制品仍未交付；下一批建议先完成负责人 UI-1 决定，再以 AF-130 基础菜单/普通账号只读/审计闭环为首张就绪卡。
