# 私有 Python Skill 执行 API 与公共 SDK

范围为个人/当前 Workspace 的单个 Python 源文件、严格 JSON 输入和 JSON 结果附件。复用原 Skill head/version、ClientAuth/Workspace 权限、RuntimeJob、固定 Linux PythonSandboxRunner 和 FileAsset；不创建 AI Run/Trace/费用或第二队列。脚本不能绑定到 Agent 当提示词执行。本范围不含多文件包、依赖安装、网络/工具调用、输入附件、执行网页、原生文件选择器或市场审核。

生产默认关闭。当前启用方式是受信任宿主 DI 的 `SCRIPT_SANDBOX_OPTIONS`，要求固定绝对 Docker CLI 路径及批准的官方 Python digest；没有客户端开启字段或网页配置入口。`configured` 表示该受信任配置成立，不是 Docker 引擎、容量或某次脚本成功证明。未启用时提交503、不创建Job，当前仍获授权的既有结果可以读取。

所有入口前缀 `/api/client/script-executions`。身份、会话、项目和空间成员关系由原Guard/服务端确定；工作空间请求头是选择器，不授予权限。写入还要求当前产品批准的Origin。请求只接受UTF8 JSON，拒Content-Encoding、重复键、危险键、坏Unicode、非有限数字、未知字段、GET正文或额外query。Host传输限制仍为100KiB，转义膨胀可能先得到413。

| 方法与路径 | 内容 | 当前所需权限 |
| --- | --- | --- |
| POST `/versions` | skillId、expectedRevision、name、instructions、scriptSource；201返回不可变ScriptRef | assets.manage + scripts.manage |
| GET `/versions/:id` | 当前head仍匹配时返回ref与私有源码 | assets.read + scripts.manage |
| GET `/capability` | configured、canExecute、reason | assets.read；执行权限不足返回not_permitted |
| POST `/runs` | scriptVersionId、input、idempotencyKey；201返回ScriptRun | assets.read + ai.execute + scripts.execute |
| GET `/requests/:key` | 按原key显式恢复，不入队 | assets.read + ai.read + scripts.execute |
| GET `/runs/:id` | 原Job状态、原脚本来源和结果元数据 | assets.read + ai.read + scripts.execute |
| GET `/runs/:id/content` | 成功JSON附件的原始字节 | 与run读取相同 |

表中 `assets.*`、`scripts.*` 的完整前缀为 `workspace.ai.`；`ai.read`、`ai.execute` 的完整名称为 `workspace.ai.read`、`workspace.ai.execute`。管理源码权限不隐含执行权限，ai.read不隐含ai.execute；脚本结果读取仍需scripts.execute。普通成员、另一位有同空间OWNER角色的成员也不能读取此个人资产。修改原Skill head、撤销权限/原启动会话或失效依赖会阻止执行及结果交付；结果查询可使用同一owner的新有效会话。

源码UTF8上限65536字节，禁止NUL；JSON输入canonical UTF8上限16384字节，结果上限65536字节，深度16、对象键与数组元素总数2048。合法JSON字符串值/键中的U+0000会无损存入PostgreSQL json并传给Linux执行器；原源码文本不进入原prompt版本或审计。输出必须是恰好一个严格JSON文档，BOM、重复键、非JSON前后缀和非有限数字均拒绝，原合法stdout UTF8字节及摘要保持一致。

公共 `@aij/sdk` 导出 `createPersonalScriptExecutionClient`、ScriptRef/ScriptRun及输入类型。工厂使用原ClientApi一次fetch，保留cookie/no-store/Workspace策略；宿主负责正常的已认证浏览器上下文。七方法为createVersion、version、capability、submit、recover、read、download。

```ts
const scripts = createPersonalScriptExecutionClient(api);
const capability = await scripts.capability(workspace);
// 由界面/业务明确处理not_configured或not_permitted。
const key = crypto.randomUUID();
const queued = await scripts.submit(workspace, {
  scriptVersionId: ref.scriptVersionId,
  input: { value: "synthetic" },
  idempotencyKey: key,
});
// 提交结果未知时，由调用方明确发起此GET；不能换key重新POST。
const same = await scripts.recover(workspace, key);
const current = await scripts.read(workspace, same.id);
if (current.outcome === "SUCCESS" && current.result) {
  const file = await scripts.download(workspace, current);
  // 宿主负责明确的保存交互及使用后清空file.bytes。
}
void queued;
```

Job的completed不是脚本SUCCESS的替代；按原jobStatus与脚本outcome/result分别展示。执行前持久attempted标记，一旦已尝试或结果/容器清理未知，不自动重跑。相同作用域/key/输入返回原任务，输入或来源不同409。读取不会创建Job。执行期保留原启动session/tokenVersion并在IO/锁等待后复检，读取与下载在存储IO后再次复检当前会话、权限和来源。

下载响应为原始application/json，包含Content-Length、Content-Disposition及X-AIJ-Script-Run-Id、X-AIJ-Script-Version-Id、X-AIJ-Asset-Id、X-AIJ-Checksum-SHA256；所有本prefix响应（含解析/认证错误）为private,no-store+nosniff。SDK比对预期run/版本/附件、名称、长度、MIME、摘要和严格JSON，失败/中止时清零临时字节，不落storage、URL、日志或ObjectURL。

输入/结果访问七日到期410。原有保留期维护擦除到期输入，保留key/hash/来源、Job及结果引用；删除/禁用结果附件不阻断私有输入擦除。文件清理用原FileAsset持久标记禁止迟到提交，存储删除不跨DB锁；提交回执未知先读回，不能误删已提交附件或重跑脚本。

本卡没有常驻验收地址。真实验证及各阶段失败保留在AF209/210/211执行记录与注册verify:task报告；代码通过不等于负责人接收、真实厂商通过或完整40项产品目标验收。
