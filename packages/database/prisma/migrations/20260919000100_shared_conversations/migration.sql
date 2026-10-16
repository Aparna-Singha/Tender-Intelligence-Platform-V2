-- Preserve existing tender transcripts and citation relations.
ALTER TABLE "rag_conversations"
  ALTER COLUMN "tender_id" DROP NOT NULL,
  ALTER COLUMN "tender_version_id" DROP NOT NULL,
  ALTER COLUMN "index_run_id" DROP NOT NULL,
  ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "context" VARCHAR(160),
  ADD CONSTRAINT "rag_conversation_context_check" CHECK (
    (tender_id IS NULL AND tender_version_id IS NULL AND index_run_id IS NULL)
    OR (tender_id IS NOT NULL AND tender_version_id IS NOT NULL AND index_run_id IS NOT NULL)
  );
ALTER TABLE "rag_messages" ALTER COLUMN "tender_id" DROP NOT NULL;
ALTER TABLE "rag_messages" ADD COLUMN "client_key" VARCHAR(120);
CREATE UNIQUE INDEX "rag_messages_conversation_id_client_key_key" ON "rag_messages" ("conversation_id", "client_key");
-- Nullable tender IDs must not bypass organisation isolation in composite FKs.
CREATE UNIQUE INDEX "rag_conversations_id_organisation_key" ON "rag_conversations" ("id", "organisation_id");
ALTER TABLE "rag_messages" ADD CONSTRAINT "rag_messages_organisation_conversation_fk"
  FOREIGN KEY ("conversation_id", "organisation_id") REFERENCES "rag_conversations" ("id", "organisation_id") ON DELETE CASCADE;
ALTER TABLE "rag_conversations" ADD CONSTRAINT "rag_conversations_organisation_fk"
  FOREIGN KEY ("organisation_id") REFERENCES "organisations" ("id") ON DELETE CASCADE;
-- Each retry is an immutable run; idempotency_key still deduplicates requests.
DO $$ DECLARE constraint_name text; BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
  WHERE conrelid = 'rag_index_runs'::regclass AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (organisation_id, tender_id, source_mode, source_fingerprint)';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE rag_index_runs DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;
CREATE INDEX "rag_index_runs_source_fingerprint_idx" ON "rag_index_runs" ("organisation_id", "tender_id", "source_mode", "source_fingerprint");
