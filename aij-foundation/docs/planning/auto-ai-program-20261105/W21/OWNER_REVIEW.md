# W21 批次交付与负责人检查

CODE_VERIFIED / OWNER_CHECK_PENDING。4个批准范围卡完成代码验证：AF216治理、AF217个人单Agent发布/手动执行页、AF218个人Agent历史恢复、续验原AF203文档导出。总控采用两个独立Orca新Worktree并行候选+一名只读支持，候选显式STOP后在原dev串行集成，DB/build/Linux/native各1；没有等待Trea、自查没有冒充独立复核或负责人验收。

| 范围 | 最终证据 | 本地提交/真实集成Task |
| --- | --- | --- |
| AF216 登记流程运行与版本恢复开发批次 | run-HeYcSI PASS1+3，仅治理 | 47b75817e41c7b1ecfe69a3738e487461fd1839d；I216 task_b701da0766e1 |
| AF203 提供个人文档Word与PDF导出面板 | run-KctH6T PASS2+12；42单元、11原生、实际3份OS Word/PDF文件字节/hash、跨端口实包SDK、hidden/未知新鲜ACK/撤权；原导出11TAP | bfbfa65ea42deec8d8f949113a2604d814e14e55；I203 task_f03f6130ad1e |
| AF218 提供个人Agent历史配置恢复为新版本 | run-XYusqO PASS2+12；89单元、9真实10TAP/8原生/原Agent PG12；一新版本禁用未发布、旧Run/历史保留，当前拒绝清原父详情 | 初次0e7f3b1c2131bb52370123edc836d1ce9e7e6350，补验4dc8defdb74e724174e208547e64f9b97fd1a3a3；I218 task_ef8d52c0b666 |
| AF217 提供个人工作流发布与手动执行页面 | .artifacts/verification/AF-217/run-mSeOTq/report.json PASS2+12；152单元、62保护、9真实10TAP/8原生/原七方法13TAP | 包含本文件的原名提交；I217 task_adc56a2ff07b在本地提交与回读后完成 |


AF217真实证据.artifacts/auto-ai-program-20261105/W21/AF-217-actual-100a2c9c-e365-47d5-b1c7-fca57a782094：publication丢响应一POST+读/独立ACK、Run丢响应一POST+原键GET+同Run/Job/预算、真实失败released与成功settled的明确结束、配置关闭/独立读取/真实publication503、当前权限/新会话/头变化/迟到响应/复杂图保留。原生键盘取消、父编辑null、真正hidden/恢复、390、当前撤权清父页、卸载均通过。原草稿页与新增sessionGeneration契约兼容问题已修复；旧来源因发布纪元变化409时保持原锁，完整复杂编排仍待开发。AF218初次交付后补充父页面隐私自查，实际I218重开、完整补验与单独同名修正提交，初次报告/提交和失败记录都保留。

时间为人工保守有效工程估计，不是模型账单：治理0.75h + 本批AF203新增1h（含只读支持0.15）+ AF218累计2.5h + AF217累计3h =7.25h<=批准8.75h。AF203前期3h保守carry保留，当前总4h封顶，本批只计新增1h。所有root集成、真实门禁、修复、记录及本地提交计入卡内，没有另起计时；批次4卡，未自动启动下批。

实际Task/Dispatch和来源：I216 task_b701da0766e1；AF217 candidate task_f13743945dc6/ctx_60a0c733cd63/bootstrap2a8c159/candidatef948d5e/STOP msg_61be9308c255；AF218 candidate task_583f9c45edcd/ctx_e1859ca68a1d/bootstrap79a7099/candidate6497a87/STOP msg_b43859f88fa4；AF203只读支持task_7b2182d35e86/ctx_10249de067d4/STOP msg_03ec9c2eba57。两新Worktree从当时已验证origin/dev94b0236创建，再复制f0e12d7冻结的1009源码blob；不复制凭据/共享node_modules。候选只交六个NEW路径，实际根目录24/6份最终修正源冻结及原始候选快照分别保留，候选完成没有替代真实I依赖。最终I217回执与Git路径/title/SHA回读见ignored W21交付证据。

Git/数据边界：当前dev仅作精确卡片本地提交，alternate index从HEAD构造自身slice，正常index归空；继承AF191、AF208和用户工作手册保持。只读回查远端dev仍94b0236f775fa40a07944c5e0545ac6ce0e123f3，无push/远端Issue/PR/main/tag/包发布/部署。只有独立55433新logical测试lease和合成数据，原PG服务未stop/reset/drop；临时API/Next/relay/provider/native tab关闭，池0/socket0/env恢复，外部实包consumer移除。原API/schema/SDK/认证/成员/Job/Run/Trace/费用owner保留，AF203实际下载只清本次校验过的自有文件；不提供仍运行的访问地址。真实厂商凭据空，DEFERRED_NOT_PASSED，负责人尚未接收。

整体进度口径：本批初始已验证f0e12d7的40目标等权粗略功能覆盖基线33.75%，见PROGRESS_BASELINE.json（三份只读审计合计1350/4000）。它不表示工程工时完成率，本批未重算；40个完整目标的验收状态仍NOT_RUN_TARGET_ACCEPTANCE，不能从卡片数量推导整体完工。当前3条新页面/导出链路已代码验证，整体剩余工作仍较多。

剩余工作与后续依赖：

- AF191原生14必须在独立有限预算窗口执行，真实适配底座I215已完成，不能由本批文档/脚本/工作流原生场景替代。
- 单Agent之后的多步骤/条件/并行/汇合/循环/审批执行、多Agent与触发器仍未交付；后续产品代码引用真实I217 task_adc56a2ff07b作为已验证前置。
- Agent/Skill多层级资产、工具和可执行Skill绑定、模型/通道完整矩阵、BYOK/付款方/切换/审批仍需独立任务。个人历史恢复不等于市场分发/授权能力。
- 文档章节、历史正文恢复、图表，全格式与版本化知识/语义RAG，组织/个人组织模型与OTP，云文件服务真实接入，以及通知/支付/市场/商业/升级备份恢复等目标仍需按owner细分。
- 全40目标的系统组合验收、真实厂商调用、负责人验收/发布均保持未完成；后续工时须先按统一边界去重拆卡，不能把各审计重叠估计直接相加。

人工检查先阅读docs/execution/AF-203.md、AF-218.md、AF-217.md的实际影响/命令/限制/步骤，再在独立环境启动原Web/API按各卡路径验证。无配置默认关闭、未知原请求不重放、当前权限拒绝清隐私为重点。按AGENTS批次完成后停止写入并暂停续跑，本批没有自动下批授权；负责人决定接收和下一有限批次。
