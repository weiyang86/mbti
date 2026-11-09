# AF-231 root 接线说明

候选只新增共享 owner、声明、离线行为测试和本说明；旧文件未改。以下接线归 root，候选不构成 CODE_VERIFIED。不要把 source-only bootstrap 整段 merge/cherry-pick 到 root；root 只接收候选提交的五个 allowPaths。

## 原 personal-agent owner 的最小替换

目标是 `apps/web/app/components/client-personal-agent-run-state.mjs`（及其 `.d.mts`），不是增加一个并存的 bucket。

1. 从 `./client-personal-agent-request-journal.mjs` 导入以下实际实现；删掉原私有 `class JournalError`、`entryKeys`、`journalKey`、`same`、`parsePersonalJournal` 实现块。原 `InvalidResponse`、preview/run 校验和公开 controller 方法继续由原 owner 维护。

```js
import {
  PersonalRequestJournalError as JournalError,
  personalJournalKey, parsePersonalJournal,
  samePersonalJournalEntry as same, findPersonalJournalEntry,
  createPersonalRequestJournalStorage
} from "./client-personal-agent-request-journal.mjs";
export { personalJournalKey, parsePersonalJournal };
```

2. 在 `createPersonalAgentRun` 内只创建一次 storage facade，复用原注入的 storage/lock。把私有 `readEntries`、`find`、`locked`、`cas` 换成下面的薄适配。原 `same` 调用会命中新共享 owner；这里禁止保留旧手写 CAS 备用路径。

```js
const recoveryStorage = createPersonalRequestJournalStorage({ journalStorage, withRecoveryLock });
const legacySelector = t => ({ family: "personal-agent", workspaceId: t.workspaceId, agentId });
function readEntries(t) {
  return recoveryStorage.read(t.memberId, () => current(t));
}
const find = (entries, t) => findPersonalJournalEntry(entries, legacySelector(t));
async function locked(t, fn) {
  try { return await recoveryStorage.locked(t.memberId, () => current(t), fn); }
  catch (e) { if (!current(t)) return null; throw e; }
}
function cas(t, expected, replacement) {
  if (!current(t)) return false;
  return recoveryStorage.compareExchange(t.memberId, legacySelector(t), expected, replacement, () => current(t));
}
```

`JournalError` 的别名使原 `personalRunIssue`/storageBlocked 错误分流继续匹配实际新错误类型。`find` 必须带 `family:'personal-agent'`；旧 controller 不得把 document-generation entry 交给原 generic recover/read/newTask，也不得删除它。旧 8 键 entry 仍不带 family；文档 entry 精确为旧 8 键加 family/origin/attempted。原 `.d.mts` 的公开 parse 返回值需引用新 `PersonalJournalEntry[]`，旧 controller 的 state.journal 继续是 legacy entry；按实际编译修正类型，不能靠断言把 document entry 当 legacy。

## 文档生成端口

在原 document composition 的固定生命周期中创建一个 `createDocumentGenerationJournal({journalStorage,withRecoveryLock})`，将同实例注入 generation controller。不要按 document/section/Agent/contextKey 重建 journal，不要添加新 key；原 key 前缀 `aij.client.personal-agent.pending.v1:`、version 1、16384 字符和 32 entry 上限已固定。

`withRecoveryLock` 要复用原真实 `navigator.locks.request(name, {mode:'exclusive'}, fn)` 适配；不要在缺锁时直接执行回调。所有 family 共用 `personalJournalKey(memberId)` 锁名。每 member/workspace 的 document entry 只有一个；变更文档/章节/Agent 不产生绕过未决请求的新入口。

调用参数使用精确 `{memberId,workspaceId}` owner，不直接传含 role/session/source 等额外键的 AuthPin。数据输入经过 own data descriptor、原型、精确键、完整 W24 ref 校验；不接受 getter/隐藏键/Symbol/混入正文。`getSnapshot` 仅返回当前 RAM 元数据；创建、subscribe、suspend 都不自动 load 或请求。

`submitOnce` 在同锁中写入 attempted 并逐字读回、再比较完整 entry 后才调用一次 send。send 抛错、丢响应、timeout/abort、晚到成功都不清除原 entry；相同 workspace 的已有 entry 返回 null 并发布原元数据。传入 controller 的当前 AbortSignal（包括其有界 timeout）；send 闭包只调用一次原 SDK submit，保留原 key。journal 自己不发 HTTP、不重试、不做预算账本。

显式 recover：先当前 scope 验证，再 `load`，用 entry.key 调原 SDK recover，当前 scope 再验证，最后 `bind`。bind 接精确 `{runId,status,origin}`；runId 一旦绑定不能换，origin/完整 expected 的任何不一致都拒绝。不要通过 bind 恢复私有输入或输出。

ACK：`acknowledgeTerminal(expected, verify, signal)` 的 verify 闭包每次都重新当前 scope 验证并按 **expected.key** 调原 SDK recover，再核验当前 scope。journal 不接受缓存 response 作为重新请求的替身；仅与已绑定 runId、完整 origin 匹配的 succeeded/settled 或 failed/released 能 CAS 删除此条。未绑定的 unconfirmed、unknown/reserved、404/410、失败、不匹配均保留；documentCurrent=false 的真实安全终态只允许结束 journal，绝不授权正文读取。输出展示继续由 controller/当前 SDK read 的授权路径决定。

blur/hidden/pagehide/unmount/storage event、owner/auth/source/context 变化时，root 同步 suspend generation controller 与 journal，并清父私有内容。journal.suspend 取消 epoch、清 RAM、保留持久 entry；其后的恢复必须是明确 load。不要调用 storage.removeItem/清 bucket 来恢复提交资格。

## root 接收与验证

候选离线用 Node 24.21.0 原生 Web Locks + 同步 StorageLike backend，CAS/read/locked 均为实际新实现。26 测试覆盖双实例竞争、旧 8 键/混合 family、严格 ref/descriptors、完整 CAS、存储/缺锁/写后不一致零 send、所有 run 状态、abort/timeout/late/suspend、ACK 新核验和并发冲突；不是浏览器 localStorage 或 API/PG 验收。

root 必须完成实际旧文件导入替换后再跑原个人 Agent/journal/controller 回归；候选跑过未改旧文件的 21 项基线测试，不能代称已接线通过。正式 registry/verify:task、queue、文档状态只由 root 更新，正式 I231 依赖实际集成 Task ID；后续 I232/I233 不能引用候选 Task 充当已验证依赖。root 按 CONTRACT 调度真实浏览器 Web Storage/Web Locks、API/隔离 PG/runtime、必要构建/native 和真实权限拒绝，未运行保持 NOT_RUN，出口 OWNER_CHECK_PENDING。W23/W24 人工验收仍 PENDING，40 项历史目标不改为通过。
