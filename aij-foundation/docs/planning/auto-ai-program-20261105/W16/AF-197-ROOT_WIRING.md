# AF-197 root 接线请求（候选，非 CODE_VERIFIED）

固定共同契约为 W16/CONTRACT.md 与 RENDERER_DEPENDENCY_PLAN.json；未改全局依赖、schema、module、registry、队列或正式状态。没有 Controller、附件、权限入口、DB、AI 调用或页面变更。

## root 独占依赖与资产

- apps/api 的实际 runtime dependencies：`docx: 9.15.2`、`pdfkit: 0.20.2`；dev dependency `@types/pdfkit: 0.17.7`。root 更新 manifest/pnpm lock，核验计划内 tarball integrity，不由 Worker 暂存。
- 固定 font 放在 `assets/document-fonts/NotoSansCJKsc-Regular.otf`，SHA256 `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`，大小 16437364。
- 同目录 `LICENSE`，SHA256 `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2`；source commit `f8d157532fbfaeda587e826d4cd5b21a49186f7c` 的 notofonts/noto-cjk Sans/OTF/SimplifiedChinese 与 Sans/LICENSE。来源/许可证登记归 root。
- Worker 仅在 `/tmp/aij-af197-private` 私有测试依赖目录下载真实精确包及字体，未加入候选、未复制到 root。

## 编译与 bundle

API 正式编译后须存在 `apps/api/dist/documents/document-renderer.js`、`document-renderer-cli.js`。库导出 renderPlainDocument 及共同契约 types；只收三个字段的纯文本快照。字体通过固定大小、有界读取、哈希和 fontkit 字形覆盖校验；PDF 使用嵌入字体、A4/1英寸边距、18pt标题/11pt正文、实际分页最多100页，流输出最多5MiB。DOCX 为真实 OOXML ZIP、EastAsia=Noto Sans CJK SC，pageCount=null；不承诺阅读器一致分页。空行保留，CRLF/CR/LF 标准化段落，Word 使用真 TAB，PDF 使用四列 TAB 展开；不截断不支持字形。

`buildRuntimeBundle({destination, repositoryRoot})` 从上述编译路径及固定 assets 生成 fresh 的绝对目标目录（父目录必须 canonical，macOS `/tmp` 应先 realpath 为 `/private/tmp`）。目标内有两个入口 JS、严格依赖闭包的 node_modules、assets/document-fonts、私有 CommonJS package.json、dependency-inventory.json 和专有标记。只遍历已解析真实传递依赖，不执行安装/网络/子进程，不复制整个 node_modules；所有包真实路径须在 repositoryRoot 内，包内符号链接/.env 被拒绝，循环/超512包/超20000文件/超256MiB 被拒绝。包 metadata 声明的 @types/node 等传递项也保留，测试依赖不进入 bundle。

`removeRuntimeBundle(directory)` 仅凭本模块实例的私有 ownership registry 授权：builder 实际 mkdir 后登记目录路径、随机 nonce 和设备号/inode，完成构建才允许公开清理；清理还须校验 canonical 路径、同一目录身份以及匹配 schema/version/path/nonce 的标记，并在删除前一次性消费能力。磁盘标记不能创建或恢复清理权限，人工伪造标记、复制合法 nonce 到替代目录均拒删；另一进程/模块实例或重启后只有磁盘标记也拒删。失败构建只使用本次私有能力清理实际创建的同一目录（允许尚未写完 marker），不会取得其他目录的清理权限；删除实际失败时能力不再复用，须由 root 单独调查残留。root 需在同进程同模块实例 build/remove，并使用受控 fresh 目录和独占构建，禁止指向现有交付目录。

将 bundle 内容 COPY 到镜像 `/aij/` 后，执行 `node /aij/document-renderer-cli.js`。stdin 单个 `{input:{format,name,body}}` UTF8 JSON <=80KiB；固定读取 `/aij/assets/document-fonts/NotoSansCJKsc-Regular.otf`，无 flags/env 路径覆盖。stdout 成功一行 schemaVersion1 元数据及 base64（另计数，JSON<=8MiB），失败 stdout 空、stderr 只有固定码、exit1，无正文/路径/堆栈。调用方验证与隔离由 AF199 owner 实现。

## root 真实门禁与人工步骤

Worker 验证脚本需要 TypeScript5.9.3、独立 PDF.js parser（本次私有测试6.5.438）与 Python3 stdlib ZIP/XML；这不是新增 runtime 依赖要求。可设 `AF197_TEST_DEPENDENCY_ROOT` 指向 root 自行准备的私有测试包目录，`AF197_TEST_FONT_PATH` 与 `AF197_TEST_FONT_LICENSE_PATH` 指向已校验资产，执行 `node --test scripts/verification/document-renderer.test.mjs`。脚本用自己的临时目录编译窄入口、构造隔离依赖闭包并在 finally 删除；不启动 App/DB/Docker。root 仍须正式 API 编译和注册 `verify:task AF-197`。

root 负责固定 Linux Node digest 镜像、真实 stdin CLI 成功/base64/大小/元数据一致性、缺字/坏 font/坏 hash/超输入拒绝，以及 AF199 有界执行器的超时/OOM/取消/最终无容器资源。Worker 没有运行这些路径，不应把候选视为正式验证。输入边界使普通有效样本远低于5MiB/100页，Worker 未以伪造库输出强制声称命中这两个保护分支。

root 逐页打开含中文/空行/TAB/XML符号/长无空格中文/多页末尾文本的 Word/PDF，检查字形、裁切和分页；DOCX 使用外部阅读器字体时须如实记录差异。没有服务启动或访问地址。AF199 真实集成必须依赖 I197 的实际 Task ID 与 CODE_VERIFIED，候选 Task ID 不可替代；外部厂商 DEFERRED_NOT_PASSED，原40目标 NOT_RUN_TARGET_ACCEPTANCE。
