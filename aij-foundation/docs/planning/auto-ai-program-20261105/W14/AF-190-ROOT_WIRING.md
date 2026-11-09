# AF-190 root-only wiring proposal

Candidate delta starts AFTER bootstrap `0ce1b50a9f840cc8d4860b8c4bf3d6f246cb7540`. Do not cherry-pick bootstrap. Worker did not touch shared owner paths. Root must wire and run actual gates before CODE_VERIFIED/I completion.

## Assembly

1. Import `DocumentsModule` from `./documents/personal-documents.module` in `apps/api/src/app.module.ts`, add to the real application's imports alongside `ClientWorkspacesModule`. Its real controller/service use existing global Prisma and Config modules; no provider configuration or model needed.
2. In `bootstrap.ts`, import `personalDocumentNoStore`, mount `app.use('/api/client/documents', personalDocumentNoStore)` BEFORE parsers and guards (including malformed/oversize requests). Add a route-scoped JSON parser for this exact prefix with a `512kb` transport limit BEFORE the existing global `100kb` parser (other routes keep their limit); retain rawBody/duplicate-key verifier semantics if composed. A valid 65,536-byte tab/LF body or escaped JSON can exceed 100kb on wire: transport size must not silently reduce the specified UTF8 content limit. DTO still enforces decoded UTF8 <=65,536 bytes.
3. Register permission keys `documentsRead: 'workspace.documents.read'` and `documentsManage: 'workspace.documents.manage'` in shared client-workspace permission definitions; seed active definitions and OWNER grants through existing role creation/grant owner. Give MEMBER neither by default. A read-only test role has read only. Never alias to AI assets permissions.
4. SDK index: `export { createPersonalDocumentsClient } from './personal-documents.js'; export type { CreatePersonalDocument, UpdatePersonalDocument, PersonalDocumentSummary, PersonalDocument, PersonalDocumentVersionSummary, PersonalDocumentVersion, PersonalDocumentPage, PersonalDocumentHistory, DeletePersonalDocumentResult, PersonalDocumentsPort } from './personal-documents.js';` Build/pack contracts+SDK and install isolated consumer. Worker source-import tests are NOT public export/packed SDK proof.
5. Root creates real `/client/documents` wrapper, navigation gated by documents.read and enabled aij-ai. Instantiate/memoize API with PUBLIC `createPersonalDocumentsClient(clientApi)` from `@aij/sdk`, pass typed `api`, verified `scope` and `revalidate` to `ClientDocumentManager`. Scope includes workspaceId, memberId, opaque non-secret sessionKey (never cookie/token), roleId, validationKey and current permission codes. Keep scope immutable/memoized and the injected API stable; change validationKey for each host revalidation and on every account/session/member/role/permission change. Host revalidation must perform actual session + workspace context + plugin checks and return current scope or null. Component never reads identity from URL or browser storage. Wrapper owns session logout/navigation. No runtime source SDK imports.
6. Initial assembly intentionally gates personal_documents on current project/org + enabled aij-ai installation. This is a separate document owner, not a new plugin/catalog entry and not knowledge/file/run owner. Disabling aij-ai stops documents. Document this decision in current state, keep REQ022/037/038 PARTIAL.
7. Registry AF-190 must include offline source tests and root live script, schema checks, packed SDK, actual API/build/production desktop+390px browser acceptance. Missing adapter, route, harness or proof = FAIL; never skip. Native OS file-picker and true document-hidden remain NOT_PROVEN. No import/export/AI/Word/PDF/restore/retention/backup claims.

## Exact SQL migration proposal (root chooses timestamp, owns migrate)

Apply to fresh protected test lease first. Names map to Prisma below. No real data or migrations were run by worker.

```sql
CREATE TABLE public.personal_document (
 id uuid PRIMARY KEY,
 workspace_id text NOT NULL,
 member_id text NOT NULL,
 code text NOT NULL CHECK (char_length(code) BETWEEN 2 AND 63 AND code ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
 body text NOT NULL CHECK (octet_length(body) <= 65536),
 revision integer NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 200),
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 deleted_at timestamp(3),
 CONSTRAINT personal_document_owner_fk FOREIGN KEY (workspace_id,member_id)
 REFERENCES public.client_workspace_membership(workspace_id,member_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT personal_document_scope_key UNIQUE(id,workspace_id,member_id),
 CONSTRAINT personal_document_code_key UNIQUE(workspace_id,member_id,code)
);
CREATE INDEX personal_document_owner_idx ON public.personal_document(workspace_id,member_id,deleted_at,id);
CREATE TABLE public.personal_document_version (
 id uuid PRIMARY KEY,
 document_id uuid NOT NULL,
 workspace_id text NOT NULL,
 member_id text NOT NULL,
 revision integer NOT NULL CHECK (revision BETWEEN 1 AND 200),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
 body text NOT NULL CHECK (octet_length(body) <= 65536),
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT personal_document_version_scope_fk FOREIGN KEY(document_id,workspace_id,member_id)
 REFERENCES public.personal_document(id,workspace_id,member_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT personal_document_version_revision_key UNIQUE(document_id,revision)
);
CREATE INDEX personal_document_version_owner_idx ON public.personal_document_version(workspace_id,member_id,document_id,revision);
CREATE FUNCTION public.personal_document_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'personal document history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER personal_document_version_immutable BEFORE UPDATE OR DELETE ON public.personal_document_version
FOR EACH ROW EXECUTE FUNCTION public.personal_document_history_immutable();
CREATE TRIGGER personal_document_version_no_truncate BEFORE TRUNCATE ON public.personal_document_version
FOR EACH STATEMENT EXECUTE FUNCTION public.personal_document_history_immutable();
CREATE TRIGGER personal_document_no_delete BEFORE DELETE ON public.personal_document
FOR EACH ROW EXECUTE FUNCTION public.personal_document_history_immutable();
CREATE TRIGGER personal_document_no_truncate BEFORE TRUNCATE ON public.personal_document
FOR EACH STATEMENT EXECUTE FUNCTION public.personal_document_history_immutable();
CREATE FUNCTION public.personal_document_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.revision<>1 OR NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'invalid initial document' USING ERRCODE='23514'; END IF;
 ELSE
   IF OLD.deleted_at IS NOT NULL OR (NEW.id,NEW.workspace_id,NEW.member_id,NEW.code,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.member_id,OLD.code,OLD.created_at) THEN
      RAISE EXCEPTION 'immutable document identity or tombstone' USING ERRCODE='23514';
   END IF;
   IF (NEW.name,NEW.body) IS DISTINCT FROM (OLD.name,OLD.body) THEN
     IF NEW.revision<>OLD.revision+1 OR NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'invalid document save' USING ERRCODE='23514'; END IF;
   ELSIF NEW.revision<>OLD.revision THEN RAISE EXCEPTION 'revision without save' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER personal_document_guard BEFORE INSERT OR UPDATE ON public.personal_document
FOR EACH ROW EXECUTE FUNCTION public.personal_document_head_guard();
CREATE FUNCTION public.personal_document_version_append_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h public.personal_document;
BEGIN
 SELECT * INTO h FROM public.personal_document WHERE id=NEW.document_id AND workspace_id=NEW.workspace_id AND member_id=NEW.member_id FOR UPDATE;
 IF NOT FOUND OR h.deleted_at IS NOT NULL OR (h.revision,h.name,h.body,h.updated_at) IS DISTINCT FROM (NEW.revision,NEW.name,NEW.body,NEW.created_at) THEN
   RAISE EXCEPTION 'version must match current owned head' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER personal_document_version_append BEFORE INSERT ON public.personal_document_version
FOR EACH ROW EXECUTE FUNCTION public.personal_document_version_append_guard();
CREATE FUNCTION public.personal_document_head_has_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h public.personal_document;
BEGIN
 SELECT * INTO h FROM public.personal_document WHERE id=NEW.id;
 IF NOT EXISTS(SELECT 1 FROM public.personal_document_version v WHERE v.document_id=h.id AND v.workspace_id=h.workspace_id AND v.member_id=h.member_id
   AND v.revision=h.revision AND v.name=h.name AND v.body=h.body) THEN
   RAISE EXCEPTION 'document head requires matching immutable version' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER personal_document_matching_version AFTER INSERT OR UPDATE ON public.personal_document
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.personal_document_head_has_version();
```

PostgreSQL UTF8 rejects NUL/unpaired surrogate at encoding; API/SDK additionally reject C0/C1 controls except TAB/LF/CR and validate visible trimmed names. Direct DB privileges remain trusted; triggers protect history from ordinary UPDATE/DELETE/TRUNCATE and identity reassignment. Retention/backup policy is a future card; softdelete hides history through API but does not erase immutable content.

## Exact Prisma proposal

Add `personalDocuments PersonalDocument[]` to `ClientWorkspaceMembership` only (composite relation already unique). No MemberUser/Workspace duplicate relation needed: membership already references both. Add:

```prisma
model PersonalDocument {
  id String @id @db.Uuid
  workspaceId String @map("workspace_id")
  memberId String @map("member_id")
  code String
  name String
  body String
  revision Int @default(1)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamp(3)
  updatedAt DateTime @default(now()) @map("updated_at") @db.Timestamp(3)
  deletedAt DateTime? @map("deleted_at") @db.Timestamp(3)
  owner ClientWorkspaceMembership @relation(fields:[workspaceId,memberId], references:[workspaceId,memberId], onDelete:Restrict, onUpdate:Restrict)
  versions PersonalDocumentVersion[]
  @@unique([id,workspaceId,memberId], map:"personal_document_scope_key")
  @@unique([workspaceId,memberId,code], map:"personal_document_code_key")
  @@index([workspaceId,memberId,deletedAt,id], map:"personal_document_owner_idx")
  @@map("personal_document")
}
model PersonalDocumentVersion {
  id String @id @db.Uuid
  documentId String @map("document_id") @db.Uuid
  workspaceId String @map("workspace_id")
  memberId String @map("member_id")
  revision Int
  name String
  body String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamp(3)
  document PersonalDocument @relation(fields:[documentId,workspaceId,memberId], references:[id,workspaceId,memberId], onDelete:Restrict, onUpdate:Restrict)
  @@unique([documentId,revision], map:"personal_document_version_revision_key")
  @@index([workspaceId,memberId,documentId,revision], map:"personal_document_version_owner_idx")
  @@map("personal_document_version")
}
```

## Browser adapter contract

Ignored root adapter must export async `verifyPersonalDocumentsBrowser({base,leaseId,accounts,cookies,workspaceId,readOnlyRoleId,origin})`, start/use the production Web root wrapper (root owns build/server/native browser), close its processes and contexts, and return `{productionWeb,desktopCreateSaveHistory,mobile390,casConflictDraftRetained,oldScopeFenced,readOnly,unknownReadAck,keyboardLabelsFocus,noPrivateCache,artifacts}` with each named proof true only after actual assertion and nonempty existing ignored evidence paths. Use actor 1 personal scope for editing because actor 0 quota is full; adapter may give actor 1 readOnlyRoleId for the readonly scenario and must restore original role. Cookies remain RAM only; do not put them in artifacts/logs. Missing adapter function/proof/artifact is hard FAIL. Native OS picker / true desktop OS hidden proof are still NOT_PROVEN and must not be inferred from dispatched visibility events.

## Root acceptance contract

Run `personal-documents-live.test.mjs` with explicit `AIJ_AF190_ROOT_LIVE=1` and `AIJ_AF190_PACKED_CONSUMER=<ignored isolated consumer>`. It fails before DB access outside the original root dev worktree. Root must migrate fresh lease, use actual compiled app and installed packed SDK. Root production browser proof must cover desktop + 390px create/save/history, deliberate CAS conflict reload, late old-scope results, read-only role, keyboard labels/focus, unknown-result reconciliation and production no-store. No browser helper adapter was supplied or claimed by worker; absent production browser evidence keeps acceptance FAIL.
