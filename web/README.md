# web — MBTI搭子 UniApp 前端

Vue 3 + Vite + uni-app 骨架，覆盖带教闭环：**测 → 结果 → 晒预览 → 阶段记录**。

## 前置

- Node.js 18+（推荐 LTS）
- 可选：[HBuilderX](https://www.dcloud.io/hbuilderx.html) 导入本目录运行

API 契约见仓库 [`../docs/api/`](../docs/api/)（**draft / pending Remy 定稿**）。Agent 规则见 [`AGENTS.md`](./AGENTS.md)。

## 安装与运行（CLI / Trae）

```bash
cd web
cp .env.example .env.development   # 已提交默认 mock；可按需改
npm install
npm run dev:h5
```

浏览器访问终端输出的本地 H5 地址。默认 `VITE_USE_MOCK=true`，无需后端即可走通页面流。

## 环境变量

| 变量 | 说明 |
|------|------|
| `VITE_API_BASE_URL` | 后端根路径，含 `/api/v1` |
| `VITE_USE_MOCK` | `true` 时使用 `src/api/mock` |
| `VITE_GUEST_TOKEN` | 非 mock 联调可选 stub 头 |

## 页面

| 路径 | 说明 |
|------|------|
| `pages/index/index` | 首页：测一测 / 自选类型 |
| `pages/quiz/quiz` | 12 题答题 |
| `pages/self-select/self-select` | 16 型自选 |
| `pages/result/result` | 结果 |
| `pages/share-preview/share-preview` | 晒图预览占位 |
| `pages/history/list` | 阶段记录列表 |
| `pages/history/detail` | 记录详情与对比 |

## 构建

```bash
npm run build:h5
npm run dev:mp-weixin   # 微信小程序 dev（需微信开发者工具）
```

## 刻意未实现

- 微信登录、支付、雷达、真实分享图渲染服务
