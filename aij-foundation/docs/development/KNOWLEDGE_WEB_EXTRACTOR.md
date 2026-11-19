# 知识网页正文提取与规范化适配器（AF-174）

本模块是只处理不可信源数据的异步纯提取函数。默认导出与命名导出 `extractKnowledgeWebText` 使用实际 `htmlparser2@10.1.0` 的 Parser 事件 API；不创建 DOM，不运行 JavaScript，不加载页面或资源，不执行源文本指令，不调用网络、数据库、文件存储、模型、工具或文档发布。它不推断 URL、Workspace 或内容权限；来源授权、网络策略及缓存版本选择始终归原 owner。

```ts
import extractKnowledgeWebText from './knowledge-web-extractor';
const read = await knowledgeWebReader.read(authorizedUrl, { signal });
// 304 抛 NOT_MODIFIED，原 owner 应选择其已有且持久化的提取版本。
const extracted = await extractKnowledgeWebText(read, { signal });
```

输入必须是 AF-171 `KnowledgeWebReadResult` 中的 `fetched` 分支。重新检查 contentType 必须精确为 `text/html` 或 `text/plain`，Buffer 实际字节不超过 1 MiB，byteLength 与实际长度一致，UTF-8 fatal 解码及重新编码均与 bytes/text 相同，源 SHA-256 必须为小写 64 位十六进制且匹配。拒绝 C0（除 TAB/CR/LF）、DEL/C1、NUL、孤立代理项、BOM、替代字符 U+FFFD，包括 parser 将非法数字实体修复成的 U+FFFD；因此合法源中有意使用这些字符也会被保守拒绝。合法 Unicode 标量、中文、组合字符、emoji 和实体保留。空或仅空白的提取结果拒绝；不会将 304 当空成功。

精确结果形状如下，字段值都是未授信数据，不能当作指令或权限凭据：

| 字段 | 含义 |
| --- | --- |
| extractionVersion | 固定 `aij-knowledge-web-text/1`；规范化策略变化须升版本 |
| contentType | 重验后的源类型 |
| title | head 内首个有意义且可见的 title，或 null；纯文本始终 null |
| text | 规范化正文，无 HTML、属性、URL 或工具元数据字段 |
| sourceChecksum | 原始字节 SHA-256 |
| textChecksum | 规范化 text 的 UTF-8 SHA-256 |
| sourceByteLength | 实际源字节数 |
| textByteLength | 实际规范化正文字节数 |

HTML 采用两次有界事件扫描，共用最多 100000 个回调事件预算。第一次只保留标题和候选节点序号，选择首个含可见非空白文本的 article；没有则选择首个有意义的 main，再降级到 body，最后可见文档片段。外层 article 包含嵌套 article，只提取一次；没有候选正文缓冲区积累。第二次只输出选中范围。优先级适用于整份源文档，因此较晚出现的有意义 article 可以优先于较早的 main。选中范围超限时直接拒绝，不换候选或截断。

每次栈深最多 128；未完成的开始标签也计入深度。正文最多 2000 个非空文本块、128 KiB UTF-8，标题最多 200 个 Unicode 标量（组合字形可含多个标量）。相邻段落/标题用空行隔开，列表项、结构块、表格行及 br 用换行隔开；列表不额外添加标记。表格同一行中可见单元格以 TAB 分列，保留空单元格位置，单元格内部段落/br 折叠为空格以保持同一行的列关系；嵌套表格仅按事件流线性展开，不重建布局。普通行内空白跨回调/实体折叠成一个空格。纯文本将 CRLF/CR 统一为 LF，连续空行最多一个空行，水平空白折叠，清理首尾空白行。不会把相邻行内标签之间原本没有空格的中文人为分词。

script/style/template/noscript/iframe/object/embed/svg/math/canvas、form 及控件子树、注释都不输出；hidden 属性、aria-hidden=true、简单内联 display:none 或 visibility:hidden（支持大小写、空白和 !important）使整个解析子树排除。属性仅用于这一可见性判断，任何 href/src/alt/meta 都不输出、不加载。head 的非 title 内容不输出，head 外 title 不当正文。htmlparser2 按 HTML 模式执行隐式闭合，关闭 recognizeSelfClosing；例如 `<script/>` 不会被错误地视为空元素而泄漏后续脚本文字，未闭合 script 的剩余原始文本仍被排除。这里是文本提取，不是 HTML 清洗或浏览器的 HTML5 树重建；畸形结构按 parser 的事件语义处理，可能保守遗漏或拒绝。

每 4096 个源字符（不切断合法代理对）馈入 parser 并让出事件循环，每个回调和校验循环都有 AbortSignal 检查；预取消先于读取输入和创建 parser，解析中可真实取消。两次扫描共用取消信号。源的字符串、类型、长度、checksum 在首次让出前取快照，不在后续读取可变 bytes。事件栈和输出均有独立固定上限；源仍有 1 MiB 总上限，外部 parser 也可能暂存一个未结束标签/属性/注释，不能声称零缓冲。所有错误只给固定 code，无原始异常 cause、源 URL/查询、HTML、隐藏属性、工具元数据或取消 reason；模块没有日志。

静态提取无法计算外部 CSS、class 样式、复杂/转义内联 CSS、浏览器布局或脚本渲染内容，也不访问 iframe、图片、字体和链接。不要把提取结果送入 HTML 渲染器或当可执行指令。上游 owner 后续若持久化、缓存、发布、embedding 或提供导入 API，应独立实现授权和版本管理；本卡不提供这些能力。

## 验证与集成边界

Worker 独立执行 `pnpm install --frozen-lockfile --ignore-scripts`。额外仅在忽略目录 `.artifacts/af174/parser-consumer` 创建隔离 manifest/lock/node_modules 并安装精确 `htmlparser2@10.1.0`；没有改正式 manifest/lock。Worker 的测试转译产物放在该 consumer，实际运行真实 pinned parser，不能当正式 API 运行时依赖或完整 API 构建证据。

Worker 可运行：

```sh
node --test scripts/verification/knowledge-web-extractor.test.mjs
pnpm exec tsc -p .artifacts/af174/tsconfig.json
pnpm exec eslint apps/api/src/plugins/aij-ai/knowledge-web-extractor.ts scripts/verification/knowledge-web-extractor.test.mjs scripts/verification/knowledge-web-extractor-live.test.mjs --max-warnings=0
node --check scripts/verification/knowledge-web-extractor-live.test.mjs
```

其中 ignored tsconfig 继承 API 配置，仅 include 本模块与只读 reader，paths 把 htmlparser2 声明指向自己的 consumer；这是一项真实定向 noEmit 检查，非全 API typecheck/build。

总控接收 STOPPED 后，在实际 `apps/api/package.json` 增加精确 runtime 依赖并更新锁（唯一共享文件请求），执行实际 API build，再用其编译目录运行两项测试。实际产物默认目录为 `apps/api/dist`；目录不同时传绝对 `AF174_COMPILED_API_DIR`。live 脚本无转译或 scratch fallback。

```sh
AF174_COMPILED_API_DIR="$PWD/apps/api/dist" node --test scripts/verification/knowledge-web-extractor.test.mjs
AF174_COMPILED_API_DIR="$PWD/apps/api/dist" node --test scripts/verification/knowledge-web-extractor-live.test.mjs
```

live 测试生成并清理自身临时 TLS 证书，在随机 loopback 端口启动自有 HTTPS 合成夹具，以实际 AF-171 reader 的 TRUSTED resolve/connect seam 路由请求，保留真实 TLS 身份校验。它运行实际默认 extractor，验证真实字节、两种 checksum、HTML/纯文本、恶意源无执行/加载副作用、304 明确拒绝、hash/text 不匹配拒绝，并等待自有 socket close 后断言 0 并清理临时文件。域名只是夹具的 TLS 身份，不做公网 DNS/请求；AF-171 默认 DNS pin/私网拒绝证据归 AF-171，不声称此处有新的公网成功。此脚本仅由总控运行，Worker 只语法/lint 检查。

没有数据库/Schema/module/SDK index 改动，没有接口、页面、菜单、权限或业务日志改动，没有应用启动或可访问产品地址。人工可在总控验收时检查 fixture 成功/拒绝、输出结构与字节校验、所有测试通过和 socket 归零，随后由后续任务独立消费此函数。本卡候选不代表 CODE_VERIFIED、负责人接收或发布。
