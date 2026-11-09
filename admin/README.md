# MBTI 运营工作台

Vue 3 + Vite + TypeScript 的独立业务运营入口。开发与静态构建以 `/ops/` 为 base；AIJ 平台管理页 `/admin`、平台登录 `/login` 和 H5 `/` 继续由各自宿主负责。

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
```

本地 UI 端口为 4255，API 同源代理默认指向 127.0.0.1:4256，可通过 `MBTI_ADMIN_API_ORIGIN` 指定本机代理目标。客户端只使用 Foundation Cookie 会话、CSRF 与 `/api`；不在浏览器保存身份、角色或访问令牌。开发前须由 B1 的测试环境脚本使用指定 owner 核对 test55437、同仓项目和 marker；当前派工现场缺少 owner，故四角色凭据和登录验收未生成。

未连接接口的 13 页保留原型顺序、导航、页面标题、筛选及空状态；订单详情使用已存在的 `GET /api/admin/mbti/orders/{id}` 与 `mbti:orders:read` 权限。后续业务卡从 B2 开始逐页接线。
