# F3 迟到运营工具候选核对

2026-11-09，Run run_594d408d15de。补充Worker Task task_a1b73759c13b / Dispatch ctx_9f958fc8c0e5 的候选57965944824a85ae698a9f084dd75eaca4a5b1ad在F3已由PR24合入dev 42dc92b后送达。该候选在test独立回环实例完成18次HTTP、原Web单9次HTTP、6项检查，未修改dev或已交付服务；原工作树/分支保留。

本项目开发环境已由总控96b3a65的provision-dev-ops.mjs与verify-dev-ops.mjs完成实际初始化、同库同订单HTTP及重启验收，秘密配置与账号已在owner development目录生效，证据见MBTI-WEB-API-F3-DELIVERY.md。5796594的另一套启动开关/ops-auth文件入口未cherry-pick，避免交付两套并行初始化命令或改变运行中的JWT/账号；其代码作为未采纳候选保留，不声明dev执行过该候选。

静态复核后，总控将有用的三项保护合入当前已验入口：核对0600秘密文件UID、使用Foundation原管理员写事务锁、校验mbti:orders:read的module/action/resource/path元数据。实际开发环境重复执行provision退出0（保留原身份/JWT/口令/权限），定向ESLint退出0，未重启或替换服务。后续F4集成一并保留这些保护；恢复仍按F3交付记录的单一入口。

F4运行候选0.4.0-f4-candidate.1已核验恰12个操作，状态candidate/needs_human_review，并将实际路径和字段中转Web。F4未在本记录中宣称HTTP验收通过。
