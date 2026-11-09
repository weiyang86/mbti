# HTML 接口联调文档

打开 [index.html](index.html) 即可查看，不依赖 CDN、外部字体或浏览器取数。单独复制这一个 HTML 文件也可以离线使用。GitHub 的 HTML 源码页不会直接渲染，可下载后打开，或使用开发环境发布地址。

- 开发环境预览：**http://192.168.0.200:5173/api-docs/**（局域网，跨设备可达性待验证）。
- API 基址：`http://192.168.0.200:4056/api/v1`；H5 首页：`http://192.168.0.200:5173/#/`。
- [openapi.json](openapi.json)：汇总的 OpenAPI 3.1.1 内部候选，可导入 Apifox/Postman；HTML 也能直接下载此数据。
- 覆盖 F1–F6 共41个操作：40项可联调，#46只有明确不可用分支，真实位置人数仍 blocked_external。

支持模块/方法/状态筛选、路径和字段搜索、完整请求/响应字段、状态码切换、cURL/JavaScript示例、深链接和复制。API基址只在当前页内存中改变示例，不保存凭证，不发起API请求；敏感写操作需要使用者自行执行。占位ID和合成渠道值须替换为自己游客下的数据。

## 来源与再生成

构建脚本读取以下现有候选，不改动原文件，也不把候选字段发布为正式契约：

1. `docs/integration/fastlane/MBTI-WebAPI-13.openapi.yaml`（F1/F2）。
2. `docs/integration/MBTI-F3-candidate.openapi.yaml`。
3. `docs/integration/MBTI-F4-runtime-candidate.openapi.yaml`。
4. `docs/integration/MBTI-F5-runtime-candidate.openapi.yaml`。
5. `docs/integration/MBTI-F6-runtime-candidate.openapi.yaml`。

Schema/Response/Parameter/SecurityScheme按来源加前缀，避免同名覆盖；保留操作、参数和响应，将3.0 nullable/排他边界表达转换为3.1形式。每个操作记录原始候选路径，汇总记录文件SHA256。没有为未定义响应补造正式字段。

使用本项目 Node24，在此目录执行：

```sh
npm ci
npm run build
npm test
npm run check
```

只生成 `index.html` 与 `openapi.json`。`--check` 会在产物与源文件不一致时失败。HTML模板/样式/浏览器脚本分别在 `page.html`、`page.css`、`page.js`；操作的中文标签、原需求序号和来源清单在 `reference.mjs`。新增或删减接口必须更新映射和验收，构建不会静默漏掉操作。

服务实测基线仍为 `81279efd6f4c085060b7ab237236c16ec5a700ba`，属于当前F1–F6交付，不代表生成HTML时重新执行了全部业务验收；见 [完整交接说明](../execution/MBTI-WEB-API-FAST-HANDOFF.md)。若业务代码/契约更新，应重新核对服务基线、文档摘要与可用状态再生成。

## 静态发布

可从仓根临时查看：

```sh
python3 -m http.server 5184 --bind 127.0.0.1 --directory docs/api-reference
```

当前5173由既有H5静态服务提供，已将验收后的HTML和JSON发布到其公共根目录的 `api-docs/`，上方地址已从开发主机经LAN地址检查为200。更新时仅替换这两个生成文件，不要发布构建工具的 `node_modules`、凭证或私有运行目录。此次仅增加静态文档，无需重启API或变更数据库。

构建依据：[YAML官方解析API](https://eemeli.org/yaml/)、[OpenAPI3.1.1规范](https://spec.openapis.org/oas/v3.1.1.html)。页面始终保留 `candidate / needs_human_review`：真实支付配置、位置来源/授权/距离/小样本口径以及正式业务规则仍待补齐。
