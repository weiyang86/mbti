# W15 · 凭据留空的外部配置与混合模型开发

负责人当前明确批准继续完整剩余实现；本波最多4卡、10.25有效工程小时含root（另有原W14 AF191剩余额度独立记录，不把其失败反填通过）。

AF192 登记混合模型与凭据留空开发批次 .75h；AF193 提供外部服务配置草稿与就绪检查 4h/Sol high；AF194 提供外部服务配置管理表单 4h/Terra high；AF195 交付外部服务待配置接入与验收说明 1.5h/Luna medium。每卡实际Task/I与范围见program，最多主控+3Worker，DB/重构建/GUI各1。

共享起点origin/dev@94b0236f775fa40a07944c5e0545ac6ce0e123f3，经独立源码bootstrap精确取得最新验证HEAD 3286461a196198bb89ed3044bba2d67b982d4727（manifest 27b84d44bc097923e26427363e9c59aa22ea7e6fa88464cc5cdf1e1be373e9f6，824文件；不复制migration/env/data/dependencies）。主控只接bootstrap之后候选差异。当前未授权push，继续按登记的精确bootstrap，不悄悄同步远端。

共同产品契约见W15/CONTRACT.md。全部账号/真实密钥默认留空、可保存草稿、不会自动启用。原SecretRef/ScopedConfig/RBAC/审计owner复用；root独占模块/SDK/page注册与真实受保护PG/API/生产UI验收。外部vendor/payment/notification实测暂缓，不能写成通过。完整40冻结要求与历史负责人接收不变。

AF191不是本批代码依赖，仍保持READY_FOR_ROOT_INTEGRATION，唯一POST/同Run/严格原生14及清理不得降级。W15用户明确允许独立工作继续，解除以AF191未结束阻止所有无依赖开发的调度约束；不解除其本卡门禁或预算。

本地卡片原名提交只在正式verify通过、队列与记录更新后进行；主控最终Review，OWNER_CHECK_PENDING。无远端Issue/PR/main/部署/发布。
