# ORCA-B02 当前集中验收：Base 账号、只读与审计闭环

更新2026-11-05。AF-134/135/130三卡已完成代码验证，批次出口 **OWNER_CHECK_PENDING**；自动验证、本地提交和浏览器自动操作不代替负责人接收。AF-130承接原候选且Writer已明确停写，真实Run/Task未重复创建。

当前入口 <http://127.0.0.1:3855/login>，管理员aij-admin，密码只在 `.local-data/base-development/initial-admin.json`；正式复用只读账号username/password在 `.local-data/base-development/af130-reader.json`。本机启动/停止及一页点击步骤见[Base说明](../development/BASE_DEVELOPMENT.md)。本次保持服务运行，不将下方旧13655地址作为当前入口。

| 卡片 | 当前结果 | 正式证据 |
| --- | --- | --- |
| AF-134 持续Base初始化/启动 | CODE_VERIFIED，本地e544768，负责人PENDING | 123项检查、四入口、幂等与重启，见AF-134执行记录 |
| AF-135 字典read/manage分离 | CODE_VERIFIED，本地580cba1，负责人PENDING | 138项检查、有效会话六类403/数据不变/撤权，见AF-135执行记录 |
| AF-130 普通账号只读角色与审计 | CODE_VERIFIED，包含本Review的原标题本地提交，负责人PENDING | `.artifacts/verification/AF-130/AF-130-final.json`，12纯+1真实HTTP、lint/typecheck/diff；隔离API/Next构建及实际浏览器闭环 |
| AF-131 仓库外消费 | 未启动，必要前置仍待负责人接收 | AF-127配置契约与AF-077..080必要分发子范围仍PENDING，未给外部项目地址 |

负责人可按顺序检查：管理员新建普通账号→仅授字典read角色→普通账号登录默认工作台→字典分类及条目可查、写按钮禁用→刷新退出重登→管理员以目标用户/角色资源ID查建号和授权安全详情。真实服务端合法CSRF拒写证据、资源ID、失败保留与提交回执见[AF-130执行记录](../execution/AF-130.md)。正式脚本重复prepare保留凭据/账号/角色/菜单/字典，无改密、重置或接管。

本卡产品差异仅通用工作台移除bootstrap页面门槛；原AdminShell会话及资源权限继续生效。新增严格目标与私有记录绑定的API准备/验证脚本、正式注册和文档。无Schema/migration、依赖、API或Guard更改；只在专属Base55434写合成身份、角色、字典、会话与现有审计。AF-029历史/构建/凭据和负责人手册2553文件摘要保持；ownerAcceptanceRecords不改。初次Docker未启动及证据目录路径拒绝均保留，修正后正式复验；未关闭未知进程或使用SQL补数据。

本卡提交后才完成原集成 `task_f351efee8cb6`；SHA回读见 `.artifacts/orca-b02/AF-130/local-closeout.json`。不push、不启AF-131、不跨三卡批次；本次“继续”用于接续未完成集成，不推定已接收AF-127/077..080或ORCA-B01。完整1.0、仓库外A/B、业务插件和备份恢复仍未完成。

---

## 以下为2026-11-04 AF-129出口历史（不代表当前状态）

### 当时：菜单归因完成，停止于base闭环前置

2026-11-04。授权首批最多3卡，预计8h；本次实施AF129约0.85有效工程小时，因必要前置未接收而停止，没有继续AF130/131。代码验收/本地提交不等于负责人接收。附件《AIJ Foundation：产品目标与 Orca 开发任务书》尚未取得可读正文；本次只依据负责人消息中明确范围，不冒称读过附件。

## 结果与人工入口

截图对应当前13655/3656合成AI场景，管理员不是因为缺少基础管理权限才只见两菜单：数据库只有AI中心、AI用量两条sys_menu，21个有效权限定义及超级管理员有效权限足够。后端/admin/menus/my与完整菜单列表、SQL三者一致；Seed管理能力开关登记permission，不会补基础菜单，aiCenter分支只插两AI菜单。aij-ai已enabled；没有发现已有基础菜单被过滤，因为根本没有相应行。没有给原账号加权或补菜单，前后授权/菜单/插件指纹相同。

负责人可以继续用现有AI合成管理员在http://127.0.0.1:13655/login登录，进入/admin，看到两项AI菜单并核对本次证据。该地址不是独立base；原3655旧进程的构建SHA无法证明，保持unknown且未停止。基础版逻辑入口应为/login→/admin→/auth/admin-users、/auth/roles、/auth/audit-logs；当前路由存在，不代表base开箱初始化完成，尚未交付新的base账号/只读角色/独立项目地址。

## 卡片与验证

| 卡片 | 实际状态 | 证据/停止点 |
| --- | --- | --- |
| AF129 核验 AI 菜单来源并给出基础版入口 | CODE_VERIFIED，按原标题一次本地提交；负责人待验 | 正式报告`.artifacts/verification/AF-129/run-ZzDLZV/report.json`，前置2/2、步骤4/4、7/7测试、16真实HTTP观察、lint/diff通过 |
| AF130 base普通账号只读角色与审计 | BLOCKED，未派发、未实现、未提交 | 必要UI-1/AF026..029登录/会话链仍OWNER_CHECK_PENDING；不能按旧叠加许可越过本轮停止规则 |
| AF131 仓库外base消费核验 | BLOCKED，未派发、未实现、未提交 | 上游AF130未完成；AF127等必要生成/消费子范围也未接收；未尝试新外部项目，不把配置生成计作产品可用 |

实际diff：新增menu-origin采集/测试、候选和正式执行记录、正式registry，以及本轮初始三卡计划/Task图/队列记录。后两卡仅规划与阻塞说明，无其产品实现；无继承或其他Writer差异。总控已逐文件自查。无Schema、迁移、产品API/页面/权限变更，无依赖升级，没有运行或伪报全量build/typecheck。SQL只读现有受保护AF124验收库；采集会正常login/logout并写会话/审计，未假称整个过程零写入。失败cwd诊断留在候选记录，修复在本卡脚本内，没有修改运行环境兜底。

Run `run_d4eae5ba3a3b`，AF129开发 `task_6b3272e480a9` → 本地集成 `task_02198480a518`。AF130开发 `task_766e5e9f3411` 真实依赖该集成节点；AF131开发 `task_7af28bc2eb2f` 依赖AF130集成 `task_f351efee8cb6`；本地提交完成并检查后才完成I-AF129，后续节点保持blocked。本轮使用当前工作区单Codex Writer，无TRAE、无并行写入。实际ID/范围见[运行映射](../planning/orca-product-goal-20261104/runtime.json)。本地提交完整SHA见`.artifacts/orca-b02/AF-129/local-closeout.json`及Git日志，未push。

## 必要前置与下一步

正式队列的G1说明UI-1/AF026–029已校验但待接收，G2/G3只接受UI-2管理页而明确UI-1登录链仍待验；batches.UI-1为OWNER_CHECK_PENDING，runHistory对应manualAcceptance=PENDING。AF130要求负责人亲手管理员登录、普通账号重登，直接依赖该链。按照本轮“遇到未接收的必要前置或持续失败就停在该卡”，没有把历史CODE_VERIFIED或UI-2已接收扩展为UI-1也被接收。既有ownerAcceptanceRecords与ORCA-B01待验状态逐字保留。

AF130尚需实施真实只读授权：现AdminUsersController类级admin.user.manage覆盖GET与写路由，单给该权限会赋写能力，不能作为只读方案。后续在既有owner内拆read/manage、补基础初始化菜单，并实际完成管理员创建普通后台账号→授只读角色→普通账号读成功/写API403→管理员查审计，普通账号isSuperAdmin=false。当前未交付这条流程，不能给不存在的角色或地址让负责人验收。

AF131继承OPT005/006/009/011/015与GEN02/03、CI02，不另起重复方案；配置生成器现只生成四个配置/说明文件，独立Seed仍受host身份限制。只有真实仓库外干净目录、独立依赖与测试库、同一只读审计流程成功才称项目可用。独立消费者和版本/数据保护前置满足后，再以易修外部业务插件做安装→接待报修→派单→升级后旧工单可用；随后短信/手机号登录、支付闭环、AI Skill运行/导出各阶段另卡，真实收费/资金/生产/公开分发仍未执行。

本次没有真实收费AI、支付、生产、部署、发布、main/tag/PR或远端写入；轻企保持独立只读，未搬业务。等待附件可读内容及必要前置接收结论后，重新判断AF130可执行性；当前停止续跑，供负责人集中验收。
