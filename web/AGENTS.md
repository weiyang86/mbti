# web/ — Agent 与实习生说明

## 先读

1. 仓库根目录 [`../AGENTS.md`](../AGENTS.md) — 分支、角色边界、带教范围  
2. [`../docs/api/`](../docs/api/) — **API 契约（Remy 定稿前均为 draft）**

## 你可以做的

- 在本目录实现 UniApp 页面与联调客户端  
- 在 `src/api/` 中**仅调用** OpenAPI 草案已定义的路径  
- 使用 `VITE_USE_MOCK=true` 本地 mock，不阻塞 UI 演示  

## 你不可以做的

- **不要**修改 `docs/api/` 下的权威契约字段（草案也需 Remy 定稿后才算发布）  
- **不要**实现真实微信支付、微信登录（文档 TODO）  
- **不要**在分享图/预览中绘制用户原始答题选项  

契约疑问 → Issue 或联调笔记，交给 Remy。
