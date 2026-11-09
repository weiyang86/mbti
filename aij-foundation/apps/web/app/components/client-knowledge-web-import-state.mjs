import { ClientRequestFailure } from "@aij/sdk";

const idPattern = /^[a-z0-9]{20,32}$/;
const codePattern = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const checksumPattern = /^[a-f0-9]{64}$/;
const invalid = () => { throw new Error("网页导入数据无效，请检查输入或重新读取。"); };
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max) => typeof value === "string" && Boolean(value.trim()) && value.length <= max && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
export function validKnowledgeWebUrl(value) {
  if (!text(value, 2048) || value !== value.trim() || (value.includes("#") || value.includes("\\") || value.split("/")[2]?.includes("@")) || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return /^https:\/\//i.test(value) && url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
export function knowledgeWebInput(raw) {
  if (!exact(raw, ["documentCode", "title", "url"]) || typeof raw.documentCode !== "string" || !codePattern.test(raw.documentCode)
    || !text(raw.title, 160) || !validKnowledgeWebUrl(raw.url)) return invalid();
  return Object.freeze({ documentCode: raw.documentCode, title: raw.title.trim(), url: raw.url });
}
export function isKnowledgeWebRow(row, workspaceId) {
  return Boolean(row && row.workspaceId === workspaceId && typeof row.id === "string" && idPattern.test(row.id) && row.sourceFilename === "web-import");
}
export function validateKnowledgeWebResult(raw, workspaceId, input) {
  const keys = ["id", "workspaceId", "documentCode", "title", "status", "createdAt", "updatedAt"];
  if (!exact(raw, keys) || (typeof raw.id !== "string" || !idPattern.test(raw.id)) || raw.workspaceId !== workspaceId || raw.documentCode !== input.documentCode
    || raw.title !== input.title || raw.status !== "inactive" || ![raw.createdAt, raw.updatedAt].every(value => typeof value === "string" && new Date(value).toISOString() === value)) return invalid();
  return Object.freeze({ ...raw });
}
export function validateKnowledgeWebSource(raw, documentId) {
  const keys = ["documentId", "sourceFilename", "sourceChecksum", "sourceUrl", "sourceFinalUrl", "sourceTextChecksum", "sourceExtractionVersion", "contentMatchesSource"];
  if (!exact(raw, keys) || raw.documentId !== documentId || raw.sourceFilename !== "web-import"
    || typeof raw.sourceChecksum !== "string" || typeof raw.sourceTextChecksum !== "string" || !checksumPattern.test(raw.sourceChecksum) || !checksumPattern.test(raw.sourceTextChecksum)
    || !validKnowledgeWebUrl(raw.sourceUrl) || !validKnowledgeWebUrl(raw.sourceFinalUrl)
    || raw.sourceExtractionVersion !== "aij-knowledge-web-text/1" || typeof raw.contentMatchesSource !== "boolean") return invalid();
  return Object.freeze({ ...raw });
}

/** RAM only. Scope invalidation fences all callbacks and destroys private draft/source data.
 * A possibly committed POST is never replayed; only deliberate read + acknowledgement unlocks it. */
export function createKnowledgeWebImportState(api) {
  let scope = null;
  let revision = 0;
  let pendingImport = null;
  let draft = null;
  const locks = new Set();
  const listeners = new Set();
  let snapshot = Object.freeze({ stage: "idle", revision: 0, draft: null, source: null, message: "", locked: false, checked: false });
  const key = () => scope ? JSON.stringify([scope.principalId, scope.workspaceId]) : "";
  const permitted = () => Boolean(scope?.canManage && scope.principalId && scope.workspaceId);
  const emit = (patch) => {
    snapshot = Object.freeze({ ...snapshot, ...patch, revision, locked: locks.has(key()) });
    for (const listener of listeners) listener();
  };
  const reset = () => {
    if (pendingImport) locks.add(pendingImport.key);
    revision += 1; pendingImport = null; draft = null;
    emit({ stage: "idle", draft: null, source: null, message: "", checked: false });
  };
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return snapshot; },
    canRestoreFocus(expectedRevision) { return expectedRevision === revision && permitted() && snapshot.stage === "idle"; },
    invalidate() { reset(); scope = null; emit({}); },
    setScope(next) { reset(); scope = next ? { ...next } : null; emit({}); },
    open(expectedRevision) {
      if (expectedRevision !== revision || !permitted() || locks.has(key()) || pendingImport) return false;
      reset(); emit({ stage: "form" }); return true;
    },
    dismiss(expectedRevision) { if (expectedRevision !== revision) return; const checked = snapshot.checked; reset(); emit({ checked }); },
    prepare(raw, expectedRevision) {
      if (expectedRevision !== revision || !permitted() || snapshot.stage !== "form" || locks.has(key())) return false;
      try { draft = knowledgeWebInput(raw); }
      catch { reset(); emit({ stage: "error", message: "请检查文档编号、标题和完整 HTTPS 地址后重新填写。" }); return false; }
      emit({ stage: "confirm", draft }); return true;
    },
    async confirm(expectedRevision) {
      if (expectedRevision !== revision || !permitted() || snapshot.stage !== "confirm" || !draft || pendingImport || locks.has(key())) return false;
      const version = revision;
      const currentKey = key();
      const workspaceId = scope.workspaceId;
      let input = draft;
      const expected = { documentCode: input.documentCode, title: input.title };
      pendingImport = { key: currentKey };
      draft = null;
      emit({ stage: "importing", draft: null, source: null, message: "" });
      try {
        const request = api.importWeb(workspaceId, input);
        input = null;
        const raw = await request;
        if (version !== revision) return false;
        validateKnowledgeWebResult(raw, workspaceId, expected);
        emit({ stage: "success", message: "网页已导入为停用文档。请刷新列表核对；参与检索须另行明确恢复。" });
        return true;
      } catch (failure) {
        if (version !== revision) return false;
        // Only explicit server refusal statuses establish that this request was rejected.
        const refused = failure instanceof ClientRequestFailure && [400, 401, 403, 404, 409, 413, 422].includes(failure.status);
        if (refused) emit({ stage: "error", message: failure.status === 409 ? "此编号已存在，未覆盖文档。请读取列表核对。" : "服务端拒绝网页导入，请核对会话、权限、编号和 HTTPS 地址。" });
        else { locks.add(currentKey); emit({ stage: "unknown", message: "导入结果未知，可能已经保存。禁止再次导入；请重新读取列表，按原编号核对，找到后可核对来源。", checked: false }); }
        return false;
      } finally { if (version === revision) pendingImport = null; }
    },
    async readSource(row, expectedRevision) {
      if (expectedRevision !== revision || !permitted() || pendingImport || !isKnowledgeWebRow(row, scope.workspaceId)) return false;
      reset();
      const version = revision;
      const documentId = row.id;
      const workspaceId = scope.workspaceId;
      emit({ stage: "source-loading" });
      try {
        const raw = await api.getWebSource(workspaceId, documentId);
        if (version !== revision) return false;
        const source = validateKnowledgeWebSource(raw, documentId);
        emit({ stage: "source", source, checked: locks.has(key()) });
        return true;
      } catch {
        if (version === revision) emit({ stage: "error", source: null, message: "来源核对失败，请重新确认当前会话、权限和文档。" });
        return false;
      }
    },
    markListRead() { if (permitted() && locks.has(key())) emit({ checked: true }); },
    acknowledgeRead(expectedRevision) {
      if (expectedRevision !== revision || !permitted() || !snapshot.checked || !locks.has(key())) return false;
      locks.delete(key()); reset(); return true;
    }
  };
}
