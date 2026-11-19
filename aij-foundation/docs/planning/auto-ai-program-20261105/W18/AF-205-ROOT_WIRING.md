# AF-205 root 接线要求（候选，非 CODE_VERIFIED）

唯一源码 `2ee9172a30be7694dc2cb097a43fbce1f0a14e65`；固定 W18 CONTRACT 来自主工作区只读文件。本文件是未执行的共享接线/DDL建议，Worker没有修改共享 owner、schema、migration、module、权限或registry。

## 原 owner 访问端口与锁

注册 AiPersonalWorkflowPublicationService，保留原 AiPersonalAgentSnapshotsService。新增实际 adapter extends 新service内导出的 PersonalWorkflowPublicationAccess，绑定 `{provide:PersonalWorkflowPublicationAccess,useExisting:Adapter}`。缺port安全503；缺snapshot owner禁止publish并对已发布read显示validator_unavailable，不可替换为descriptor/mock。

原 AiPersonalWorkflowsService 增加以下窄 INTERNAL 方法；adapter只委托，不调用draft public get/submit：

```ts
publicationWithCurrent<T>(scope: Scope, workflowId: string, permissions: readonly string[],
  authorize: SessionGate | undefined,
  operation: (tx: Prisma.TransactionClient, c: WorkflowPublicationCurrent) => Promise<T>): Promise<T>
publicationCurrentInTransaction(tx: Prisma.TransactionClient, scope: Scope, workflowId: string,
  permissions: readonly string[], authorize?: SessionGate): Promise<WorkflowPublicationCurrent>
```

withCurrent仅开一次原Prisma ReadCommitted事务（maxWait5000/timeout10000），在回调中调用transaction方法及operation，异常必须离开回调以真实rollback；外部统一HttpException/503。不重试。currentInTransaction仅用传入tx，不嵌套事务。

transaction方法复用原projectId、plugin lifecycle、active ProjectProfile/OrganizationProfile、enabled installation和WorkspaceContextService.assertWritePermissionInTransaction，对permissions每个元素逐一验证。publication HTTP按生命周期/project/org→成员/grants→scoped catalog config共享锁→workflow advisory/head→session；catalog锁为scope='project',scope_id=实际projectId,plugin_code='aij-ai',config_key=AI_CENTER_CONFIG_KEY FOR SHARE，锁后在workflow之前读AiCenterConfigurationService.current(tx)。runtime原Run owner已持有配置及生命周期锁，再重复读取不能在workflow之后新获取这些锁。

workflow advisory必须沿用 `pg_advisory_xact_lock(hashtextextended('ai-personal-workflows:'+workspaceId+':'+memberId,0))`，再调用原owned scoped head FOR UPDATE且deleted_at必须空。查当前immutable workflow version及binding，只JOIN immutable AgentVersion。禁止调用resolvePins、snapshots.resolve或Memory owner，禁止锁mutable Agent，否则runtime将倒置原Memory→Agent锁序。

不能仅相信现有version()输出：比较head/version code/name/revision/graph/content_digest/graph_digest，重算原validateWorkflowGraph canonical/digest；检查agent_binding_count、graph agentRefs与全部pin的node/agent/revision/version真实性，scope全部等于实际member/workspace。authorize(tx)在workflow锁之后调用（原session锁）。返回精确：

```ts
{projectId,workflowId:head.id,revision:head.revision,workflowVersionId:version.id,
 graphDigest:version.graph_digest,graph:version.graph,
 agentBindings:pins.map(p=>({nodeId:p.node_id,agentId:p.agent_id,revision:p.revision,agentVersionId:p.agent_version_id})),
 catalog:{version:catalog.version,catalog:catalog.catalog}}
```

保持原draft CRUD无AI catalog前提，不把publication接线加到普通CRUD scope。发布service已在同tx用原snapshots.resolve核对当前已发布Agent及模型/Skill依赖；历史pin不自动替换。runtime resolve仅验证workflow/head/version/binding及ref，返回冻结ref与graph keys复制；Agent当前性/epoch必须由原Run owner后续Memory→Agent解析后比对，不能在A runtime提前解析Agent。

## 精确 PostgreSQL 建议（未运行）

原owner IDs是TEXT（Prisma String无UUID native），新publication id才是UUID。Root在新隔离PG审定并执行migration：

```sql
ALTER TABLE public.ai_personal_workflow
 ADD COLUMN published_revision integer,
 ADD COLUMN publication_epoch integer NOT NULL DEFAULT 0,
 ADD CONSTRAINT ai_personal_workflow_publication_head_check CHECK (
  publication_epoch BETWEEN 0 AND 2147483647 AND
  (published_revision IS NULL OR (published_revision BETWEEN 1 AND revision AND publication_epoch > 0)));
ALTER TABLE public.ai_personal_workflow_version
 ADD CONSTRAINT ai_personal_workflow_version_publication_key
 UNIQUE (id,workflow_id,workspace_id,member_id,revision,graph_digest);
ALTER TABLE public.ai_personal_agent_version
 ADD CONSTRAINT ai_personal_agent_version_publication_key
 UNIQUE (id,agent_id,workspace_id,member_id,revision);
ALTER TABLE public.ai_personal_workflow_agent_binding
 ADD CONSTRAINT ai_personal_workflow_binding_publication_key
 UNIQUE (workflow_version_id,workspace_id,member_id,node_id,agent_version_id);
CREATE TABLE public.ai_personal_workflow_publication (
 id uuid PRIMARY KEY,
 project_id text NOT NULL,
 workspace_id text NOT NULL,
 member_id text NOT NULL,
 workflow_id text NOT NULL,
 workflow_version_id text NOT NULL,
 revision integer NOT NULL CHECK (revision BETWEEN 1 AND 2147483647),
 graph_digest varchar(64) NOT NULL CHECK (graph_digest ~ '^[0-9a-f]{64}$'),
 publication_epoch integer NOT NULL CHECK (publication_epoch BETWEEN 1 AND 2147483647),
 node_id varchar(48) NOT NULL CHECK (node_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,47}$'
  AND node_id NOT IN ('constructor','prototype','__proto__')),
 agent_id text NOT NULL,
 agent_version_id text NOT NULL,
 agent_revision integer NOT NULL CHECK (agent_revision BETWEEN 1 AND 2147483647),
 agent_publication_epoch integer NOT NULL CHECK (agent_publication_epoch BETWEEN 1 AND 2147483647),
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ai_personal_workflow_publication_uuid_check CHECK
  (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 CONSTRAINT ai_personal_workflow_publication_epoch_key UNIQUE (workflow_id,publication_epoch),
 CONSTRAINT ai_personal_workflow_publication_id_scope_key UNIQUE (id,project_id,workspace_id,member_id),
 CONSTRAINT ai_personal_workflow_publication_project_fkey FOREIGN KEY (project_id)
  REFERENCES public.project_profile(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_workflow_publication_owner_fkey FOREIGN KEY (workflow_id,workspace_id,member_id)
  REFERENCES public.ai_personal_workflow(id,workspace_id,member_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_workflow_publication_version_fkey
  FOREIGN KEY (workflow_version_id,workflow_id,workspace_id,member_id,revision,graph_digest)
  REFERENCES public.ai_personal_workflow_version(id,workflow_id,workspace_id,member_id,revision,graph_digest)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_workflow_publication_agent_fkey
  FOREIGN KEY (agent_version_id,agent_id,workspace_id,member_id,agent_revision)
  REFERENCES public.ai_personal_agent_version(id,agent_id,workspace_id,member_id,revision)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT ai_personal_workflow_publication_binding_fkey
  FOREIGN KEY (workflow_version_id,workspace_id,member_id,node_id,agent_version_id)
  REFERENCES public.ai_personal_workflow_agent_binding(workflow_version_id,workspace_id,member_id,node_id,agent_version_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX ai_personal_workflow_publication_owner_idx
 ON public.ai_personal_workflow_publication(workspace_id,member_id,workflow_id,publication_epoch);
CREATE FUNCTION public.aij_workflow_publication_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'immutable workflow publication' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER ai_personal_workflow_publication_no_mutation
 BEFORE UPDATE OR DELETE ON public.ai_personal_workflow_publication
 FOR EACH ROW EXECUTE FUNCTION public.aij_workflow_publication_immutable();
CREATE TRIGGER ai_personal_workflow_publication_no_truncate
 BEFORE TRUNCATE ON public.ai_personal_workflow_publication
 FOR EACH STATEMENT EXECUTE FUNCTION public.aij_workflow_publication_immutable();
```

Project由原owner派生且读取与publication project_id复核；原workflow无project列，不臆造slug。Agent epoch是历史值，不能FK mutable Agent epoch，否则撤销会破坏历史。撤销只head推进epoch，历史不删除；允许epoch有间隙。不增加阻止draft修改的head→旧version FK或阻止insert后CAS的错误约束。

Prisma精确映射：原AiPersonalWorkflow增加`publishedRevision Int? @map("published_revision")`和`publicationEpoch Int @default(0) @map("publication_epoch")`。新AiPersonalWorkflowPublication使用id String @id @db.Uuid；projectId/workspaceId/memberId/workflowId/workflowVersionId/agentId/agentVersionId均String，nodeId String @db.VarChar(48)，revision/publicationEpoch/agentRevision/agentPublicationEpoch均Int，graphDigest String @db.VarChar(64)，createdAt DateTime @default(now()) @db.Timestamp(3)，所有驼峰字段@map到SQL列；@@map("ai_personal_workflow_publication")。三个原表增加与DDL完全对应的复合@@unique，命名map同DDL。新表声明ProjectProfile relation、workflow scoped relation、version包含workflow/revision/digest relation、AgentVersion包含agent/revision relation、binding包含node/agentVersion relation，fields/references与上面SQL逐列一致；全部onDelete/onUpdate Restrict，原model加具名reverse arrays。@@unique([workflowId,publicationEpoch])、@@unique([id,projectId,workspaceId,memberId])及owner index的map名称同DDL。若复合重叠关系导致Prisma验证限制，可保留scalar-only model和完整raw DDL FKs，但绝不省略数据库约束；CHECK与触发器不可用Prisma DSL替代。AF206需要额外origin FK unique key时由root协调。

## 权限、HTTP 与下游

Root注册workspace.ai.workflows.publish / workspace.ai.workflows.execute精确定义，仅active系统OWNER增量授权，不复活禁用定义或软删grant。service已逐方法传权限：read=ai.assets.read；publish/unpublish=ai.assets.manage+publish；runtime resolve=ai.assets.read+ai.execute+execute。

AF206 WorkflowPublicationRuntimePort useExisting此service或窄adapter，调用resolveInTransaction(tx,scope,publicationId,authorize?)；AF207 publications port同理。每次HTTP传原ClientAuthService.assertSessionInTransaction(tx,claims)闭包，claims不在DTO。runtime用原stored session复检；原Run解析snapshot后核对ref agent/version/revision/publicationVersion，在dispatch三个阶段按合同复检。不通过A.runtime提前锁Agent补救缺失B接线。

HTTP bootstrap需在/client/workflow-executions整个prefix普通JSON middleware前装严格UTF8/重复键解析；本DTO导出parseWorkflowPublicationJson，已解析对象无法恢复重复键。现有原graph parser复用。Unknown key/prototype/getter/非有限/越界数固定错误不回显。

## Root真实门禁仍 NOT_RUN

新隔离PG DDL/migrate/schema generate、原owner adapter/session权限、immutable UPDATE/DELETE/TRUNCATE与scoped FK拒绝、真实事务audit rollback、并发publish/unpublish/CAS/ABA、draft/version/digest/binding拒绝、Agent/Skill/catalog撤销与锁序、原Run/provider IO/lease/unknown/cleanup、AF206/207及installed packed SDK、适用lint/types/build/regression和注册verify:task。Worker协作者测试不证明PG隔离/并发/真实provider成功。全40/native14/vendor/Owner不推定通过，真实credentials空。

可直接采用的 scalar-only Prisma 映射如下（上述所有SQL FK/CHECK/trigger仍强制保留；不依赖新Prisma relation生成SQL）：

```prisma
model AiPersonalWorkflowPublication {
  id String @id @db.Uuid
  projectId String @map("project_id")
  workspaceId String @map("workspace_id")
  memberId String @map("member_id")
  workflowId String @map("workflow_id")
  workflowVersionId String @map("workflow_version_id")
  revision Int
  graphDigest String @db.VarChar(64) @map("graph_digest")
  publicationEpoch Int @map("publication_epoch")
  nodeId String @db.VarChar(48) @map("node_id")
  agentId String @map("agent_id")
  agentVersionId String @map("agent_version_id")
  agentRevision Int @map("agent_revision")
  agentPublicationEpoch Int @map("agent_publication_epoch")
  createdAt DateTime @default(now()) @db.Timestamp(3) @map("created_at")
  @@unique([workflowId, publicationEpoch], map: "ai_personal_workflow_publication_epoch_key")
  @@unique([id, projectId, workspaceId, memberId], map: "ai_personal_workflow_publication_id_scope_key")
  @@index([workspaceId, memberId, workflowId, publicationEpoch], map: "ai_personal_workflow_publication_owner_idx")
  @@map("ai_personal_workflow_publication")
}
```

三个原model对应新增精确unique DSL分别为：

```prisma
// AiPersonalWorkflowVersion
@@unique([id, workflowId, workspaceId, memberId, revision, graphDigest], map: "ai_personal_workflow_version_publication_key")
// AiPersonalAgentVersion
@@unique([id, agentId, workspaceId, memberId, revision], map: "ai_personal_agent_version_publication_key")
// AiPersonalWorkflowAgentBinding
@@unique([workflowVersionId, workspaceId, memberId, nodeId, agentVersionId], map: "ai_personal_workflow_binding_publication_key")
```

## R1 查询权限勘误（优先于上文冲突句）

已只读核对root更新CONTRACT SHA256 `b2340b8926523bfaf435ef0d21938ba25adbbfa9d8ecc22496709d4d38b532da`。原契约让GET经执行resolver隐式要求ai.execute，root明确认定为契约缺陷；旧候选/记录保留。

实际AiPersonalWorkflowPublicationService现新增：

```ts
resolveForReadInTransaction(tx: Prisma.TransactionClient, scope: Scope, publicationId: string,
  authorize?: SessionGate): Promise<{projectId:string;ref:WorkflowRef;inputFields:string[]}>
```

此方法权限精确为`['ai.assets.read','ai.read','workspace.ai.workflows.execute']`，与原resolveInTransaction共享私有resolveCurrentPublication全部publication/current workflow/epoch/version/binding/project/session/编译检查以及workflow-only锁。原resolveInTransaction权限仍精确为`['ai.assets.read','ai.execute','workspace.ai.workflows.execute']`；public方法无caller模式参数，无403捕获后降级/重试。两方法都不调用snapshots或访问Agent/Memory；原owner access adapter签名不变，须原样验证传入permissions全部元素。

Root让AF206 WorkflowPublicationRuntimePort增加同名resolveForReadInTransaction，实际adapter/useExisting须暴露此方法；AF206 resolveReadOrigin仅调用读取resolver，RunsService.read/recover前后短事务使用该读取来源核验。Submit、preview、admission/dispatch/recordOrigin/assertOriginCurrent仍用原执行resolver，不能绕过ai.execute。Metadata.read仍只有ai.assets.read；publish/unpublish不变。Root实际PG/HTTP须验证ai.read有而ai.execute无的GET成功、缺ai.read拒绝、运行期/submit/preview缺ai.execute拒绝，provider/入队/预占不能由GET产生；这些仍NOT_RUN，Worker小协作者测试不是实际HTTP或PG证据。
