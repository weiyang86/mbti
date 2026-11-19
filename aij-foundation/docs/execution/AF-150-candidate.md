# AF-150 候选交接：支持DeepSeek与阿里云的文本模型连接

状态：WORKER_CANDIDATE_READY；总控正式 verify:task、HTTP/Job/DB、完整构建与浏览器验收未运行，非 CODE_VERIFIED / DEV_INTEGRATED / OWNER_ACCEPTED。Writer 交回候选后停止写入；总控接收或退回同一 Writer 修复。负责人历史验收状态不变。

## 实际工作区与范围

- 日期：2026-11-05（Asia/Shanghai）。唯一 Writer：本派工 Codex，默认模型，无子代理或辅助 Worker。
- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W04-AF150`；instance `43784d7c-d0af-4db9-94ab-c0cb1aae1377`。
- Task：`task_6e2843755a1b`；Dispatch：`ctx_4f83bf1b53fe`；Worker terminal：`term_e7faecdd-c24b-453b-9868-e3687e4d09fe`；协调 terminal：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 开工 `git status --short --branch`：仅 `## weiyang86/AIJ-W04-AF150`，无已有差异；branch `weiyang86/AIJ-W04-AF150`；HEAD 与本地 origin/dev 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。未 fetch/checkout/switch/reset/clean。
- origin fetch/push：`git@github.com:weiyang86/aij-foundation.git`。Orca current 确认本工作区为 registered child，baseRef `refs/remotes/origin/dev`、isMainWorktree=false。
- 只修改派工八个 allowPaths；主工作区和原轻企仓库未写入。没有 bootstrap、Schema/manifest/lock/registry/正式队列修改。
- `pnpm install --frozen-lockfile` 独立安装 exit 0，Node `v24.21.0` / pnpm `10.0.0`。pnpm 更新检查出现 registry fetch 警告但安装完成，未升级或放宽冻结锁文件；没有复制 env、凭据、node_modules、上传目录或创建跨工作区链接。

## 实际变更

1. `ai-vendor-profiles.ts`：共享协议策略由实际配置校验和实际请求组装使用；不是新执行器或账本。新增百炼大陆精确 base，Alibaba 本期仅支持 `qwen3.8-max`、`max_completion_tokens`、`stream:false`、顶层 `enable_thinking:false`、文本及 `json_object` 最终回答。DeepSeek 用 `max_tokens` 和 `thinking:{type:'disabled'}`。兼容别名使用同一第一方协议限制，DeepSeek 自定义批准路径仍保持原 hostname 拒绝/确认约束。
2. `ai-center-policy.ts`：vendor 严格枚举增加 aliyun；只增加精确 `https://dashscope.aliyuncs.com/compatible-mode/v1`，第一方厂商与地址绑定，不接受自动区域切换、URL 变体或任意主机。DeepSeek/Alibaba 第一方文本 profile 在保存阶段拒绝 image 或错误 token 参数；Alibaba 拒绝本期未验证模型。字段、SecretRef 语法、依赖、预算与版本校验保留。
3. `ai-center-provider.ts`：仍由现有 AiCenterProviderService 执行，保留实际 256KiB bounded JSON/UTF8 parser 和最终回答 schema 校验；实际调用前重检 enabled/live/Agent 发布及 DeepSeek 三门禁。拒绝第一方响应 model 不匹配、上游 error、length、tools、function_call、refusal、空或过大内容、异常 usage/cache/total；只返回 content，不返回 reasoning_content。失败沿用 Run 的 unknown + reserved、不自动重试或 fallback。
4. `packages/contracts/src/index.ts`：只在 AiCenterProvider.vendor union 增加 `'aliyun'`，所有无关导出和类型保留。
5. `admin-ai-center.tsx`：沿用 Ant Design 当前表单，增加阿里云百炼大陆选择与精确地址预填；新连接 enabled=false/liveEnabled=false 仍保持。选择百炼模型连接预填 qwen3.8-max/max_completion_tokens，第一方 text 限制可见；无页面重做或 CSS 变更。
6. 两个新测试：源码行为测试；总控专用新 AF-150 lease 真实 HTTP/Job/DB 验收脚本，只有当前 app instance 的 AiCenterHttpTransport.request 映射两个精确官方 chat URL 到自有 loopback，没有真实厂商透传路径，也不修改 global fetch、原型或生产 URL 校验。

Run/Job/Trace/SecretRef/预算和内部估价均复用现有 owner，未添加厂商价格、第二套成本记录或执行服务。客户无需也不能指定 vendor/base/model/credential；管理员仍通过现有配置/密钥权限管理。数据库、表结构、迁移、权限目录、公共 API 路由无新增；页面仅现有 `/auth/ai/center` 编辑器选项变化。审计仍为去敏字段/计数；Trace 只保留既有 usage，厂商成本未报告时为 unreported/null，配置价仅内部估计；cache 命中数不自动产生折扣账单。

## 官方协议依据（2026-11-05 实际浏览核对）

以下日期是本次核对日期，不伪造页面发布日期：

- [DeepSeek Your First API Call](https://api-docs.deepseek.com/)：当前 OpenAI 格式与非流式入口说明；[WorkBuddy/CodeBuddy 官方接入](https://api-docs.deepseek.com/quick_start/agent_integrations/workbuddy/) 明列 `https://api.deepseek.com/v1/chat/completions`，因此保留本库既有 `/v1` base。
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)：max_tokens、关闭 thinking、stream=false、json_object、stop/length/tool_calls、prompt/completion/total 与 cache hit/miss 字段。当前示例模型 deepseek-flash；本卡不声称穷举全部模型或工具/视觉能力。
- [百炼 OpenAI兼容-Chat](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)：当前文档推荐业务空间专属域名，同时明确现有 dashscope 域名继续可用；本卡固定使用批准的大陆旧域名，不自动迁移。该文档推荐新接入用 max_completion_tokens，支持 Qwen3.7-Max 及之后型号；request/response、usage.cached_tokens 及 enable_thinking 顶层语义已核对。
- [百炼深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking)：qwen3.8-max 有明确 stream=False 同步示例；部分其他型号仅支持流式，不能外推全目录。
- [百炼结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)：qwen3.8-max 的 json_object 及最终 content 示例；本库仍严格校验字符串字段对象，不使用 JSON Schema、工具或多模态接口。

测试用模型名是协议 fixture 示例，不证明真实账号权限/模型在线率/全型号支持。Alibaba 产品支持范围本期收敛为 qwen3.8-max；DeepSeek 实测 fixture 为 deepseek-flash，其他管理员配置 ID 仍沿用既有配置机制，不宣称已逐一验证。即便厂商文档具有更多视觉/工具能力，本卡只发送系统/用户字符串消息并只接受最终文本/JSON。所有实际 tests 为合成/离线响应，未发真实厂商请求。

## Worker 实际校验与失败历史

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0，独立 726 包；锁文件无差异 |
| `pnpm --filter @aij/api prisma:generate` | exit 0，明确 compilation only/no env loading/no DB |
| `node --test scripts/verification/ai-vendor-text.test.mjs` | 最终 exit 0，12/12，fail/skip/todo=0 |
| `node --test scripts/verification/optimization-delta/offline.test.mjs` | exit 0，10/10，原离线回归 |
| 精确路径 eslint，`--max-warnings=0` | exit 0，API 三文件、Web 编辑器及两个新测试 |
| API、API test、Web 源码映射 TypeScript noEmit | 最终 exit 0，三个 tsconfig 各 0 diagnostics，无 emit |
| `node --check scripts/verification/ai-vendor-text-live.test.mjs` | exit 0，仅语法，不宣称 live 通过 |
| `git diff --check` | exit 0 |

源码目标测试执行真实 TS/TSX 转译后的函数：严格 catalog；精确 URL/vendor；模型与 token 参数；两家 text/JSON 实际 body；usage/cache 到实际 AiCenterBudgetService 内部估价；DeepSeek 三门禁及别名；disabled/abort；旧 OpenAI/compatible 两种 token/JSON 与实际 PNG parser；错误/length/tools/畸形/过大/UTF8/usage 不成功且单次调用；最终回答/输入脱敏；真实编辑器选择事件、预填和禁用默认值。无字符串快照冒充行为测试。

失败历史：常规 `pnpm --filter @aij/api typecheck` 与 Web typecheck 均 exit 2，原因是新工作区依赖包的 dist 声明尚未构建，未冒充通过；没有为此跑 Worker 禁止的 app build。首次源码映射命令将 UI entry 写为 index.tsx 引发 TS Debug Failure（API 两配置已 0 diagnostics），改为实际 index.ts 后三配置全部通过。新增 UI 行为测试首次 11/12（JSX 按数组保存中文按钮 children，测试查找方式错误），修正测试树查找后 12/12。安装更新检查警告和这些失败不作为产品门禁成功证据。

noEmit 的可复跑命令（直接映射本工作区各 package 源文件；不修改 tsconfig 或声明产物）：

```sh
node --input-type=module <<'JS'
import ts from 'typescript';
import {resolve} from 'node:path';
const root=process.cwd();
const paths=Object.fromEntries(['contracts','core','runtime-contracts','sdk','ui'].map(name=>['@aij/'+name,[resolve(root,'packages',name,'src/index.ts')]]));
let errors=0;
for(const file of ['apps/api/tsconfig.json','apps/api/tsconfig.test.json','apps/web/tsconfig.json']){
 const config=ts.readConfigFile(file,ts.sys.readFile);
 const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,resolve(root,file,'..'));
 const program=ts.createProgram(parsed.fileNames,{...parsed.options,paths,baseUrl:root,rootDir:root,noEmit:true,incremental:false});
 const diagnostics=[...parsed.errors,...ts.getPreEmitDiagnostics(program)];
 if(diagnostics.length) console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
 console.log(file+': '+diagnostics.length+' diagnostics');errors+=diagnostics.length;
}
process.exitCode=errors?1:0;
JS
```

## 总控集成请求与未运行项

总控必须在主工作区串行保护/迁移后运行；Worker 不碰共享 allowlist/registry。请精确添加 AF-150 到：

- `scripts/database/migration.mjs` 的 createAcceptance task allowlist；
- `scripts/database/seed.mjs` 的 registered Seed/auth task allowlist；
- `scripts/verification/auth-support.mjs` 的 authKeys/authEnvironment allowlists（该文件部分列表重复，逐处检查）；
- `scripts/verification/client-auth-fixture.mjs` 的 clientFixtureTasks。

注册为真实新 AF-150 task，不能借用旧 lease 或旧 AF-123 身份。总控新增本卡正式 registry/queue/执行记录；目标 source-loader 如因新 import 出现严格映射拒绝，只精确添加真实 `./ai-vendor-profiles` 模块映射，不放宽 loader 的未知 import 拒绝。本 Worker 未发现基线旧 source-loader 直接消费 ai-center-policy/provider 的测试，不擅改任何旧测试。

总控准备包声明和 API dist 后：

```sh
AIJ_AF150_ROOT_ACCEPTANCE=true node --test --test-concurrency=1 scripts/verification/ai-vendor-text-live.test.mjs
```

脚本自己严格验证主路径和 git common-dir 身份，在 fresh AF-150 lease 上覆盖：disabled 默认/认证授权/owned SecretRef/地址模型请求拒绝；DeepSeek 三确认兼容别名；两家 text + JSON，幂等、Job、Trace、usage/cache、内部预算结算且无厂商成本伪造；排队后停用释放；各类异常 unknown/reserved 且无重试/回退；预算429、审计及 DB 不保存 reasoning/凭据。脚本仅语法/lint 通过，必须等总控实际执行结果；新 shared allowlists 尚未注册时会 fail closed。

Worker 没有运行 DB/Docker/seed/migrate、API/Web 全构建、浏览器服务或真实厂商/付费调用，也没有 push/PR/merge/tag/发布。现在没有本卡实际运行的访问地址。人工验收由总控在已运行且有身份保护的 Web 中登录 `/auth/ai/center`，新增百炼确认地址及默认两开关关闭，选该连接新增模型核对 qwen3.8-max/max_completion_tokens/text；保存和调用仍须 owned SecretRef、既有权限、总开关和预算。真实厂商账号联调及更多型号、视觉/embedding/rerank/tools/streaming/region 切换不在本卡范围。

Writer 有效工程约 0.3h（工作区登记 10:55 至候选交接约 11:13；预算 Worker<=3h，总控预留1h，合计<=4h）。候选提交只包含本卡八个路径，以任务原名提交；不是正式通过提交。下一代码依赖必须由总控集成后引用真实 I-* Task ID；本 Worker 不自行接续任务。
