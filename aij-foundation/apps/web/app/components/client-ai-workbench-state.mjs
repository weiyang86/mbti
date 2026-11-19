// UI state only. Runs, authorization, execution and cost remain server-owned.
const EXECUTE = "workspace.ai.execute", READ = "workspace.ai.read";
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const code = value => typeof value === "string" && /^[a-z][a-z0-9-]{1,62}$/.test(value);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.every(v => typeof v === "string");
const money = value => typeof value === "string" && /^\d{1,30}$/.test(value);
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const safeTerminal = run => run?.status === "succeeded" && run.budgetStatus === "settled" || run?.status === "failed" && run.budgetStatus === "released";
const consistent = run => safeTerminal(run) || ["queued", "running", "unknown"].includes(run.status) && run.budgetStatus === "reserved";
const journalFields = ["memberId", "workspaceId", "agentCode", "key", "digest", "runId", "status"];
const sameEntry = (a, b) => a && b ? journalFields.every(key => a[key] === b[key]) : !a && !b;
class ResponseError extends Error {}
class RecoveryError extends Error {}
const invalid = () => { throw new ResponseError("Invalid workbench response"); };

export function parseAgents(value) {
  if (!Array.isArray(value) || value.some(a => !record(a) || !code(a.code) || typeof a.name !== "string" ||
    !Number.isInteger(a.revision) || a.revision < 1 || !strings(a.inputFields) || !a.inputFields.length || a.inputFields.length > 20 ||
    a.inputFields.some(k => !/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(k) || ["constructor", "prototype", "__proto__"].includes(k)) || new Set(a.inputFields).size !== a.inputFields.length ||
    !["text", "json"].includes(a.outputFormat) || !["text", "image"].includes(a.capability) || !money(a.maximumEstimatedCostNanos)) ||
    new Set(value.map(a => a.code)).size !== value.length) invalid();
  return value;
}

export function parseRun(value, expected = {}) {
  if (!record(value) || !id(value.id) || !code(value.agentCode) ||
    !["queued", "running", "succeeded", "failed", "unknown"].includes(value.status) ||
    !(value.failureCode === null || typeof value.failureCode === "string") || !money(value.estimatedCostNanos) ||
    !consistent(value) ||
    !(value.imageAssetId === null || id(value.imageAssetId)) || !date(value.createdAt) || !date(value.expiresAt) ||
    !("output" in value) || (value.status === "succeeded" && value.output === null) ||
    (expected.id && value.id !== expected.id) || (expected.agentCode && value.agentCode !== expected.agentCode)) invalid();
  return value;
}

/** AF145 returns a narrow reference, never an AiAgentRunResult or output. */
export function parseRecoveryReference(value, expected = {}) {
  if (!record(value) || Object.keys(value).sort().join() !== "agentCode,budgetStatus,contentAvailable,createdAt,expiresAt,id,status" ||
    !id(value.id) || !code(value.agentCode) || !consistent(value) || typeof value.contentAvailable !== "boolean" ||
    ![value.createdAt, value.expiresAt].every(v => date(v) && new Date(v).toISOString() === v) ||
    Date.parse(value.expiresAt) <= Date.parse(value.createdAt) ||
    (expected.runId && value.id !== expected.runId) || (expected.agentCode && value.agentCode !== expected.agentCode)) invalid();
  return value;
}

export function describeRun(run) {
  const states = {
    queued: ["等待处理", "任务已入队，等待服务端执行。", "info"],
    running: ["正在执行", "服务端正在处理任务。", "info"],
    succeeded: ["已完成", "结果由服务端任务返回。", "success"],
    failed: ["执行失败", "任务未能完成。请检查配置与权限后再发起新任务。", "error"],
    unknown: ["结果未知", "上游可能已执行，费用仍可能预留。请核对原任务，避免重复执行。", "warning"]
  };
  const [label, message, tone] = states[run.status] ?? ["响应不可识别", "请重新读取原任务。", "error"];
  return { label, message, tone, active: ["queued", "running"].includes(run.status) };
}

export function requestIssue(error, operation = "load") {
  const status = typeof error?.status === "number" ? error.status : 0;
  if (error instanceof RecoveryError) return { kind: "recovery", status, message: error.message };
  if (error instanceof ResponseError) return { kind: "invalid-response", status, message: "服务端响应与任务契约不一致，请重试读取；未把它视为成功或排队。" };
  const messages = {
    400: ["input", "输入未通过校验，请检查 Agent 参数。"],
    401: ["unauthorized", "登录已失效，请重新登录。"],
    403: ["forbidden", "当前账号无权访问此空间或执行该操作，请重新验证权限。"],
    404: ["unavailable", "Agent、模型或任务当前不可用；请刷新确认配置与记录。"],
    409: ["conflict", "请求标识或当前状态发生冲突，请核对原任务；不要自动重试执行。"],
    410: ["expired", "任务内容已过保留期，无法继续读取。"],
    503: ["service-unavailable", "AI 服务暂不可用，可能尚未配置或执行策略已关闭。当前接口不提供具体原因，请联系管理员确认。"]
  };
  const [kind, message] = messages[status] ?? ["network", "请求未能完成，请稍后重试。"];
  return { kind, status, message: operation === "submit" && ![400, 401, 403, 404, 409, 410].includes(status)
    ? `${message} 提交结果尚未确认；再次确认会沿用原请求标识。` : message };
}

const initial = () => ({ phase: "loading", principal: null, workspaces: [], workspaceId: "", context: null,
  agents: [], agentCode: "", input: {}, run: null, issue: null, submitting: false, reading: false,
  submissionUnconfirmed: false, polling: false, pollPaused: false, imageBlob: null, imageLoading: false,
  recovery: null, recoveryReference: null, recoveryNeedsInput: false, recoveryBlocked: false, contentUnavailable: false });

/** The SDK factory is injected so every SDK request uses this scope's abort signal. */
export function createWorkbench({ request, aiClientFactory, aiRecoveryClientFactory, requestImage, onUnauthorized = () => {},
  journalStorage, withRecoveryLock = (_name, fn) => fn(),
  makeKey = () => globalThis.crypto.randomUUID(), schedule = (fn, ms) => setTimeout(fn, ms),
  unschedule = timer => clearTimeout(timer), pollInterval = 1500, maxPolls = 120 }) {
  let state = initial(), generation = 0, abort = new AbortController(), disposed = false;
  let timer = null, attempt = null, pollCount = 0;
  // Only opaque metadata is persisted. Private inputs are discarded on scope changes.
  const pending = new Map(), volatileInputs = new Map();
  const scopeKey = (memberId, workspaceId) => JSON.stringify([memberId, workspaceId]);
  const bucketKey = memberId => `aij.client.ai.pending.v1:${memberId}`;
  const recoveryFailure = () => {
    publish({ recoveryBlocked: true });
    throw new RecoveryError("无法保存或校验任务恢复记录，已阻止新提交。请恢复浏览器存储后重新验证，或联系管理员核对原任务。");
  };
  function entries(memberId) {
    try {
      const raw = journalStorage?.().getItem(bucketKey(memberId));
      const stored = raw === null || raw === undefined ? [] : JSON.parse(raw);
      if (!Array.isArray(stored) || stored.some(e => !record(e) || e.memberId !== memberId || !id(e.workspaceId) || !code(e.agentCode) ||
        Object.keys(e).sort().join() !== "agentCode,digest,key,memberId,runId,status,workspaceId" ||
        !["unconfirmed", "queued", "running", "unknown"].includes(e.status) ||
        !(e.runId === null || id(e.runId)) || (e.status === "unconfirmed" ? e.runId !== null : !e.runId) ||
        !((e.key === null && e.digest === null && e.runId) || (typeof e.key === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(e.key) && typeof e.digest === "string" && /^[a-f0-9]{64}$/.test(e.digest))))) throw new Error();
      if (new Set(stored.map(e => e.workspaceId)).size !== stored.length) throw new Error();
      // Persistent storage is authoritative: a removed entry must never be
      // resurrected from another page's stale in-memory cache.
      if (!journalStorage) return [...pending.values()].filter(e => e.memberId === memberId);
      for (const [key, e] of pending) if (e.memberId === memberId) pending.delete(key);
      for (const e of stored) pending.set(scopeKey(memberId, e.workspaceId), e);
      return stored;
    } catch { return recoveryFailure(); }
  }
  function putPending(memberId, workspaceId, entry) {
    const next = entries(memberId).filter(e => e.workspaceId !== workspaceId);
    if (entry) next.push(entry);
    try { journalStorage?.().setItem(bucketKey(memberId), JSON.stringify(next)); }
    catch { return recoveryFailure(); }
    const key = scopeKey(memberId, workspaceId);
    if (entry) pending.set(key, entry); else { pending.delete(key); volatileInputs.delete(key); }
  }
  function restorePending() {
    const memberId = state.principal.id, workspaceId = state.workspaceId;
    const entry = entries(memberId).find(e => e.workspaceId === workspaceId) ?? null;
    attempt = entry ? volatileInputs.get(scopeKey(memberId, workspaceId)) ?? null : null;
    if (attempt?.key !== entry?.key) attempt = null;
    publish({ recovery: entry ? { ...entry } : null, recoveryBlocked: false, recoveryNeedsInput: entry?.status === "unconfirmed" && !attempt,
      submissionUnconfirmed: entry?.status === "unconfirmed", ...(entry ? { agentCode: entry.agentCode, input: attempt?.input ?? {} } : {}) });
    return entry;
  }
  async function locked(memberId, version, fn) {
    try { return await withRecoveryLock(bucketKey(memberId), () => current(version) ? fn() : null); }
    catch (error) {
      if (!current(version)) return null;
      if (error instanceof RecoveryError) throw error;
      return recoveryFailure();
    }
  }
  async function recordRun(run, version, expectedEntry) {
    const memberId = state.principal.id, workspaceId = state.workspaceId;
    const applied = await locked(memberId, version, () => {
      const entry = entries(memberId).find(e => e.workspaceId === workspaceId);
      // Compare AND update inside the same Web Lock, including absent entries.
      if (!sameEntry(entry, expectedEntry) || entry && entry.runId !== run.id && entry.status !== "unconfirmed") return false;
      const active = ["queued", "running", "unknown"].includes(run.status);
      putPending(memberId, workspaceId, active ? { ...(entry ?? { memberId, workspaceId, key: null, digest: null }),
        agentCode: run.agentCode, runId: run.id, status: run.status } : null);
      return true;
    });
    if (current(version)) restorePending();
    return applied;
  }
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const stopPolling = () => { if (timer !== null) unschedule(timer); timer = null; };
  function scope() {
    stopPolling(); abort.abort(); abort = new AbortController(); generation += 1; pollCount = 0;
    return generation;
  }
  const current = version => !disposed && version === generation;
  function scopedRequest(version) {
    const signal = abort.signal;
    return (path, options = {}) => {
      if (!current(version)) return Promise.reject(new DOMException("Scope changed", "AbortError"));
      // Supplying a signal replaces the SDK timeout, so retain its 8-second limit.
      return request(path, { ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
    };
  }
  const can = permission => state.context?.workspaceId === state.workspaceId && state.context.permissions.includes(permission);
  function fail(error, version, operation) {
    if (!current(version)) return;
    const issue = requestIssue(error, operation);
    if ([401, 403].includes(issue.status)) {
      volatileInputs.clear();
      scope(); attempt = null;
      publish({ context: null, agents: [], agentCode: "", input: {}, run: null, recovery: null, recoveryReference: null, issue,
        submitting: false, reading: false, submissionUnconfirmed: false, polling: false, imageBlob: null, imageLoading: false, contentUnavailable: true, phase: "ready" });
      if (issue.status === 401) { publish({ principal: null, workspaces: [], workspaceId: "" }); onUnauthorized(); }
    } else publish({ issue, ...(operation === "read" && [404, 410].includes(issue.status) ? {
      imageBlob: null, contentUnavailable: true, run: state.run ? { ...state.run, output: null, imageAssetId: null } : null
    } : {}) });
  }
  function enqueuePoll() {
    stopPolling();
    if (disposed || !state.run || !describeRun(state.run).active || !can(READ) || state.issue) {
      publish({ polling: false }); return;
    }
    if (pollCount >= maxPolls) { publish({ polling: false, pollPaused: true }); return; }
    publish({ polling: true, pollPaused: false });
    const version = generation, runId = state.run.id;
    timer = schedule(() => {
      if (!current(version) || state.run?.id !== runId) return;
      timer = null; pollCount += 1; void readRun(runId, true);
    }, pollInterval);
  }
  async function selectWorkspace(workspaceId) {
    const version = scope(); attempt = null; volatileInputs.clear();
    publish({ workspaceId: "", context: null, agents: [], agentCode: "", input: {}, run: null, issue: null,
      phase: "loading", submitting: false, reading: false, submissionUnconfirmed: false, polling: false, pollPaused: false, imageBlob: null, imageLoading: false,
      recovery: null, recoveryReference: null, recoveryNeedsInput: false, recoveryBlocked: false, contentUnavailable: false });
    if (!workspaceId) { publish({ phase: "ready" }); return; }
    // URL/Select values never grant authority, even before the server check.
    if (!state.workspaces.some(item => item.workspace.id === workspaceId)) {
      fail({ status: 403 }, version, "load"); return;
    }
    publish({ workspaceId });
    try {
      const api = scopedRequest(version);
      const context = await api("/client/workspaces/context", { workspaceId });
      if (!current(version)) return;
      if (!record(context) || context.workspaceId !== workspaceId || typeof context.workspaceName !== "string" || !strings(context.permissions)) invalid();
      publish({ context });
      const recovery = restorePending();
      if (can(EXECUTE)) {
        const agents = parseAgents(await aiClientFactory(api).listAgents(workspaceId));
        if (!current(version)) return;
        publish({ agents, agentCode: recovery?.agentCode ?? agents[0]?.code ?? "" });
      }
    } catch (error) { fail(error, version, "load"); }
    finally { if (current(version)) publish({ phase: "ready" }); }
  }
  async function start(preferredId = state.workspaceId) {
    disposed = false;
    const version = scope(); attempt = null; volatileInputs.clear(); publish(initial());
    try {
      const api = scopedRequest(version);
      const principal = await api("/client/auth/me");
      if (!current(version)) return;
      if (!record(principal) || !id(principal.id)) invalid();
      publish({ principal });
      const items = [];
      for (let page = 1; ; page += 1) {
        const result = await api(`/client/workspaces?page=${page}&pageSize=100`);
        if (!current(version)) return;
        if (!record(result) || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 ||
          result.items.some(item => !record(item) || !record(item.workspace) || !id(item.workspace.id) || typeof item.workspace.name !== "string" || !record(item.role) || typeof item.role.name !== "string")) invalid();
        items.push(...result.items);
        if (items.length >= result.total) break;
        if (!result.items.length || page >= 100) invalid();
      }
      publish({ workspaces: [...new Map(items.map(item => [item.workspace.id, item])).values()] });
      await selectWorkspace(items.find(item => item.workspace.id === preferredId)?.workspace.id ?? items[0]?.workspace.id ?? "");
    } catch (error) { fail(error, version, "load"); if (current(version)) publish({ phase: "ready" }); }
  }
  function selectAgent(agentCode) {
    if (state.submitting || state.reading || state.recovery || state.recoveryReference || state.recoveryBlocked || state.run || !state.agents.some(a => a.code === agentCode)) return;
    scope(); attempt = null;
    publish({ agentCode, input: {}, run: null, issue: null, reading: false, polling: false, pollPaused: false, imageBlob: null, imageLoading: false });
  }
  function setInput(field, value) {
    const agent = state.agents.find(a => a.code === state.agentCode);
    if (state.submitting || state.reading || (state.submissionUnconfirmed && !state.recoveryNeedsInput) || state.recovery?.runId || state.run || state.recoveryReference || !agent?.inputFields.includes(field)) return;
    attempt = null; publish({ input: { ...state.input, [field]: value }, issue: null });
  }
  async function submit() {
    if (state.submitting || state.reading || state.run || state.recoveryReference || state.recovery?.runId || state.recoveryBlocked || !can(EXECUTE) || state.phase !== "ready") return;
    const agent = state.agents.find(a => a.code === state.agentCode);
    if (!agent) return;
    const input = Object.fromEntries(agent.inputFields.map(field => [field, state.input[field]?.trim() ?? ""]));
    if (Object.values(input).some(v => !v || v.length > 2000)) { publish({ issue: requestIssue({ status: 400 }) }); return; }
    const version = generation, workspaceId = state.workspaceId, memberId = state.principal.id;
    publish({ submitting: true, issue: null });
    try {
      const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([agent.code, Object.entries(input).sort(([a], [b]) => a.localeCompare(b))])));
      if (!current(version)) return;
      const digest = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
      const submitted = await locked(memberId, version, () => {
        const prior = entries(memberId).find(e => e.workspaceId === workspaceId);
        if (prior && (prior.runId || prior.agentCode !== agent.code || prior.digest !== digest)) {
          restorePending();
          throw new RecoveryError("此空间仍有未决任务。请填写完全相同的原参数以原标识确认，或读取原任务；核对完成前不能创建新标识。");
        }
        const entry = prior ?? { memberId, workspaceId, agentCode: agent.code, key: makeKey(), digest, runId: null, status: "unconfirmed" };
        putPending(memberId, workspaceId, entry); // Durable write BEFORE any POST.
        const value = { ...entry, input };
        volatileInputs.set(scopeKey(memberId, workspaceId), value);
        return value;
      });
      if (!submitted || !current(version)) return;
      attempt = submitted;
      publish({ recovery: { ...pending.get(scopeKey(memberId, workspaceId)) }, submissionUnconfirmed: true, recoveryNeedsInput: false });
      const run = parseRun(await aiClientFactory(scopedRequest(version)).submit(workspaceId, submitted.agentCode, submitted.input, submitted.key), { agentCode: submitted.agentCode });
      if (!current(version)) return;
      const applied = await recordRun(run, version, submitted);
      if (!current(version)) return;
      if (!applied) return;
      publish({ run, submissionUnconfirmed: false, contentUnavailable: false }); enqueuePoll();
    } catch (error) {
      if (!current(version)) return;
      if (error?.status === 400) {
        try {
          await locked(memberId, version, () => {
            const entry = entries(memberId).find(e => e.workspaceId === workspaceId);
            if (entry?.key === attempt?.key) putPending(memberId, workspaceId, null);
          });
          if (!current(version)) return;
          restorePending();
        }
        catch (storageError) { fail(storageError, version, "submit"); return; }
      }
      fail(error, version, "submit");
    } finally { if (current(version)) publish({ submitting: false }); }
  }
  async function recoverRequest() {
    if (!aiRecoveryClientFactory || !can(READ) || state.reading || state.submitting || state.imageLoading) return;
    stopPolling();
    const version = generation, memberId = state.principal.id, workspaceId = state.workspaceId;
    publish({ reading: true, issue: null, polling: false });
    try {
      const entry = await locked(memberId, version, () => {
        restorePending();
        const found = entries(memberId).find(e => e.workspaceId === workspaceId);
        return found ? { ...found } : null;
      });
      if (!current(version) || !entry?.key) return;
      const reference = parseRecoveryReference(await aiRecoveryClientFactory(scopedRequest(version)).recoverRequest(workspaceId, entry.key), entry);
      if (!current(version)) return;
      const applied = await locked(memberId, version, () => {
        const latest = entries(memberId).find(e => e.workspaceId === workspaceId);
        if (!sameEntry(latest, entry)) return false;
        putPending(memberId, workspaceId, safeTerminal(reference) ? null : { ...entry, runId: reference.id, status: reference.status });
        return true;
      });
      if (!current(version)) return;
      restorePending();
      // Binding metadata always discards cached output; it is never promoted to
      // a synthetic successful run. Only the normal authorized read loads output.
      publish({ run: null, imageBlob: null, input: {}, recoveryReference: applied ? reference : null,
        contentUnavailable: !applied || !reference.contentAvailable });
      volatileInputs.delete(scopeKey(memberId, workspaceId)); attempt = null;
    } catch (error) {
      fail(error, version, "recover");
      if (current(version) && error?.status === 404) publish({ issue: { kind: "unavailable", status: 404,
        message: "暂未查到原任务，原提交可能仍在处理中。请稍后再次查回，或填写完全相同的原参数，用原请求标识确认；不能创建新标识。" } });
    } finally { if (current(version)) publish({ reading: false }); }
  }
  async function readRun(runId = state.run?.id ?? state.recovery?.runId, automatic = false) {
    runId ??= state.recoveryReference?.id;
    if (state.reading || state.imageLoading || !can(READ) || !id(runId) || state.submitting ||
      state.recoveryReference?.id === runId && !state.recoveryReference.contentAvailable) return;
    stopPolling();
    const version = generation, expected = { id: runId, ...(state.recovery?.runId === runId ? { agentCode: state.recovery.agentCode }
      : state.run?.id === runId ? { agentCode: state.run.agentCode } : state.recoveryReference?.id === runId ? { agentCode: state.recoveryReference.agentCode } : {}) };
    const expectedEntry = state.recovery ? { ...state.recovery } : null;
    if (!automatic) pollCount = 0;
    publish({ reading: true, issue: null, polling: false, pollPaused: false });
    try {
      const run = parseRun(await aiClientFactory(scopedRequest(version)).read(state.workspaceId, runId), expected);
      if (!current(version)) return;
      // An arbitrary normal GET cannot resolve a lost POST with no known run ID.
      const applied = expectedEntry && expectedEntry.runId !== runId ? false : await recordRun(run, version, expectedEntry);
      if (!current(version)) return;
      if (!applied && (!expectedEntry || expectedEntry.runId === runId)) {
        publish({ run: null, recoveryReference: null, imageBlob: null, contentUnavailable: true }); return;
      }
      publish({ run, recoveryReference: null, contentUnavailable: false, ...(state.run?.id !== run.id ? { imageBlob: null } : {}) });
    } catch (error) { fail(error, version, "read"); }
    finally {
      if (current(version)) { publish({ reading: false }); enqueuePoll(); }
    }
  }
  async function readImage() {
    const run = state.run;
    if (!requestImage || state.reading || state.imageLoading || !can(READ) || !run?.imageAssetId || run.status !== "succeeded") return;
    const version = generation, signal = abort.signal;
    publish({ imageLoading: true, issue: null });
    try {
      const path = aiClientFactory(scopedRequest(version)).imagePath(run.id);
      const blob = await requestImage(path, { workspaceId: state.workspaceId, signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (!current(version)) return;
      if (!(blob instanceof Blob) || blob.type !== "image/png" || blob.size === 0 || blob.size > 8 * 1024 * 1024) invalid();
      publish({ imageBlob: blob });
    } catch (error) { fail(error, version, "read"); }
    finally { if (current(version)) publish({ imageLoading: false }); }
  }
  function newTask() {
    if (!safeTerminal(state.run ?? state.recoveryReference) || state.recovery || state.recoveryBlocked || state.submitting || state.reading) return;
    scope(); attempt = null;
    publish({ run: null, recoveryReference: null, contentUnavailable: false, issue: null, submissionUnconfirmed: false, reading: false, polling: false, pollPaused: false, imageBlob: null, imageLoading: false });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start, selectWorkspace, selectAgent, setInput, submit, recoverRequest, readRun, readImage, newTask,
    dispose() { disposed = true; volatileInputs.clear(); attempt = null; scope(); publish(initial()); }
  };
}
