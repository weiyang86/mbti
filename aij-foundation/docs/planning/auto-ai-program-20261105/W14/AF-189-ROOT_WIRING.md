# AF-189 总控独占接线与真实验收

候选阶段，不是 CODE_VERIFIED。Worker 只新增 allowPaths 文件；不修改 schema/module/index/registry/queue/旧 owner/旧 fixture。本清单每项均是总控接收前的真实工作，缺失时不得把本卡或 I-* 集成 Task 标记完成。

## 1. 来源与集成方式

- 注册 Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W14-AF189`
- Worktree instance：`932c6bf1-793d-4059-8d04-b6d84cc70605`
- Worker Task `task_f0b0db63303c` / Dispatch `ctx_a4396000c292` / terminal `term_99b4b40b-39e9-4dd9-9f13-a06aa225e936`
- branch `weiyang86/AIJ-W14-AF189`；初始 clean HEAD/origin94 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；remote `git@github.com:weiyang86/aij-foundation.git`
- 只读 source commit `b434da8ba34f03b07b83f03be19b20061bb92fa9`
- source manifest SHA256 `995f2af4cbfb2fa8ca60ebcb7e66d03f4f5466190edee57ad646e6e32d4138d3`，773 blobs 全部验证；单独 bootstrap commit `d8e31f323acbe6c18180f0875fc50d9df2fbe0fb`
- 总控只接收 bootstrap 之后的候选提交（见执行记录/worker_done）；禁止把 bootstrap commit 集入 dev。Worker 停止写入后可精确 cherry-pick 候选差异。

## 2. Schema / 迁移（同一 owner，默认全部未发布）

在现有 `AiPersonalAgent` 增加：

```prisma
publishedRevision Int? @map("published_revision")
publicationVersion Int @default(0) @map("publication_version")
```

新迁移仅 ALTER 现有 `public.ai_personal_agent`：

```sql
ALTER TABLE public.ai_personal_agent
  ADD COLUMN published_revision integer NULL,
  ADD COLUMN publication_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT ai_personal_agent_publication_version_nonnegative CHECK (publication_version >= 0),
  ADD CONSTRAINT ai_personal_agent_publication_current CHECK (
    published_revision IS NULL OR
    (published_revision = revision AND enabled AND deleted_at IS NULL AND publication_version > 0)
  );
```

不要将旧 enabled head 自动发布，不给 authored version 表增加重复的 publication 真值。只允许新隔离空验收库，按现有数据库保护核验目标，正式 schema/迁移/生成由总控串行执行。

## 3. INTERNAL 原 resolver 校验因子与 DI

`AiPersonalAgentSnapshotsService.resolve(tx,current,member,workspace,id,revision)` 当前返回 `agent.published:true`（b434 原实现）。须在相同 owner 提取以下内部方法，不能复制模型/Skill 真值、增加 public skipPublished/body snapshot 参数：

```ts
// INTERNAL server method only. Same original validation, actual head publication metadata.
validateDependencies(tx: Prisma.TransactionClient,
  current: { version: number; catalog: AiCenterCatalog },
  member: string, workspace: string, id: string, revision: number): Promise<AiAgentSnapshot>
```

保留全部原有 checks：当前 enabled head、UUID namespace、head/authored version 完全匹配、skill_binding_count/position/唯一性、自己的未删除 Skill 与 immutable pin、受限正文校验、当前 text model/catalog/provider/vendor/protocol 既有规则。`agent.published` 必须来自 `a.published_revision===a.revision`；source 增加确切 `publicationVersion: a.publication_version`（非负 integer；已发布至少 1）。读取 `published_revision/publication_version` 和验证都在已有 Agent 行锁中完成。原 `resolve` 调用这个 helper，随后断言 published 和 epoch 有效，未发布返回确定 409；不能保留 unconditional true。

在 root 新增或同文件定义内部 adapter：

```ts
@Injectable()
class RootPersonalAgentPublicationValidator extends PersonalAgentPublicationValidator {
  constructor(private readonly config: AiCenterConfigurationService,
    private readonly snapshots: AiPersonalAgentSnapshotsService) { super(); }
  async validate(tx: Prisma.TransactionClient, s: PublicationValidationScope): Promise<void> {
    // Publication service has already locked the exact project scoped_config row.
    const current = await this.config.current(tx);
    await this.snapshots.validateDependencies(tx, current, s.memberId, s.workspaceId, s.agentId, s.revision);
  }
}
```

adapter 只复用可信 resolver，不调用 credentials/budget/Run/Job。current() 的 BadRequest/配置语法异常须按原 owner 的安全规则映射 409，不能泄漏原错误或替代读取成功。adapter 对其他项目需明确拒绝（current() 使用同一已核验 projectId）；scope.projectId 不能成为客户端覆盖值。

`ai-runtime.module.ts` 加 `AiPersonalAgentPublicationsController`、`AiPersonalAgentPublicationsService` 及 `{ provide: PersonalAgentPublicationValidator, useClass: RootPersonalAgentPublicationValidator }`；保留现有 no-store guard、Workspace guard/auth/error owner。bootstrap 已有 `personalAgentRunPreviewNoStore` 覆盖整个个人 Agent 前缀，须确认在 parser/auth 前执行，包含 malformed/401/403/413；不要添加第二套错误处理。

锁顺序与现有 owner 兼容：project/org/plugin → membership advisory + 当前成员/空间/角色/grant shared locks → `ai-personal-agents:<workspace>:<member>` advisory（authoring/publication）→ exact catalog SHARE → owned head UPDATE/SHARE → immutable version/owned pins。原 authoring update 当前 owned→catalog，请总控统一检查整个 owner（包含 config save、Skill delete、memory、Run 的 Job→Run→Agent 锁），不要只针对新服务局部改锁。成员 advisory 在 TX 中保留，不能将权限校验移到事务外。

## 4. 原 head authoring invalidation 与执行 ABA

`AiPersonalAgentsService`：

- create 依赖 DB default NULL/0，不自动 publish。
- update 仅通过原 content 深等 no-op 之后发生实际变更时，原 UPDATE 中同时 `published_revision=NULL, publication_version=publication_version+1`；revision 仍仅 authored 变更递增。检查两个 int 上限；不能先独立撤销再写 head。
- disable 已在真实 update 中，按同一规则处理。
- delete 原 UPDATE 中同时撤销并递增 epoch。重复已删除 no-op 不加 epoch/audit。
- immutable version 不加 publication 真值、不重写历史内容；publishing 不触发 snapshot()/authored version insert。root SQL constraint 与 UPDATE 必须一起接入，否则旧 update 会被正确拒绝。

`PersonalAgentProvenance` 和 snapshot/source 类型在现有 owner 加 required `publicationVersion:number`。Run admission 在服务端 resolver 得到 snapshot 时冻结 epoch，caller DTO 仍是 input/idempotencyKey/expectedRevision，禁止新增客户端 publicationVersion 或 preview ticket。

`AiCenterRunService.validateSnapshot` 的 personal 分支：先要求 `Number.isInteger(s.source.publicationVersion) && s.source.publicationVersion>=1`，缺字段/非法 legacy epoch 拒绝；通过原 resolver 读取当前已发布状态后比较 `actual.source.publicationVersion===s.source.publicationVersion`。原 deepStrictEqual 必须继续比较 epoch；仅原 memoryRefs 扩展可按既有方式剥除，禁止删除 publicationVersion 后比较。Unpublish→republish 同 authored revision 必须 ABA 拒绝旧 queued snapshot，且发生在任何 credential resolve/upstream 之前。

保持现有调用点在初次执行和 credential IO 后都执行当前权益验证；**新增现有 post-provider-IO 成功结算事务中的完整当前校验**，不能仅 lockRun/status 后直接 settle：

```ts
// Follow the SAME admission/lifecycle -> Job -> Run -> Agent order used before IO.
const current = await this.admissionContext(tx, run.memberId, run.workspaceId, !!s.source);
const { run: r } = await this.lockRun(tx, id, job);
// preserve all original status/expiry/nonce/attempt/snapshot checks
if (!isDeepStrictEqual(r.snapshot, s)) throw new Error('AI_CONFIGURATION_CHANGED');
await this.validateSnapshot(tx, current, r, s);
await this.lockRun(tx, id, job); // preserve original fence after waiting on dependencies
// ONLY THEN existing budget.settle/Trace.succeed/Run success in SAME tx
```

post-IO publication/member/role/plugin revocation 不得结算或释放已尝试任务为“未执行”，应沿用原 attempted failure→unknown/reserved，不输出 stale result。保持原 nonce/admission/idempotency/unknown 策略和唯一成本 owner，旧 completed/unknown 请求不自动 rerun，也不要把 epoch 添加到现有 requestHash 改变旧幂等语义。

## 5. SDK 公共组合与现有 UI

root `packages/sdk/src/index.ts` 导出 `createPersonalAgentPublicationsClient`、`parsePersonalAgentPublication` 与新文件 public types。实现是 new SDK file；worker 未添加 index 导出，故当前未声称 packed SDK 可用。实际 build/pack 后 CJS、ESM 都必须包含真实 factory，独立 consumer 使用两个真正 tarballs，不允许 runtime source import bypass。

在 `client-agent-library.tsx` 已有 state.detail 的详情区、非历史区嵌入 `ClientAgentPublication`。不新增 editor/route/菜单/全局样式/依赖。建议 root 稳定创建 public SDK factory：

```ts
const publicationApi = useMemo(() => createPersonalAgentPublicationsClient(clientApi), []);
<ClientAgentPublication api={publicationApi} agentId={state.detail.id}
  scope={{ workspaceId: state.workspaceId, memberId: state.principal.id,
    sessionKey: verifiedSessionGeneration, roleKey: verifiedRoleId,
    revalidationKey: verifiedContextGeneration, permissions: state.context.permissions }}
  revalidate={revalidateCurrentPublicationScope}
  onDebug={() => router.push(`/client/agents/${encodeURIComponent(state.detail.id)}/run?workspaceId=${encodeURIComponent(state.workspaceId)}`)} />
```

示意中的 identity 字段须从真实当前 state shape 接入，不能编造 principal.id/session。`revalidateCurrentPublicationScope()` 每次读取实际 Cookie session + 当前 Workspace context，返回完整同一身份 scope；发现角色/会话变化时返回新代数并先清除父级元数据/草稿，禁止返回闭包缓存充当 revalidation。sessionKey 是本页不透明代数，禁止真实 Cookie/JWT。重复校验同一身份不能每次递增 revalidationKey，否则所有操作都会被正确拒绝。新 session/role/grant/context 变化即更换 key；API/callback props 稳定，异步旧闭包不准入。

组件自身每次读取前后、每次 mutation 前后校验 scope，确认前再 GET 比对双 CAS；focus/blur/pagehide/visibility/unmount 清空并 fence。未知结果无自动 retry，必须明确 read+ack，再发起新的确认。readonly 隐藏动作，API 权限仍独立核验。debug 按钮仅在新 GET 和 scope 校验后进入既有 run 页面；原 run 页面必须在 unpublished 返回安全 409 提示并禁发起新任务（历史任务仍按原 read 权限恢复）。

## 6. Root-only 真实 harness 与不可跳过验收

`personal-agent-publications-live.test.mjs` 不带 skip，`AIJ_AF189_ROOT_LIVE` 未设或 native adapter 缺失即 FAIL。Worker 不执行它，不启动 DB/API/browser。

总控先登记 AF-189 的验证任务/新隔离 acceptance lease，更新 `remaining-client-fixture.mjs` 中真实 plugin lifecycle task allowlist（不能走 rawSQL enabled fallback），使用实际 migrated schema 和实际 API/package build；不得降低 database target 保护。root-only runtime fixture/script 必须存活到 finally 全部 app/socket/pool 关闭并断言 pools0。

harness 自行 pnpm pack contracts/sdk，再在新 consumer 下用实际两个 tgz offline npm install（无 symlink/source fallback），同时核对 CJS/ESM factory；测试使用实际 Cookie/API，所有 publication mutations 均真实 POST，禁止 rawSQL fakepublished。

原生 adapter `AIJ_AF189_NATIVE_ADAPTER=/.../.artifacts/.../native-publications.mjs` 必须由总控使用现有真实 native/browser 验收工具实现：

```ts
export async function runNativePublicationAcceptance({
  fixture, agent, publication, mutate, request, folder, execute, expectedCases
}) {
  // Real native UI interactions/evidence. No return-only marker implementation.
  return { cases: {
    publishRunUnpublish: { status: 'PASS', screenshots: ['/absolute/real.png'] },
    readonly: { status: 'PASS', screenshots: [...] },
    casIntent: { status: 'PASS', screenshots: [...] },
    unknownReadAcknowledge: { status: 'PASS', screenshots: [...] },
    scopeSessionRoleRace: { status: 'PASS', screenshots: [...] },
    nativeFocusUnmount: { status: 'PASS', screenshots: [...] }
  }, documentHidden: 'NOT_PROVEN' };
}
```

不能把调用 page JS focus/伪造 visibility event 视为 native OS focus/true document-hidden。真正 document-hidden 和 OS file picker 没有证据时保持 NOT_PROVEN，不重新申请/修改系统权限。

harness 已包含：精确 DTO/no-store/Origin/foreign/readonly 拒绝、0 durable change hashes、packed SDK、CAS/no-op、实际 PG 事务 audit rollback、历史版本不变、真实 publish→run success、unpublish refusal、queued ABA 前 credential/upstream0、legacy absent epoch refusal、真实 head edit/disable invalidation、Skill 删除和角色状态拒绝、postIO unpublish 无结算、同 worker 旧 nonce 拒绝及 pool0。harness 另包含真实 catalog 变化、project/org/plugin status/lifecycle、membership status 和 delete invalidation，以及 postIO role 撤权；总控仍须补全/复跑适用并发门禁、真实 session 撤权、memory/workflow/private Agent 历史回归及 postIO member/plugin 撤权，不能用离线 stub 代替。

原有 `personal-agent-runs-live.test.mjs`、`personal-agent-memory-live.test.mjs`、`client-personal-agent-run-live.test.mjs`、preview/agent 实例及真实 memory/workflow fixture 中，凡期望执行成功的私有 head 都必须先读 publication 双 CAS 并 POST publish；每次实际修改后重新走真实发布 API。未发布 preview 可选择已知 409，需与当前 UI 兼容；不要将原失败测试一律改成允许任意状态。

正式 `verify:task AF-189`、数据库/浏览器/runtime/整体构建和回归均由总控串行完成并保留失败/修复后结果；记录真实 I-* Task ID 供下游依赖，然后更新正式队列/执行记录、按原题名本地集成提交及按已授权 root 批次策略处理 push/SHA 回读。候选提交不代表这些已完成。

## 7. 已知 bootstrap 声明缺口（必须保留失败证据）

首次完整传递 noEmit 失败：`apps/api/src/rbac/permissions.service.ts` 导入的 `scripts/dictionary-policy.cjs` 已实现 `dictionaryEffectivePermissions`，但 origin94 的 `scripts/dictionary-policy.d.cts` 缺少其导出声明。该 `.d.cts` 不在 Worker allowPaths，Worker 保留原文件。root 修复/恢复可信声明后再运行整体编译；建议签名 `dictionaryEffectivePermissions(granted: readonly string[], activeCodes: readonly string[]): string[]`，并按原 module 现有 exports 同步只读 code/definition 声明。`.artifacts/af189/tests-before.log` 保存首次失败，`compiler.json` 继续显式报告 wholeCompilation=FAIL，候选专属 diagnostics 为空不能冒充整体通过。
