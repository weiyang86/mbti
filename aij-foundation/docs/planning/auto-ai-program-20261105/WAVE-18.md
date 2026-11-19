# W18 私有工作流发布与原账本执行

AF204 登记个人工作流发布与执行并行批次 .75h；AF205 实现个人工作流单Agent发布快照3.25h/Sol high；AF206 复用统一运行账本执行个人工作流4h/Astra high；AF207 提供个人工作流执行API与公共SDK3.75h/Sol high，含root11.75h。最多root+3，DB/build/Linux/GUI各1。

源码2ee9172a30be7694dc2cb097a43fbce1f0a14e65，origin/dev 94b0236f775fa40a07944c5e0545ac6ce0e123f3，885个只读源blob，manifest a1315d50f341bdf17ea202aa3626035523598ce6188004c61301a15386e39bc0。各新注册Orca WT从origin/dev起步，独立source-only bootstrap后只写分配路径、交回候选delta。原AF203/AF191待验及全部既有差异保留；本波从已CODE_VERIFIED I161/I170/I189取依赖，后台CODE验证不需GUI，不将203待验当完成。共享接线仍root串行，跨波合法共享变化需要原待验卡按真实新CODE依赖重新冻结/验证，不覆盖旧失败报告。

见[固定契约](W18/CONTRACT.md)。本波只发布并手动执行start→一个当前已发布私有Agent→end，无参数变换；旧复杂草稿保留并拒绝发布，Run/Job/Trace/费用仍原owner，新增不可变来源关系。I205→I206→I207实际集成顺序，候选按契约并行。LINEAR-MULTI、SCRIPT-PRIVATE、分支/审批和UI另卡，目标不删减。

原始权限/令牌/幂等/预占/unknown/lease及原流程版本能力必须回归，新鲜PG/真实原运行时与自有合成HTTP上游、实包SDK并发拒绝恢复证据在注册门禁中检验。真实厂商DEFERRED_NOT_PASSED，账号密钥空；full40/native14/owner未通过，不push/远端PR/main/deploy。
