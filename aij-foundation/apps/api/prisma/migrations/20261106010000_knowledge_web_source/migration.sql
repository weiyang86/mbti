-- AF-179: additive web-source metadata; run only on verified isolated test leases in this task.
-- Existing rows retain NULL in all four columns; existing defaults/relations remain intact.
ALTER TABLE public.ai_knowledge_document
  ADD COLUMN source_url varchar(2048),
  ADD COLUMN source_final_url varchar(2048),
  ADD COLUMN source_text_checksum char(64),
  ADD COLUMN source_extraction_version varchar(64),
  ADD CONSTRAINT ai_knowledge_document_web_source_complete CHECK (
    (source_url IS NULL AND source_final_url IS NULL AND source_text_checksum IS NULL AND source_extraction_version IS NULL)
    OR
    (source_url IS NOT NULL AND source_final_url IS NOT NULL AND source_text_checksum IS NOT NULL AND source_extraction_version IS NOT NULL
      AND source_url ~ '^https://[a-z0-9.-]+/[^[:space:]#]*$' AND char_length(source_url) BETWEEN 1 AND 2048
      AND source_final_url ~ '^https://[a-z0-9.-]+/[^[:space:]#]*$' AND char_length(source_final_url) BETWEEN 1 AND 2048
      AND source_text_checksum ~ '^[a-f0-9]{64}$'
      AND source_extraction_version = 'aij-knowledge-web-text/1'
      AND source_filename IS NOT NULL AND source_filename = 'web-import'
      AND source_checksum IS NOT NULL AND source_checksum ~ '^[a-f0-9]{64}$'
      AND status IN ('active', 'inactive'))
  );
-- DB check enforces completeness, marker, bounds, hashes and policy; AF171 performs canonical
-- URL syntax/public DNS/TLS/redirect validation. No DB expression is treated as an SSRF gate.
-- source_text_checksum records import-time exact persisted text: later explicit manual edits
-- may differ, intentionally. No check forces it to match mutable content.
