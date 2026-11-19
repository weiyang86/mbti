# AF-143 候选执行记录

任务名称：通过统一存储读取端口校验附件内容。仅候选交付，不代表正式 CODE_VERIFIED；负责人接收 PENDING。

## 工作区与基线

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W02-AF143`
- Instance：`ada252e9-eda3-4a32-b88b-9b6968e55ceb`；实际目录同上。
- Task：`task_54d96be08a70`；Dispatch：`ctx_a40d7adcae71`。
- Writer terminal：`term_52775d54-eea4-4abc-883a-b969738fb4f6`；coordinator：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支：`weiyang86/AIJ-W02-AF143`，未切换；起始 HEAD 与 `origin/dev` 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- `git status --short --branch` 初始仅 `## weiyang86/AIJ-W02-AF143`，无继承修改。
- fetch/push remote：`git@github.com:weiyang86/aij-foundation.git`；未 fetch/push 或修改远端。
- 授权来源：根工作区只读 `docs/planning/auto-ai-program-20261105/{PROGRAM,WAVE-02,AF-143}.md`；核对冻结基线 REQ-008 / AC-008 与 E12，仅交付读取端口切片，未宣称七牛完成。

## 有效工时

- 核对、源码审计、独立安装：约 0.10h；累计 0.10h（预算 2.5h）。
- 实现与目标测试：约 0.10h；累计 0.20h。
- 自查、执行记录与候选交接：约 0.05h；总计约 0.25h，低于 2.5h 预算（有效工时估计，含思考与命令检查）。

## 实际差异与影响

- `storage-reader.port.ts` 导出 `STORAGE_READER` Symbol 与 `StorageReaderPort = Pick<StorageAdapter, "read">`，复用 `@aij/runtime-contracts` 唯一契约 owner。
- `file-content.service.ts` 使用显式 `@Inject(STORAGE_READER)`；直接复用 runtime-contracts 的 `LocalStorageError`，不创建第二份错误类型。仅共享错误实例的 `OBJECT_MISSING` 映射 missing，其他存储/未知异常为 unavailable；缺完整性元数据或长度/SHA256 不匹配为 corrupt。异常不附带原始异常、cause 或对象 key。
- 读取支持 Buffer / Uint8Array，对有效视图安全复制为 Buffer 后验证精确字节长度及 SHA256；视图前后缀不进入结果，后续 provider 修改不能改变已验证返回值。非字节响应安全拒绝为 unavailable。
- `files.module.ts` 默认 `{ provide: STORAGE_READER, useExisting: LocalStorageAdapter }`；保留 LocalStorageAdapter 与 FileContentService 的导出并增加端口导出，不创建第二个本地存储实例。
- `file-storage-reader.test.mjs` 在内存转译实际源码（含 runtime-contracts、现有 LocalStorageAdapter 和 FilesModule），使用真实 Nest 装饰器、metadata 和无 HTTP 的 DI context；未加载应用 bootstrap。测试替代读取器只在测试模块中注入，无产品 mock / descriptor 替身。
- 数据库/Schema/账本/上传写入/删除无差异；API 路由、DTO、权限、菜单、页面与日志代码无差异。既有客户、管理员和 AI 附件读取仍消费同一 FileContentService，HTTP 契约保持 Buffer；实际 HTTP 回归待总控验证。

## 命令与实测结果

环境：Node `v24.21.0`、pnpm `10.0.0`；所有命令均在本子工作区执行。

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | 独立安装 726 个依赖，锁文件未改变；使用 pnpm store 常规安装，没有复制/共享其他工作区 node_modules。存在现有 DEP0169 警告及依赖构建脚本 ignored 提示，非校验失败；未执行依赖 rebuild。 |
| `node --test scripts/verification/file-storage-reader.test.mjs` | 0 | 36/36 有效测试通过，fail/cancelled/skipped/todo 均 0；约 345ms。 |
| `pnpm exec eslint apps/api/src/files/file-content.service.ts apps/api/src/files/files.module.ts apps/api/src/files/storage-reader.port.ts scripts/verification/file-storage-reader.test.mjs --max-warnings=0` | 0 | 无 warning/error。 |
| 下列源码导入图 noEmit 检查 | 0 | 变更 TS 文件及真实导入图通过；runtime-contracts 仅指向本工作区真实源码；不依赖 dist、不生成文件。 |
| `git diff --check` | 0 | 无空白错误。候选提交前另做暂存范围与 `--cached --check` 核对。 |

noEmit 命令（完整可复现，不是完整 API / Web 类型门禁）：

```sh
node --input-type=module <<'JS'
import ts from 'typescript';
import { resolve } from 'node:path';
const parsed = ts.readConfigFile('apps/api/tsconfig.json', ts.sys.readFile);
if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
const converted = ts.convertCompilerOptionsFromJson(parsed.config.compilerOptions, resolve('apps/api'));
const files = ['apps/api/src/files/file-content.service.ts', 'apps/api/src/files/files.module.ts', 'apps/api/src/files/storage-reader.port.ts'];
const program = ts.createProgram(files, { ...converted.options, noEmit: true, rootDir: resolve('.'), baseUrl: resolve('.'), paths: { '@aij/runtime-contracts': ['packages/runtime-contracts/src/index.ts'] } });
const diagnostics = [...converted.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: x => x, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => '\n' }));
else console.log('PASS: changed files and actual import graph typechecked with runtime-contracts source; noEmit, no DB, no dist build');
process.exitCode = diagnostics.length ? 1 : 0;
JS
```

36 项测试覆盖：真实模块默认 alias / 唯一实例 / 显式注入 metadata / 跨模块导出消费；Nest 替代只读 adapter 和偏移 Uint8Array 视图；Buffer/空对象成功且返回副本；4 种缺元数据先拒绝、不触发读取；7 种长度不匹配/无效值；同长度篡改及无效摘要；7 类共享存储错误映射；5 类未知/伪装 provider 异常去敏；7 类非法返回类型；同一服务 missing → 成功 → provider 故障 → corrupt → 成功恢复。测试执行实际服务方法，不复制服务实现或用字符串匹配替代功能断言；metadata 检查与实际 Nest DI 行为同时执行。

## 未运行、已知失败与边界

- 未运行正式 `verify:task AF-143`：registry/正式队列由总控独占，本候选工作区不登记或修改正式状态。
- 按派工未运行 DB、Docker、migrate/seed、HTTP/浏览器/真实磁盘读写回归、全库/API build、全 API/Web 类型门禁；未启动任何端口或常驻服务。纯 DI context 无监听、无 DB，均已 close。
- 未生成 Prisma，未读取或复制凭据/env/上传文件，未连接真实厂商、七牛、通知或付费能力。七牛/多对象 provider 路由/旧对象迁移未在本卡实现；默认仍为现有 LocalStorageAdapter。
- 本卡已执行检查无已知失败，无待解决实现阻塞。后续 provider 的对象定位与 missing 归一化需其适配卡实现，不能把原始错误的 code 字符串直接视为共享错误实例。

## 总控验证建议与人工步骤

1. 收取本候选提交及明确停写交接，仅精确集成本报告列出的 5 个允许路径；核对原名候选提交与起始 SHA，不接收其他卡或根工作区差异。
2. 注册并运行 `pnpm run verify:task -- AF-143`，纳入目标纯测试、lint、API 类型/构建和适用回归。根环境依赖与隔离数据库目标先核验；DB 写入与重型构建分别并发 1。
3. 顺序运行现有 `file-storage-adapter.test.mjs`、`runtime-contracts-filesystem.test.mjs`、`file-storage-module.test.mjs`（依赖根的正确 dist / runtime-contracts 制品）；由总控验证真实磁盘、路径/权限/隔离及默认模块装配。
4. 由总控在已核验的隔离测试库顺序运行 `file-view.test.mjs` 和 `file-access.test.mjs`，覆盖客户/管理员成功下载精确字节、匿名/越权/跨项目拒绝、缺对象 missing、篡改 corrupt 及删除补偿。Worker 未执行这些步骤，不将建议记为通过。
5. 人工在负责人允许的测试环境上传合成附件、下载比对原件；检查管理员与客户权限及无 key/原始异常泄露；损坏/移除对象后复核既有拒绝行为。当前没有已运行访问地址，`3655/3656` 均未由本卡启动。

## 候选交接

仅上述 5 路径进入候选提交，标题逐字为「通过统一存储读取端口校验附件内容」，AF-143 写提交正文。候选 SHA 由交接消息提供，避免报告自引用提交。

产品/测试 Writer 在本报告与候选提交完成后停止全部写入；不更新正式队列/registry，不 merge/push/PR/tag/部署。正式集成、验证记录与提交由主Agent完成；下游仅引用主Agent真实 I-* Task，本候选 Task 不充当正式 CODE_VERIFIED。负责人接收保持 PENDING。
