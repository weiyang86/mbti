# 个人 Agent 发布与版本调试（AF-189）

阶段：CODE_VERIFIED，root 已接入原运行时、迁移、SDK 公共导出和原详情页；正式验证为 AF-189/run-S2kzKV，实际记录见 `docs/execution/AF-189.md`。负责人接收仍待确认，不能将候选离线检查视为产品验收。

发布只决定当前私有 Agent 版本的执行资格，不向其他账号或组织分享，不代表模型执行配置、预算或上游供应商可用。`enabled=true` 仅启用配置；新 Agent 的 `published_revision=NULL, publication_version=0`，不自动发布。所有不可变 authored 历史版本继续原样保留。

## HTTP 契约

统一前缀 `/api/client/ai/personal-agents/:id`，`:id` 是实际小写 UUID v4。身份、空间、成员关系和权限均由服务端会话及现有 Workspace Guard 核验；ProjectProfile 不是调用方租户。所有路由使用 `private, no-store`，错误路径也必须由现有 bootstrap 中最早的个人 Agent no-store 中间件覆盖。

| 方法与路径 | 权限 | 请求 |
| --- | --- | --- |
| `GET /publication` | `workspace.ai.assets.read` | 无 query、无 body |
| `POST /publication/publish` | `workspace.ai.assets.manage` | 精确双版本 CAS |
| `POST /publication/unpublish` | `workspace.ai.assets.manage` | 精确双版本 CAS |

写入 body 只能是 `{ "expectedAgentRevision": 2, "expectedPublicationVersion": 0 }`。两项均为 JSON 整数；Agent revision 范围 1–2147483647，publication version 范围 0–2147483647。拒绝额外字段、字符串数字、客户端快照和自报身份。写入口还校验与既有 webUrl 完全相同的 Origin，拒绝 cross-site。

响应只有：

```json
{
  "agentId": "7ac902e2-d7fa-44f0-82bd-2a4c27f7c009",
  "revision": 2,
  "publishedRevision": null,
  "publicationVersion": 0,
  "published": false,
  "dependencyReadiness": { "ready": true, "reason": "ready" }
}
```

`dependencyReadiness.reason` 仅允许 `ready`、`disabled`、`dependencies_unavailable`、`validator_unavailable`。不返回指令、Skill 正文、模型连接参数、密钥引用或密钥值。ready 是当前 authored 版本及模型/Skill 依赖校验结果，不是执行准入凭证。

CAS 任一项不一致返回 409；自己的已删除或其他 owner 资源返回 404；无管理权限返回 403。当前目标状态相同且 CAS/依赖有效时无变化，不增加 epoch 或审计。真正发布/撤销发布仅更新 head 的 published_revision/publication_version，不增加 authored revision；同一事务写元数据审计，审计失败则回滚全部变动。epoch 上限拒绝继续变更。

## 内部校验与执行

服务通过 INTERNAL `PersonalAgentPublicationValidator.validate(tx, scope): Promise<void>` 端口调用已注册的 `RootPersonalAgentPublicationValidator`，复用原 resolver 的 `validateDependencies()`。没有注册校验器时，GET 返回 `validator_unavailable`，发布返回 503，撤销发布仍可进行。不能用 stub、`skipPublished` 参数或客户端快照替代校验器。

发布要求当前 head 已启用、不可变版本与 head 一致、当前目录及 text 模型/供应商允许、固定 Skill 版本仍属当前成员/空间且源 Skill 未删除。项目、组织、插件安装、成员/角色/授权、目录、head 和 pins 锁均在同一事务持有。发布入口不查密钥、不生成 Run/Job/Trace、不预留或结算预算。

原有 Agent 更新、禁用和删除必须在发生真实 head 变化时原子撤销发布并递增 publicationVersion；相同内容保存无变化。所有 Run 准入快照冻结 publicationVersion；各次 worker 当前权限校验必须比较确切 epoch。发布→撤销→同版本再发布仍拒绝旧队列快照。历史快照缺少 epoch 一律执行拒绝。已完成或 unknown 的 Run 不自动重新运行。

数据库沿用原 head 身份与墓碑保护，只有“内容及其他字段逐字不变、发布状态实际变化、epoch 恰好 +1”的更新可不增加内容 revision；内容变更与删除必须撤销发布并恰好递增 epoch。原 authored version 和 Skill binding 的不可变触发器不变。仅增 epoch、借发布修改内容、修改历史均由数据库拒绝。

provider/storage IO 返回后，在原成功结算事务中再次核对当前项目/组织/插件、成员/角色权限、完整快照与发布 epoch、Skill/模型及显式记忆 refs，并重验同一 Job lease/nonce；撤权后不得写入成功结果或结算为已确认费用，已尝试任务保留 unknown/reserved。已完成结果读取继续按原 owner 授权，不因后来撤销发布而自动重新执行。

## 嵌入组件与人工验收

`ClientAgentPublication` 接收已组合的类型化 API port、当前 scope/身份/权限、`revalidate()` 和 `onDebug()`。它嵌入原有 Agent 详情，不创建第二个编辑器或执行器；沿用父级 AntD/adminTheme 和详情分区样式。scope 包含 workspaceId/memberId/sessionKey/roleKey/revalidationKey/permissions，均由父级当前会话与空间上下文获得；重新验证时对比完整 scope。

1. 在现有 Agent 详情核对“未发布”、当前配置版本和发布状态版本；启用配置不会自动发布。
2. 点击发布、明确确认，再读取“已发布”。重复同版本操作不增加 epoch/audit。修改配置后应立即未发布。
3. 点击“刷新并进入运行调试”，进入原有预览/运行页面；既有执行确认和服务端准入仍生效。撤销发布后新任务被拒绝。
4. 只读角色不显示发布/撤销动作，直接请求 API 仍应 403。
5. CAS 冲突保留待核对意图，须重新读取并再次明确确认；写入结果未知时禁止重试，先读取当前状态并点“已核对当前状态”，再开始新操作。
6. 切换成员、空间、角色、会话、重验证代数，或焦点/可见性/卸载变化，清空元数据和对话框，旧异步回调无效。

内容仅保留在 RAM，不进入 URL、history、storage、日志或 unsafeHTML。scope 的 sessionKey 是父级不透明会话代数，禁止传真实 Cookie/Token。原生 OS 文件选择器和真正 document-hidden 证明本卡 Worker 均为 NOT_PROVEN，不推定历史证据通过。

当前组合组件 `ClientAgentPublicationAccess` 每次实际读取 Cookie `/client/auth/me` 与 Workspace context。context 增加由服务端已验证 sessionId 单向散列得到的 `sessionGeneration`（不是凭据），配合当前 roleId/permissions 检测同成员会话变化。它不是执行授权票据，API 仍独立核验。确认窗 Escape 在 portal 卸载后使用当前作用域 ticket 恢复触发按钮焦点，旧 scope 的 ticket 无效。

## 验证与限制

离线：`node --test scripts/verification/personal-agent-publications.test.mjs`；定向 eslint；`node --check scripts/verification/personal-agent-publications-live.test.mjs`。离线事务适配器不是 PostgreSQL 行锁/并发证明，UI 状态单测不是原生浏览器证明。编译报告明确区分候选诊断与 bootstrap 继承诊断，不能据此声称整体编译通过。

总控真实入口：`AIJ_AF189_ROOT_LIVE=1 AIJ_AF189_NATIVE_ADAPTER=<root/.artifacts 中的绝对 mjs 路径> node --test scripts/verification/personal-agent-publications-live.test.mjs`。缺失 adapter、controller/provider/schema、实际 packed SDK 公共导出或 root DB 注册必须 FAIL，不能 skip。详细接线、schema 和原有回归要求见 [AF-189-ROOT_WIRING](../planning/auto-ai-program-20261105/W14/AF-189-ROOT_WIRING.md)。Worker 未启动数据库、应用/API/Web server 或浏览器，访问地址没有实际运行。
