# 用户私有 Agent 配置接口（AF-159 候选）

此接口保存当前会员自己的配置资产和不可变版本。它与产品 Agent 目录 `/client/ai/agents` 分开，路径为 `/client/ai/personal-agents`。`enabled` 默认 `false`，即使设置为 `true` 也仅表示配置意图，不提供执行、发布、工具、知识库、工作台或分享能力。未来执行必须重新授权模型与 Skill 等资源，不能直接信任历史引用。

本候选尚未接入宿主，Worker 未启动 API、数据库或页面；只有总控完成接线、迁移、正式门禁后才可使用。

| 方法 | 路径 | 输入 / 结果 |
| --- | --- | --- |
| GET | `/model-options` | `{catalogVersion, items:[{code,name,revision,capability:"text"}]}` |
| POST | `/` | 下方完整配置 + `code`，返回当前资产（201） |
| GET | `/` | `limit=1..50`（默认20）、`afterId`，返回摘要与 `nextCursor` |
| GET | `/:id` | 返回本人当前资产与固定 Skill 引用 |
| PATCH | `/:id` | 完整配置 + `expectedRevision`，返回当前资产 |
| GET | `/:id/versions` | `limit=1..50`、`beforeRevision`，revision 倒序，数字 `nextCursor` |
| DELETE | `/:id` | `{expectedRevision}`，返回 `{id,revision,deleted:true}` |

模型选项只返回当前目录中已启用 provider 下已启用的 TEXT 模型，目录版本在顶层返回。无 SecretRef、密钥、URL、上游模型名、产品 prompt、价格或 provider 配置。模型使用产品模型 code；不接受用户提供的上游 endpoint。`liveEnabled` 是执行开关，不是配置选项的可见性依据。

创建示例（JSON 数据，instructions 不执行）：

```json
{
  "code": "private-advisor",
  "name": "我的顾问配置",
  "instructions": "按问题给出建议。",
  "modelCode": "advice-text",
  "modelRevision": 1,
  "catalogVersion": 1,
  "inputFields": ["question"],
  "outputFormat": "json",
  "outputFields": ["answer"],
  "skillBindings": [{"skillId": "owned-private-skill-id", "revision": 1}]
}
```

PATCH 是完整替换可编辑配置；不含 code，必须带 `expectedRevision`。省略 enabled 归一化为 false；调用方编辑已启用配置时须显式保留 true。code 稳定，2–63位小写字母起始、字母数字及分段连字符；name 去首尾空白且最长100；instructions 非空、最长8000 UTF-16单元、UTF-8不超过32768字节。模型 revision、目录版本与 CAS revision 为1..2147483647整数。输入字段1–20个，输出字段0–20个，json 输出至少一个字段；字段唯一，匹配 `[a-zA-Z][a-zA-Z0-9_]{0,47}`，禁用 `__proto__`、`constructor`、`prototype`。只支持 text/json 协议。

Skill 引用最多8个，按调用方数组顺序保存，每个 Skill 最多出现一次。服务端在同一事务中验证当前 Skill 属于当前会员及 Workspace、未删除，并将精确 revision 解析为 `AiPersonalSkillVersion.id`。客户端不能传 skillVersionId、最新版本别名、Skill 指令副本或产品 Skill code。当前 AF-154 Skill 没有 enabled/status 开关，“停用 Skill”拒绝路径指现有 deletedAt 墓碑；不凭空添加状态。历史只暴露 `{skillId,skillVersionId,revision}`，Skill 编辑或软删除不改写既有引用，读取历史不再连接可变 Skill 当前行。

所有路由使用 Cookie 与已验证 Workspace 上下文。`x-aij-workspace-id` 只是选择器；服务端复核会员、成员关系、角色、授权和 Workspace 的活动状态。读需 `workspace.ai.assets.read`，写需 `workspace.ai.assets.manage`。同空间其他 OWNER 也不能读取或修改他人的私有 Agent。所有写操作要求 Origin 精确等于服务端 webUrl，拒绝 cross-site。响应及拒绝均 no-store，并沿用全局 x-correlation-id；成功审计只含 ID、revision、action 与关联 ID，不含 prompt、名称或模型配置。

生命周期锁 → 项目/安装活动行锁 → 共享成员权限栅栏 → 本人资产配额锁 → 资产行锁（更新/删除）/目录与 Skill 共享锁。整个变更、不可变快照、绑定和审计在单个事务内；审计失败回滚全部。读也复核同一权限栅栏。最多100个活动 Agent/会员/空间。创建按本人 code 与最初内容及有序绑定精确重放，无额外版本或审计；不同初始内容409。重放仍核验当前模型目录和活动 Skill。更新先检查 CAS；完全相同配置为无写 no-op，过期 CAS 即使内容相同也409。

删除保留 code 占位和不可变历史；重复删除返回同一墓碑结果，不再检查旧 expectedRevision，仍要求有效会员/权限。已删资产与历史读取404，不能重建或恢复。数据库禁止修改、删除、TRUNCATE 版本/绑定，禁止当前行身份重写、墓碑恢复和物理删除。版本声明 skillBindingCount，提交时验证有序槽位完整，后续 INSERT 也无法改变绑定列表。该字段是内部完整性元数据，不是用户输入。所有外键 RESTRICT，完整修剪和恢复不在本卡内。

400 表示字段/协议/游标不合法，401未登录，403成员或权限/来源拒绝，404资产或私有 Skill 不可用，409 CAS/配额/code/目录绑定冲突，503基础设施或事务失败。错误不返回数据库文本、prompt 或资源所属会员信息。

SDK 提供 `createPersonalAgentsClient(api: ClientApi)`，方法为 modelOptions/create/get/list/update/delete/versions，每次显式传 workspaceId。复用现有 Cookie、no-store、Workspace header 和 ClientRequestFailure，未保存 token、租户或新增传输层。共享 index 导出由总控完成。

人工验收（总控接线并完成新隔离验收库后）：登录合成会员、建立 Workspace、授权 aiAssets、用私有 Skill revision 建 Agent；确认选项安全投影和默认 false；编辑 Skill 后查看 Agent 历史仍固定原版本；用另一个同空间 OWNER 与另一个空间验证404；测试 stale CAS、并发创建、100个上限、停用目录/角色/插件及审计故障回滚；删除后历史不可见且不能复活。无本卡页面可验收，无已运行访问地址。
