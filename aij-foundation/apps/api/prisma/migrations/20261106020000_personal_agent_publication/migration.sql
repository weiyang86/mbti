-- Publication is current eligibility of the original personal Agent owner.
-- Existing enabled assets remain unpublished until an explicit authorized action.
ALTER TABLE public.ai_personal_agent
  ADD COLUMN published_revision integer NULL,
  ADD COLUMN publication_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT ai_personal_agent_publication_version_nonnegative CHECK (publication_version >= 0),
  ADD CONSTRAINT ai_personal_agent_publication_current CHECK (
    published_revision IS NULL OR
    (published_revision = revision AND enabled AND deleted_at IS NULL AND publication_version > 0)
  );

-- Preserve the original identity/tombstone/history owner. A publication-only
-- update is the sole new exception to authored revision advancement, and may
-- change exactly the two publication fields with a single forward epoch.
CREATE OR REPLACE FUNCTION public.aij_personal_agent_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.member_id IS DISTINCT FROM OLD.member_id OR NEW.code IS DISTINCT FROM OLD.code
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Personal Agent identity and tombstones are immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.publication_version::bigint <> OLD.publication_version::bigint+1 THEN
    RAISE EXCEPTION 'Personal Agent publication epoch must advance exactly once' USING ERRCODE='55000';
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    IF NEW.published_revision IS NOT NULL OR
      (to_jsonb(NEW)-ARRAY['deleted_at','updated_at','published_revision','publication_version']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['deleted_at','updated_at','published_revision','publication_version']) THEN
      RAISE EXCEPTION 'Personal Agent deletion cannot change content' USING ERRCODE='55000';
    END IF;
  ELSIF NEW.revision = OLD.revision THEN
    IF NEW.published_revision IS NOT DISTINCT FROM OLD.published_revision OR
      (to_jsonb(NEW)-ARRAY['published_revision','publication_version']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['published_revision','publication_version']) THEN
      RAISE EXCEPTION 'Personal Agent publication cannot change authored content' USING ERRCODE='55000';
    END IF;
  ELSIF NEW.revision::bigint <> OLD.revision::bigint+1 OR NEW.published_revision IS NOT NULL THEN
    RAISE EXCEPTION 'Personal Agent updates require next unpublished revision' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
