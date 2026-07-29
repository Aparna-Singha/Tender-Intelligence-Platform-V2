ALTER TYPE "AuditEventType" ADD VALUE 'RAG_INDEX_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'RAG_CONVERSATION_CREATED';

CREATE TYPE "RagSourceMode" AS ENUM (
  'TENDER_ONLY',
  'TENDER_AND_APPROVED_COMPANY_EVIDENCE',
  'TENDER_AND_DERIVED_WORKFLOW_RECORDS',
  'FULL_AUTHORISED_TENDER_CONTEXT'
);
CREATE TYPE "RagIndexRunStatus" AS ENUM ('QUEUED','CHUNKING','EMBEDDING','INDEXING','VALIDATING','COMPLETE','FAILED','CANCELLED','INVALIDATED');
CREATE TYPE "RagSourceClass" AS ENUM ('TENDER_PRIMARY','TENDER_ANNEXURE','TENDER_CORRIGENDUM','TENDER_BOQ','TENDER_CLARIFICATION','STRUCTURED_REQUIREMENT','STRUCTURED_FIELD','COMPANY_EVIDENCE','COMPANY_PROFILE','ELIGIBILITY_ASSESSMENT','CHECKLIST_ITEM','RISK_FINDING','TENDER_METADATA','SYSTEM_POLICY');
CREATE TYPE "RagConversationStatus" AS ENUM ('ACTIVE','ARCHIVED','DELETED');
CREATE TYPE "RagMessageRole" AS ENUM ('USER','ASSISTANT');
CREATE TYPE "RagAnswerRunStatus" AS ENUM ('QUEUED','RETRIEVING','GENERATING','VERIFYING_CITATIONS','COMPLETE','INSUFFICIENT_EVIDENCE','HUMAN_REVIEW_REQUIRED','FAILED','CANCELLED','INVALIDATED');
CREATE TYPE "RagFeedbackRating" AS ENUM ('HELPFUL','NOT_HELPFUL');

CREATE TABLE "rag_index_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "tender_id" UUID NOT NULL REFERENCES "tenders"("id") ON DELETE CASCADE,
  "tender_version_id" UUID NOT NULL REFERENCES "tender_versions"("id") ON DELETE RESTRICT,
  "extraction_run_id" UUID NOT NULL REFERENCES "extraction_runs"("id") ON DELETE RESTRICT,
  "source_mode" "RagSourceMode" NOT NULL,
  "status" "RagIndexRunStatus" NOT NULL DEFAULT 'QUEUED',
  "source_fingerprint" CHAR(64) NOT NULL,
  "chunk_policy_version" VARCHAR(80) NOT NULL,
  "retrieval_policy_version" VARCHAR(80) NOT NULL,
  "embedding_provider" VARCHAR(80) NOT NULL,
  "embedding_model" VARCHAR(160) NOT NULL,
  "embedding_dimensions" INTEGER NOT NULL CHECK ("embedding_dimensions" = 768),
  "idempotency_key" VARCHAR(255) NOT NULL UNIQUE,
  "requested_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "chunk_count" INTEGER NOT NULL DEFAULT 0 CHECK ("chunk_count" >= 0),
  "progress_percentage" INTEGER NOT NULL DEFAULT 0 CHECK ("progress_percentage" BETWEEN 0 AND 100),
  "current_stage" VARCHAR(120) NOT NULL DEFAULT 'Queued',
  "failure_code" VARCHAR(80),
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "activated_at" TIMESTAMPTZ(3),
  "invalidated_at" TIMESTAMPTZ(3),
  "invalidation_reason" VARCHAR(240),
  "cancellation_requested_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organisation_id","tender_id","source_mode","source_fingerprint")
);
CREATE INDEX "rag_index_runs_tenant_status_idx" ON "rag_index_runs" ("organisation_id","tender_id","source_mode","status","created_at");
CREATE UNIQUE INDEX "rag_index_runs_one_active_idx" ON "rag_index_runs" ("organisation_id","tender_id","source_mode") WHERE "status" = 'COMPLETE' AND "invalidated_at" IS NULL;

CREATE TABLE "rag_chunks" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "tender_id" UUID NOT NULL REFERENCES "tenders"("id") ON DELETE CASCADE,
  "tender_version_id" UUID NOT NULL REFERENCES "tender_versions"("id") ON DELETE RESTRICT,
  "extraction_run_id" UUID NOT NULL REFERENCES "extraction_runs"("id") ON DELETE RESTRICT,
  "index_run_id" UUID NOT NULL REFERENCES "rag_index_runs"("id") ON DELETE CASCADE,
  "source_class" "RagSourceClass" NOT NULL,
  "source_record_id" UUID NOT NULL,
  "source_document_id" UUID,
  "extraction_citation_id" UUID REFERENCES "extraction_citations"("id") ON DELETE RESTRICT,
  "source_version" VARCHAR(160) NOT NULL,
  "document_name" VARCHAR(255) NOT NULL,
  "page_number" INTEGER CHECK ("page_number" IS NULL OR "page_number" > 0),
  "clause_label" VARCHAR(240),
  "source_coordinates" JSONB NOT NULL,
  "content" TEXT NOT NULL,
  "content_checksum" CHAR(64) NOT NULL,
  "token_count" INTEGER NOT NULL CHECK ("token_count" BETWEEN 1 AND 1200),
  "sequence" INTEGER NOT NULL CHECK ("sequence" >= 0),
  "search_vector" TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
  "embedding" vector(768),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("index_run_id","source_class","source_record_id","sequence")
);
CREATE INDEX "rag_chunks_tenant_scope_idx" ON "rag_chunks" ("organisation_id","tender_id","index_run_id","source_class");
CREATE INDEX "rag_chunks_fts_idx" ON "rag_chunks" USING GIN ("search_vector");
CREATE INDEX "rag_chunks_embedding_idx" ON "rag_chunks" USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE "rag_conversations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "tender_id" UUID NOT NULL REFERENCES "tenders"("id") ON DELETE CASCADE,
  "tender_version_id" UUID NOT NULL REFERENCES "tender_versions"("id") ON DELETE RESTRICT,
  "index_run_id" UUID NOT NULL REFERENCES "rag_index_runs"("id") ON DELETE RESTRICT,
  "source_mode" "RagSourceMode" NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "status" "RagConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "archived_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "rag_conversations_tenant_idx" ON "rag_conversations" ("organisation_id","tender_id","status","updated_at");

CREATE TABLE "rag_messages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "tender_id" UUID NOT NULL REFERENCES "tenders"("id") ON DELETE CASCADE,
  "conversation_id" UUID NOT NULL REFERENCES "rag_conversations"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "role" "RagMessageRole" NOT NULL,
  "content" TEXT NOT NULL CHECK (length("content") BETWEEN 1 AND 12000),
  "created_by_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("conversation_id","sequence")
);
CREATE INDEX "rag_messages_tenant_idx" ON "rag_messages" ("organisation_id","tender_id","conversation_id","created_at");

CREATE TABLE "rag_answer_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "tender_id" UUID NOT NULL REFERENCES "tenders"("id") ON DELETE CASCADE,
  "tender_version_id" UUID NOT NULL REFERENCES "tender_versions"("id") ON DELETE RESTRICT,
  "conversation_id" UUID NOT NULL REFERENCES "rag_conversations"("id") ON DELETE CASCADE,
  "question_message_id" UUID NOT NULL UNIQUE REFERENCES "rag_messages"("id") ON DELETE RESTRICT,
  "answer_message_id" UUID UNIQUE REFERENCES "rag_messages"("id") ON DELETE SET NULL,
  "index_run_id" UUID NOT NULL REFERENCES "rag_index_runs"("id") ON DELETE RESTRICT,
  "source_mode" "RagSourceMode" NOT NULL,
  "status" "RagAnswerRunStatus" NOT NULL DEFAULT 'QUEUED',
  "retrieval_policy_version" VARCHAR(80) NOT NULL,
  "answer_policy_version" VARCHAR(80) NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "model" VARCHAR(160) NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL UNIQUE,
  "progress_percentage" INTEGER NOT NULL DEFAULT 0 CHECK ("progress_percentage" BETWEEN 0 AND 100),
  "current_stage" VARCHAR(120) NOT NULL DEFAULT 'Queued',
  "failure_code" VARCHAR(80),
  "retrieval_latency_ms" INTEGER,
  "generation_latency_ms" INTEGER,
  "total_latency_ms" INTEGER,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "invalidated_at" TIMESTAMPTZ(3),
  "invalidation_reason" VARCHAR(240),
  "cancellation_requested_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "rag_answer_runs_tenant_idx" ON "rag_answer_runs" ("organisation_id","tender_id","conversation_id","status","created_at");

CREATE TABLE "rag_retrieval_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "tender_id" UUID NOT NULL REFERENCES "tenders"("id") ON DELETE CASCADE,
  "answer_run_id" UUID NOT NULL UNIQUE REFERENCES "rag_answer_runs"("id") ON DELETE CASCADE,
  "source_mode" "RagSourceMode" NOT NULL,
  "query_checksum" CHAR(64) NOT NULL,
  "candidate_limit" INTEGER NOT NULL CHECK ("candidate_limit" BETWEEN 1 AND 100),
  "result_limit" INTEGER NOT NULL CHECK ("result_limit" BETWEEN 1 AND 20),
  "fusion_policy_version" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "rag_retrieval_runs_tenant_idx" ON "rag_retrieval_runs" ("organisation_id","tender_id","created_at");

CREATE TABLE "rag_retrieval_hits" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "retrieval_run_id" UUID NOT NULL REFERENCES "rag_retrieval_runs"("id") ON DELETE CASCADE,
  "chunk_id" UUID NOT NULL REFERENCES "rag_chunks"("id") ON DELETE RESTRICT,
  "rank" INTEGER NOT NULL CHECK ("rank" > 0),
  "lexical_rank" INTEGER,
  "vector_rank" INTEGER,
  "fused_score" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("retrieval_run_id","chunk_id"),
  UNIQUE ("retrieval_run_id","rank")
);

CREATE TABLE "rag_answer_citations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "answer_run_id" UUID NOT NULL REFERENCES "rag_answer_runs"("id") ON DELETE CASCADE,
  "chunk_id" UUID NOT NULL REFERENCES "rag_chunks"("id") ON DELETE RESTRICT,
  "handle" VARCHAR(32) NOT NULL,
  "claim_text" VARCHAR(1000) NOT NULL,
  "excerpt" VARCHAR(1000) NOT NULL,
  "document_name" VARCHAR(255) NOT NULL,
  "page_number" INTEGER,
  "clause_label" VARCHAR(240),
  "source_checksum" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("answer_run_id","handle")
);
CREATE INDEX "rag_answer_citations_chunk_idx" ON "rag_answer_citations" ("answer_run_id","chunk_id");

CREATE TABLE "rag_feedback" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "tender_id" UUID NOT NULL REFERENCES "tenders"("id") ON DELETE CASCADE,
  "answer_run_id" UUID NOT NULL REFERENCES "rag_answer_runs"("id") ON DELETE CASCADE,
  "rating" "RagFeedbackRating" NOT NULL,
  "reason_code" VARCHAR(80),
  "comment" VARCHAR(500),
  "submitted_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("answer_run_id","submitted_by_user_id")
);
CREATE INDEX "rag_feedback_tenant_idx" ON "rag_feedback" ("organisation_id","tender_id","created_at");

-- Composite keys make organisation/tender scope a database invariant rather than
-- relying only on application predicates.
CREATE UNIQUE INDEX "tenders_id_organisation_scope_key"
  ON "tenders" ("id","organisation_id");
CREATE UNIQUE INDEX "tender_versions_id_tender_scope_key"
  ON "tender_versions" ("id","tender_id");
CREATE UNIQUE INDEX "extraction_runs_full_scope_key"
  ON "extraction_runs" ("id","organisation_id","tender_id","tender_version_id");
CREATE UNIQUE INDEX "rag_index_runs_full_scope_key"
  ON "rag_index_runs" ("id","organisation_id","tender_id","tender_version_id");
CREATE UNIQUE INDEX "rag_conversations_full_scope_key"
  ON "rag_conversations" ("id","organisation_id","tender_id","tender_version_id");
CREATE UNIQUE INDEX "rag_conversations_tenant_scope_key"
  ON "rag_conversations" ("id","organisation_id","tender_id");
CREATE UNIQUE INDEX "rag_answer_runs_tenant_scope_key"
  ON "rag_answer_runs" ("id","organisation_id","tender_id");

ALTER TABLE "rag_index_runs" ADD CONSTRAINT "rag_index_runs_tender_scope_fk"
  FOREIGN KEY ("tender_id","organisation_id")
  REFERENCES "tenders" ("id","organisation_id") ON DELETE CASCADE;
ALTER TABLE "rag_index_runs" ADD CONSTRAINT "rag_index_runs_version_scope_fk"
  FOREIGN KEY ("tender_version_id","tender_id")
  REFERENCES "tender_versions" ("id","tender_id") ON DELETE RESTRICT;
ALTER TABLE "rag_index_runs" ADD CONSTRAINT "rag_index_runs_extraction_scope_fk"
  FOREIGN KEY ("extraction_run_id","organisation_id","tender_id","tender_version_id")
  REFERENCES "extraction_runs" ("id","organisation_id","tender_id","tender_version_id")
  ON DELETE RESTRICT;
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_index_scope_fk"
  FOREIGN KEY ("index_run_id","organisation_id","tender_id","tender_version_id")
  REFERENCES "rag_index_runs" ("id","organisation_id","tender_id","tender_version_id")
  ON DELETE CASCADE;
ALTER TABLE "rag_conversations" ADD CONSTRAINT "rag_conversations_index_scope_fk"
  FOREIGN KEY ("index_run_id","organisation_id","tender_id","tender_version_id")
  REFERENCES "rag_index_runs" ("id","organisation_id","tender_id","tender_version_id")
  ON DELETE RESTRICT;
ALTER TABLE "rag_messages" ADD CONSTRAINT "rag_messages_conversation_scope_fk"
  FOREIGN KEY ("conversation_id","organisation_id","tender_id")
  REFERENCES "rag_conversations" ("id","organisation_id","tender_id")
  ON DELETE CASCADE;
ALTER TABLE "rag_answer_runs" ADD CONSTRAINT "rag_answer_conversation_scope_fk"
  FOREIGN KEY ("conversation_id","organisation_id","tender_id","tender_version_id")
  REFERENCES "rag_conversations" ("id","organisation_id","tender_id","tender_version_id")
  ON DELETE CASCADE;
ALTER TABLE "rag_retrieval_runs" ADD CONSTRAINT "rag_retrieval_answer_scope_fk"
  FOREIGN KEY ("answer_run_id","organisation_id","tender_id")
  REFERENCES "rag_answer_runs" ("id","organisation_id","tender_id")
  ON DELETE CASCADE;
ALTER TABLE "rag_feedback" ADD CONSTRAINT "rag_feedback_answer_scope_fk"
  FOREIGN KEY ("answer_run_id","organisation_id","tender_id")
  REFERENCES "rag_answer_runs" ("id","organisation_id","tender_id")
  ON DELETE CASCADE;
