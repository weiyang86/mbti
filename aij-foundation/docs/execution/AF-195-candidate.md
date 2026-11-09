# AF-195 候选执行记录

- 范围：仅交付外部服务待配置接入与验收说明；候选，不代表完整目标通过。
- Bootstrap：从 `3286461a196198bb89ed3044bba2d67b982d4727` 按固定 manifest 恢复 824 个源码文件并逐项 SHA256 校验；manifest SHA256 为 `27b84d44bc097923e26427363e9c59aa22ea7e6fa88464cc5cdf1e1be373e9f6`。独立本地 bootstrap 提交：`5bd45fc1ea31a55fa9a63be2241b494241089a38`。
- 文档：`docs/development/EXTERNAL_SERVICES_CONFIGURATION.md`、`docs/planning/auto-ai-program-20261105/W15/EXTERNAL_SERVICES_ACCEPTANCE.json`、本记录。
- 检查：manifest 与源文件摘要校验通过；检查 JSON 可解析；检查候选差异仅限三个 allowPaths。未安装依赖，未构建、未连接数据库。
- 状态：文档候选已写；API/UI/本地PG/浏览器/供应商调用和凭据验收均 `NOT_RUN`。Vendor acceptance `DEFERRED_NOT_PASSED`，CODE_VERIFIED 待总控基于集成代码核对，OWNER_CHECK_PENDING。
- 依赖：I-193、I-194 集成及总控对实际实现的核对。不存在真实渠道或完整目标验收声明。
- 工时：本工作区约 0.3 小时，低于 0.75 小时上限。
