# 真商户 / 真模型边界（保持禁用）

2026-11-10。对应看板 #14 / #15。本轮**不**接通生产商户或远程模型。

## 支付商户（#14）

| 边界 | 现状 |
|---|---|
| payments 配置 | `enabled: false` + `UNCONFIGURED`；admin 不展示商户号/回调密钥 |
| B5 本机演练 | ≠ 真实验签；不得把演练凭据写入 SecretRef 生产族 |
| 受控测试支付 | 仅隔离 test runtime + 本地随机 secret；禁止冒充真商户 |
| 解禁条件 | Pay owner 提供获批商户/证书/沙箱 SecretRef 后另开卡 |

## AI 模型（#15）

| 边界 | 现状 |
|---|---|
| B4 图像工作室 | 本机 offline kit；无 live mode |
| aiRuntime | 无真实 health/generate；credentialRef 仅元数据 |
| 生成任务队列 | 可入队/重试状态机；**不**调用远程模型，失败类需人工/后续 worker |
| 解禁条件 | Model owner 定供应方、费用、上传所有权后再开 health/generate |

## 与本轮交付的关系

生成任务 / 匿名工单 / 净实收条件可得 / 渠道事件表 / 成熟队列 / H5 published 解闸 **均不依赖**真商户或真模型。
