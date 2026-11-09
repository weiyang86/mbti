# web — MBTI搭子 UniApp 前端

Vue 3 + Vite + uni-app 骨架，覆盖带教闭环：**测 → 结果 → 晒预览 → 阶段记录**。

## 前置

- Node.js 24（本轮使用 v24.21.0），使用本目录锁文件安装依赖
- 可选：[HBuilderX](https://www.dcloud.io/hbuilderx.html) 导入本目录运行

API 契约见仓库 [`../docs/api/`](../docs/api/)（**draft / pending Remy 定稿**）。Agent 规则见 [`AGENTS.md`](./AGENTS.md)。

## 开发 / 联调环境（腾讯云公司机）

> `verification_status`: 「已核实」项经公司云运维 2026-11-04 SSH 复核（含 Node 安装与仓库 clone）；**pending** 项随进度更新 README，合入以 Remy 确认为准。

### 已核实（source: 公司云运维 2026-11-04 SSH 复核；合入以 Remy 确认为准）

- 台账名：腾讯云公司机 / 主机名 `VM-0-3-centos`
- 公网 IP：`101.43.150.46`
- Tailscale：`100.77.82.14`（优先 SSH：`ssh root@100.77.82.14`；公网备选同 IP 端口 22）
- 宝塔面板：端口 `20432`（勿写账号密码）
- 与 Codex/Orca 常驻开发机：**同一台**
- 已有：Docker 26.x、Nginx（宝塔）、Git；出网可经本机代理 `http://127.0.0.1:7890` 访问 GitHub
- 系统 Node/npm：`node -v` → `v22.23.4`；`npm -v` → `10.9.9`；`which` → `/usr/local/bin/node`、`/usr/local/bin/npm`
- Node 安装方式：官方 Node 22 LTS linux-x64 解压至 `/usr/local`；PATH 已含 `/usr/local/bin`，无需额外永久环境变量
- 仓库（Remy / 运维确认）：路径 `/www/wwwroot/mbti`；远端 `https://github.com/weiyang86/mbti.git`；分支 `dev`；当时短 SHA `efce033`（对齐 `origin/dev`，**以机上 `git rev-parse HEAD` 为准，会随 pull 前进**）；属主 `www:www`，权限 `755`

### pending / unknown

- MBTI 专用域名/证书：未配

### 推荐测法

- UI/mock：开发者本机 `npm run dev:h5` + mock
- 真联调/常驻预览：以本轮 [F1 联调说明](./F1-INTEGRATION.md) 的实际地址与启动命令为准；上述云主机信息不作为本轮通过证据
- 生产：`main`（勿在联调机当生产）

## 安装与运行（CLI / Trae）

```bash
cd web
cp .env.example .env.development.local
npm ci
npm run dev:h5 -- --host 0.0.0.0 --port 5173 --strictPort
```

浏览器访问终端输出的 H5 地址。环境示例使用 `VITE_USE_MOCK=false` 连接本轮开发 API；离线 UI 演示需显式设置 `VITE_USE_MOCK=true`。Mock 运行不代表真实 API 通过。

## 环境变量

| 变量 | 说明 |
|------|------|
| `VITE_API_BASE_URL` | 后端根路径，含 `/api/v1` |
| `VITE_USE_MOCK` | `true` 时使用 `src/api/mock` |

非 Mock 请求会自动执行 `POST /auth/guest` 并在浏览器本机保存凭证；同一运行实例的并发初始化共享一次请求，刷新复用原身份。所有普通请求携带 `X-Guest-Token`，不再读取共享构建 token。过期或 401 会明确提示会话失效，并保留失效标记，不自动换号或重放写入。只有首页的「重新建立游客会话」经明确确认后才创建新身份，新身份无法访问原身份的历史结果。

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
npm run type-check
npm run test:api
npm run dev:mp-weixin   # 微信小程序 dev（需微信开发者工具）
```

## 刻意未实现

- 微信登录、支付、雷达、真实分享图渲染服务
