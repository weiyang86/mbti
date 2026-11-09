# mbti（MBTI 搭子）

前后端分离的 MBTI 测试小程序/应用工程目录。

| 目录 | 用途 |
|------|------|
| `UIhtml/` | 产品/原型 HTML（设计与 SOP 稿，不进业务编译） |
| `web/` | 前端工程（UniApp / 小程序端） |
| `admin/` | 业务后台工程 |
| `aij-foundation/` | 总后台能力输出（本仓内的 foundation 层；与独立仓 `weiyang86/aij-foundation` 区分） |

总后台源码已导入，安装、配置及业务接入边界见 [Foundation 说明](aij-foundation/README.md)。该目录使用独立 pnpm 工作区；业务 API 草案仍待 Remy 定稿，源码导入不代表 MBTI 接口已实现。

## 分支

- `main`：生产 / 部署分支
- `dev`：开发分支（日常提交默认走这里）

## 带教约定（摘要）

- 接口契约 / API 文档 Owner：导师（Remy），可 AI 辅助起草后定稿
- 实习生只消费契约并按文档联调；最多写联调笔记，不负责权威接口文档或业务字段设计
- 详见根目录 `AGENTS.md`

## 当前产品稿

- `UIhtml/mbti-buddy-prototype.html` — 交互原型
- `UIhtml/mbti-buddy-product-sop-v0.4.html` — 产品 SOP V0.4
