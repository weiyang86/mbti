-- AF-163 additive store: current mutable content only; no history or execution ledger.
CREATE TABLE public.ai_personal_memory (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  member_id text NOT NULL,
  code varchar(63) NOT NULL,
  title varchar(100),
  content text,
  kind varchar(14),
  enabled boolean,
  initial_digest varchar(64),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamp(3),
  CONSTRAINT ai_personal_memory_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES public.client_workspace(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ai_personal_memory_member_fkey FOREIGN KEY (member_id) REFERENCES public.member_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ai_personal_memory_owner_code_key UNIQUE (workspace_id,member_id,code),
  CONSTRAINT ai_personal_memory_id_scope_key UNIQUE (id,workspace_id,member_id),
  CONSTRAINT ai_personal_memory_code_check CHECK (char_length(code) BETWEEN 2 AND 63 AND code ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  CONSTRAINT ai_personal_memory_revision_check CHECK (revision > 0),
  CONSTRAINT ai_personal_memory_content_check CHECK (
    (deleted_at IS NULL AND title IS NOT NULL AND content IS NOT NULL AND kind IS NOT NULL AND enabled IS NOT NULL AND initial_digest IS NOT NULL
      AND char_length(btrim(title,E' \t\n\r\f' || chr(11))) BETWEEN 1 AND 100 AND octet_length(title)<=400
      AND char_length(btrim(content,E' \t\n\r\f' || chr(11))) BETWEEN 1 AND 4000 AND char_length(content)<=4000 AND octet_length(content)<=16384
      AND kind IN ('preference','confirmed_fact','task_summary') AND initial_digest ~ '^[a-f0-9]{64}$')
    OR (deleted_at IS NOT NULL AND title IS NULL AND content IS NULL AND kind IS NULL AND enabled IS NULL AND initial_digest IS NULL))
);
CREATE INDEX ai_personal_memory_owner_page_idx ON public.ai_personal_memory(workspace_id,member_id,deleted_at,id);
CREATE INDEX ai_personal_memory_member_idx ON public.ai_personal_memory(member_id);

CREATE TABLE public.ai_personal_memory_agent_grant (
  id text PRIMARY KEY,
  memory_id text NOT NULL,
  workspace_id text NOT NULL,
  member_id text NOT NULL,
  agent_id text NOT NULL,
  CONSTRAINT ai_personal_memory_grant_memory_scope_fkey FOREIGN KEY (memory_id,workspace_id,member_id)
    REFERENCES public.ai_personal_memory(id,workspace_id,member_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ai_personal_memory_grant_agent_scope_fkey FOREIGN KEY (agent_id,workspace_id,member_id)
    REFERENCES public.ai_personal_agent(id,workspace_id,member_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ai_personal_memory_grant_agent_key UNIQUE (memory_id,agent_id)
);
CREATE INDEX ai_personal_memory_grant_agent_scope_idx ON public.ai_personal_memory_agent_grant(agent_id,workspace_id,member_id);
CREATE INDEX ai_personal_memory_grant_memory_scope_idx ON public.ai_personal_memory_agent_grant(memory_id,workspace_id,member_id);

CREATE FUNCTION public.ai_personal_memory_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Personal memory tombstone required'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Personal memory tombstone immutable'; END IF;
    IF (NEW.id,NEW.workspace_id,NEW.member_id,NEW.code,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.member_id,OLD.code,OLD.created_at)
      THEN RAISE EXCEPTION 'Personal memory owner and code immutable'; END IF;
    IF NEW.revision <> OLD.revision+1 THEN RAISE EXCEPTION 'Personal memory revision required'; END IF;
    IF NEW.deleted_at IS NULL AND NEW.initial_digest IS DISTINCT FROM OLD.initial_digest THEN RAISE EXCEPTION 'Personal memory initial digest immutable'; END IF;
  ELSE
    IF NEW.deleted_at IS NOT NULL OR NEW.revision<>1 THEN RAISE EXCEPTION 'Invalid personal memory initial state'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('ai-personal-memories:'||NEW.workspace_id||':'||NEW.member_id,0));
    IF (SELECT count(*) FROM public.ai_personal_memory WHERE workspace_id=NEW.workspace_id AND member_id=NEW.member_id AND deleted_at IS NULL)>=200
      THEN RAISE EXCEPTION 'Personal memory limit reached'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ai_personal_memory_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ai_personal_memory
  FOR EACH ROW EXECUTE FUNCTION public.ai_personal_memory_guard();

CREATE FUNCTION public.ai_personal_memory_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Same lock order as application writes: memory then Agent. Disabled Agents may be preauthorized.
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Replace personal memory grants explicitly'; END IF;
  PERFORM id FROM public.ai_personal_memory WHERE id=NEW.memory_id AND workspace_id=NEW.workspace_id AND member_id=NEW.member_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Personal memory unavailable'; END IF;
  PERFORM id FROM public.ai_personal_agent WHERE id=NEW.agent_id AND workspace_id=NEW.workspace_id AND member_id=NEW.member_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Personal memory Agent unavailable'; END IF;
  IF (SELECT count(*) FROM public.ai_personal_memory_agent_grant WHERE memory_id=NEW.memory_id)>=16 THEN RAISE EXCEPTION 'Personal memory grant limit reached'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ai_personal_memory_grant_guard BEFORE INSERT OR UPDATE ON public.ai_personal_memory_agent_grant
  FOR EACH ROW EXECUTE FUNCTION public.ai_personal_memory_grant_guard();

CREATE FUNCTION public.ai_personal_memory_erasure_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_personal_memory m JOIN public.ai_personal_memory_agent_grant g ON g.memory_id=m.id
    WHERE m.id=NEW.id AND m.deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Personal memory erasure requires grant removal'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER ai_personal_memory_erasure_guard AFTER UPDATE ON public.ai_personal_memory DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.ai_personal_memory_erasure_guard();

CREATE FUNCTION public.ai_personal_memory_truncate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Personal memory tombstones required'; END; $$;
CREATE TRIGGER ai_personal_memory_truncate_guard BEFORE TRUNCATE ON public.ai_personal_memory
  FOR EACH STATEMENT EXECUTE FUNCTION public.ai_personal_memory_truncate_guard();
