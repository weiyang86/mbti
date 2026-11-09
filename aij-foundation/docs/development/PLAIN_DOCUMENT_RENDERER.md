# 有界纯文本文档生成器（AF-197）

内部能力已CODE_VERIFIED，负责人验收待定。没有持久运行地址；网页文档导出、附件归属/权限、历史修订绑定、SDK二进制下载尚未接入。不要把内部库/CLI当成已交付的论文排版产品。

`apps/api/src/documents/document-renderer.ts` 导出 `renderPlainDocument(input, options)`。input仅允许format（docx/pdf）、name（1至160码点）、body（UTF8不超过65536字节/2048段）；正文是纯文本，不执行HTML、宏、网址或脚本。options指定本部署已核对的固定Noto字体路径和公开SHA256；CLI不允许客户端覆盖路径。结果是实际Buffer及MIME、大小、SHA256、rendererVersion和实际PDF页数；DOCX页数为null。输出上限5MiB，PDF最多100页；字体缺字或校验失败明确拒绝，不静默丢字。TAB、空行和CR/LF保留；Word与PDF自然换行、分页可能不同。

root执行 `pnpm --filter @aij/api build` 后，用 `scripts/document-export/runtime-bundle.mjs` 的buildRuntimeBundle创建fresh绝对目录，repositoryRoot必须canonical。它只复制两个真实编译入口、已解析的docx/pdfkit依赖闭包及固定字体/完整字体许可，不安装软件、不复制整个仓库或凭据。同一模块实例、同一进程在finally调用removeRuntimeBundle；重启后不能凭磁盘marker取得删除授权。失败后残留须保留调查，不自行扫目录。

镜像内固定入口 `node /aij/document-renderer-cli.js`，stdin单个JSON `{"input":{"format":"pdf","name":"示例","body":"中文正文"}}`，最多80KiB。成功stdout仅一行schemaVersion1/格式/MIME/size/sha256/pageCount/rendererVersion/base64；调用方必须核验协议和字节，不能信任签名头。失败exit1、stdout为空、stderr固定错误码，不含正文、主机路径或堆栈。客户端不能选择镜像、命令、主机挂载或环境变量。AF199接收后另提供默认关闭的受控执行器。

正式 `AIJ_VERIFY_WRITER=AF-197 pnpm verify:task -- AF-197` 的本地准备：root独立APFS目录安装精确测试依赖（TS5.9.3、PDF.js6.5.438及实际runtime包），记录私有目录及manifest哈希于 `.artifacts/auto-ai-program-20261105/W16/AF-197-private-deps.json`；不能借用Worker的node_modules。阅读器测试需本地Linux Docker engine、共同契约固定Node镜像和root独占创建的QA镜像（同Node基础，apt安装libreoffice-writer/poppler-utils/fontconfig/python3），实际imageId文件位置登记在私有AF-197-reader-image-context.json。QA字体以已核hash、0644的只读公开目录提供给uid65534，HOME/XDG缓存仅tmpfs。不能把重构建超时视为镜像构建成功。QA镜像不是生产发布制品，也不证明其他CPU架构部署。

最终run-LueteM：7个真实格式/输入/依赖闭包/伪造marker/替代inode案例；固定Linux/aij真实CLI与非法输入；独立ZIP CRC/XML/关系、LibreOffice/Poppler文本/字体/页数；Word/PDF各3页，全部6 PNG由root逐页查看并与最终正式运行逐张核hash一致；45既有源码回归、types/build、实际生产audit全级别0、lint通过。4个本卡容器均已实读不存在，builder临时目录删除。私有样本仅自有合成文本；生成的文件没有上传到厂商。见[执行记录](../execution/AF-197.md)。

新增依赖的来源、独立许可证缺失限制见[来源收据](../execution/AF-197-dependency-provenance.json)和[SOURCE_PROVENANCE](../governance/SOURCE_PROVENANCE.md)。未授予公开分发、push、PR、部署或负责人接收。
