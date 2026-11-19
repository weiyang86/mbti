# HTTPS 域名联调入口交付

2026-11-09。沿用项目既有 `mbti-dev.bestshizhongyu.com`，文档从IP入口改为域名。新工作树 `mbti-domain-access` 基于最新 `origin/dev` 的 `c34382ec7079a034885bfc26f925fda66a623453`。

## 实习生入口

| 用途 | HTTPS 地址 |
| --- | --- |
| H5 首页 | https://mbti-dev.bestshizhongyu.com/#/ |
| HTML 接口文档 | https://mbti-dev.bestshizhongyu.com/api-docs/ |
| OpenAPI 下载 | https://mbti-dev.bestshizhongyu.com/api-docs/openapi.json |
| 完整 API 基址 | https://mbti-dev.bestshizhongyu.com/api/v1 |
| 探活 / 数据库就绪 | `/api/v1/health` / `/api/ready` |

浏览器不需要与开发机在同一局域网。另一物理设备及微信端仍待实习生实际反馈。公网服务器与原本机LAN使用不同数据库、游客身份与结果；每个浏览器在域名下独立领取并刷新复用凭证，不能用本机旧ID/凭证验证公网记录。

## 修复和发布

域名原已部署本批API和H5，API源码基线81279ef；`/api-docs/`却被Vite的H5回退吞掉，返回首页HTML，`openapi.json`也错误返回HTML。另发现分享接口生成 `http://localhost:4056/...` 图片URL，其他设备无法使用。

1. 文档默认API基址、H5链接、OpenAPI服务器及当前README/交接/前端环境示例统一改为HTTPS域名，保留原始候选与历史LAN验收记录。
2. 在此域名的Nginx extension增加 [独立location配置](../api-reference/deploy/nginx-api-docs.conf)，用更长前缀直接提供静态文档。HTML/JSON先上传到 `/www/wwwroot/mbti-dev-szy/api-docs-releases/8babcf95570c`，校验摘要后链接为 `api-docs`，`nginx -t`通过再graceful reload。不存在的文档路径返回404，不回退成H5。
3. 公网API容器挂载的私有 `/app/.env` 增加 `MBTI_PUBLIC_ORIGIN=https://mbti-dev.bestshizhongyu.com`；事先建立0600私有备份并逐键确认其他配置未改。现有读取逻辑按请求读配置，公开图片URL立即使用域名，无需重启API。凭证、数据库、运营身份均未替换。

未改动公网Git工作目录既有的后台UI修改或迁移文件状态，未重启H5/API/数据库，未操作其他站点。只reload Nginx以加载本域名文档location；全局配置检查仅有已存在的其他站点MIME重复告警，语法通过。

HTML SHA256：`8babcf95570cd2040ab1e6c37f2f95b5c3025a54d20b2b98754e4846b5e39623`；OpenAPI SHA256：`53cc1cf32649980078160e03c2c9e4b5506835878bab06c72f0899ed7f820949`。公网下载与仓内产物逐字节相同，分别为text/html、application/json；未知文档路径404。

## 实测

`npm ci --ignore-scripts`、`npm run build`、`npm test`（8项）、`npm run check`均通过。域名HTML真实浏览器18项检查通过（41项/筛选/字段/状态/下载/基址/桌面/手机），控制台无错误；页面API基址为HTTPS域名，文档不发业务请求。桌面和手机截图已查看。

```sh
python3 docs/integration/fastlane/smoke.py --base https://mbti-dev.bestshizhongyu.com/api/v1 --phase F2
```

退出0，F2包含F1：题库 `qb-v0.4-prototype-1` 原12题及计分一致，A两结果 `c9cd582f-bc21-4051-bcb5-d867b42503c3` / `1b72aba9-be71-43d9-ae86-0b1f6cb92701`，B列表空、跨用户404，并发交卷201/409；比较、自选、不可比422、分享图片读取和删除204通过。初次尝试出现过一次URLError；随后发现并修复localhost图片地址，再次完整运行通过，未改smoke口径或加自动重放写请求。

从域名H5真实首页点击测一测，全选第一项完成12次保存及交卷201，结果 `8a6d1f2d-5f5b-49bb-90db-f14869faff28` 为ESTJ，真实四维及题库展示正确。点击晒图预览后，域名图片GET200、浏览器图片已加载。所有业务Network请求均为本HTTPS域名，无IP或localhost业务请求。刷新复用同一游客并仍可加载记录和图片。

另用新建合成游客从域名读取商品、订单、权益、本人名片、搭子、名片交换、本人联系方式、联系方式申请及雷达参与，共9项均200，新游客的私有列表为空；未出现数据库表缺失错误。此次域名专项复测不替代此前F3–F6完整业务验收；40项可联调和#46统计不可用的候选边界保持不变，真实支付仍未配置。
