-- CreateEnum
CREATE TYPE "ExtractionRunStatus" AS ENUM ('QUEUED', 'PARSING', 'STRUCTURING', 'COMPLETE', 'FAILED', 'CANCELLED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "ExtractionTriggerType" AS ENUM ('USER', 'RETRY', 'CORRIGENDUM');

-- CreateEnum
CREATE TYPE "ExtractedUnitType" AS ENUM ('PAGE', 'SHEET', 'ARCHIVE_MEMBER');

-- CreateEnum
CREATE TYPE "ExtractedBlockType" AS ENUM ('HEADING', 'PARAGRAPH', 'LIST_ITEM', 'TABLE', 'TABLE_CELL', 'FOOTNOTE', 'HEADER', 'FOOTER', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "ExtractionConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'HUMAN_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "ExtractionFindingState" AS ENUM ('FOUND', 'NOT_FOUND', 'AMBIGUOUS', 'CONFLICTING', 'HUMAN_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "ExtractionReviewState" AS ENUM ('UNREVIEWED', 'ACCEPTED', 'REJECTED', 'CORRECTED', 'HUMAN_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "RequirementObligation" AS ENUM ('MANDATORY', 'OPTIONAL', 'CONDITIONAL', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "ExtractionReviewAction" AS ENUM ('ACCEPT', 'REJECT', 'CORRECT', 'MARK_AMBIGUOUS', 'REQUEST_REVIEW', 'RESOLVE_CONFLICT');

-- CreateEnum
CREATE TYPE "ExtractionReviewTarget" AS ENUM ('FIELD', 'REQUIREMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'EXTRACTION_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'EXTRACTION_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'EXTRACTION_RETRIED';
ALTER TYPE "AuditEventType" ADD VALUE 'EXTRACTION_ACTIVATED';
ALTER TYPE "AuditEventType" ADD VALUE 'EXTRACTION_FIELD_REVIEWED';
ALTER TYPE "AuditEventType" ADD VALUE 'EXTRACTION_REQUIREMENT_REVIEWED';
ALTER TYPE "AuditEventType" ADD VALUE 'EXTRACTION_CORRECTION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'EXTRACTION_CONFLICT_RESOLVED';

-- AlterTable
ALTER TABLE "tender_versions" ADD COLUMN     "active_extraction_run_id" UUID;

-- CreateTable
CREATE TABLE "extraction_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "status" "ExtractionRunStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger_type" "ExtractionTriggerType" NOT NULL,
    "parser_policy_version" VARCHAR(80) NOT NULL,
    "structuring_policy_version" VARCHAR(80) NOT NULL,
    "idempotency_key" VARCHAR(240) NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "current_stage" VARCHAR(80) NOT NULL DEFAULT 'QUEUED',
    "public_message" VARCHAR(240) NOT NULL DEFAULT 'Extraction queued',
    "event_sequence" INTEGER NOT NULL DEFAULT 1,
    "requested_by_user_id" UUID NOT NULL,
    "cancellation_requested_at" TIMESTAMPTZ(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "failure_category" VARCHAR(80),
    "internal_failure_reference" VARCHAR(128),
    "safe_failure_message" VARCHAR(240),
    "quality_summary" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "extraction_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_run_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extraction_run_id" UUID NOT NULL,
    "tender_document_id" UUID NOT NULL,
    "source_checksum" CHAR(64) NOT NULL,
    "detected_format" VARCHAR(32) NOT NULL,
    "parser_name" VARCHAR(80) NOT NULL,
    "parser_version" VARCHAR(80) NOT NULL,
    "parser_configuration" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(32) NOT NULL,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_run_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extraction_run_id" UUID NOT NULL,
    "extraction_run_document_id" UUID NOT NULL,
    "unit_type" "ExtractedUnitType" NOT NULL,
    "unit_index" INTEGER NOT NULL,
    "label" VARCHAR(200),
    "archive_member_path" VARCHAR(512),
    "language" VARCHAR(32),
    "character_count" INTEGER NOT NULL DEFAULT 0,
    "parser_confidence" "ExtractionConfidence" NOT NULL,
    "ocr_status" VARCHAR(40) NOT NULL DEFAULT 'NOT_REQUIRED',
    "ocr_confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extraction_run_id" UUID NOT NULL,
    "extraction_run_document_id" UUID NOT NULL,
    "extracted_unit_id" UUID NOT NULL,
    "block_type" "ExtractedBlockType" NOT NULL,
    "reading_order" INTEGER NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "source_start_offset" INTEGER NOT NULL,
    "source_end_offset" INTEGER NOT NULL,
    "heading_level" INTEGER,
    "coordinates" JSONB,
    "language" VARCHAR(32),
    "confidence" "ExtractionConfidence" NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "extracted_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_tables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extraction_run_id" UUID NOT NULL,
    "extracted_block_id" UUID NOT NULL,
    "row_count" INTEGER NOT NULL,
    "column_count" INTEGER NOT NULL,
    "confidence" "ExtractionConfidence" NOT NULL,

    CONSTRAINT "extracted_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_table_cells" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extracted_table_id" UUID NOT NULL,
    "row_index" INTEGER NOT NULL,
    "column_index" INTEGER NOT NULL,
    "cell_reference" VARCHAR(32),
    "displayed_value" TEXT NOT NULL,
    "formula_text" TEXT,
    "row_span" INTEGER NOT NULL DEFAULT 1,
    "column_span" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "extracted_table_cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classified_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extraction_run_id" UUID NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "start_reading_order" INTEGER NOT NULL,
    "end_reading_order" INTEGER NOT NULL,
    "classification_state" VARCHAR(40) NOT NULL,
    "confidence" "ExtractionConfidence" NOT NULL,

    CONSTRAINT "classified_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_tender_fields" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extraction_run_id" UUID NOT NULL,
    "field_type" VARCHAR(80) NOT NULL,
    "source_wording" TEXT NOT NULL,
    "normalized_text_value" TEXT,
    "normalized_numeric_value" DECIMAL(20,4),
    "normalized_date_value" DATE,
    "unit" VARCHAR(40),
    "currency" CHAR(3),
    "finding_state" "ExtractionFindingState" NOT NULL,
    "confidence" "ExtractionConfidence" NOT NULL,
    "review_state" "ExtractionReviewState" NOT NULL DEFAULT 'UNREVIEWED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_tender_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "structured_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extraction_run_id" UUID NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "normalized_statement" TEXT NOT NULL,
    "source_wording" TEXT NOT NULL,
    "obligation" "RequirementObligation" NOT NULL,
    "condition_text" TEXT,
    "exception_text" TEXT,
    "threshold_operator" VARCHAR(20),
    "threshold_numeric_value" DECIMAL(20,4),
    "threshold_text_value" TEXT,
    "unit" VARCHAR(40),
    "currency" CHAR(3),
    "submission_stage" VARCHAR(80),
    "confidence" "ExtractionConfidence" NOT NULL,
    "finding_state" "ExtractionFindingState" NOT NULL,
    "review_state" "ExtractionReviewState" NOT NULL DEFAULT 'UNREVIEWED',
    "supersedes_requirement_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "structured_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_citations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extraction_run_id" UUID NOT NULL,
    "extraction_run_document_id" UUID NOT NULL,
    "tender_document_id" UUID NOT NULL,
    "extracted_unit_id" UUID,
    "extracted_block_id" UUID,
    "extracted_tender_field_id" UUID,
    "structured_requirement_id" UUID,
    "document_name" VARCHAR(255) NOT NULL,
    "page_number" INTEGER,
    "sheet_name" VARCHAR(200),
    "cell_range" VARCHAR(80),
    "archive_member_path" VARCHAR(512),
    "clause_label" VARCHAR(160),
    "start_offset" INTEGER NOT NULL,
    "end_offset" INTEGER NOT NULL,
    "bounded_excerpt" VARCHAR(1000) NOT NULL,
    "source_checksum" CHAR(64) NOT NULL,
    "validation_status" VARCHAR(40) NOT NULL,

    CONSTRAINT "extraction_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extraction_run_id" UUID NOT NULL,
    "issue_type" VARCHAR(80) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "safe_message" VARCHAR(500) NOT NULL,
    "source_document_id" UUID,
    "extracted_unit_id" UUID,
    "requires_human_review" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "extraction_run_id" UUID NOT NULL,
    "target_type" "ExtractionReviewTarget" NOT NULL,
    "target_id" UUID NOT NULL,
    "action" "ExtractionReviewAction" NOT NULL,
    "previous_value" TEXT,
    "corrected_value" TEXT,
    "reason" VARCHAR(1000) NOT NULL,
    "review_version" INTEGER NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "extraction_runs_idempotency_key_key" ON "extraction_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "extraction_runs_organisation_id_tender_id_status_created_at_idx" ON "extraction_runs"("organisation_id", "tender_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "extraction_runs_tender_version_id_created_at_idx" ON "extraction_runs"("tender_version_id", "created_at");

-- CreateIndex
CREATE INDEX "extraction_runs_organisation_id_tender_version_id_source_fing_idx" ON "extraction_runs"("organisation_id", "tender_version_id", "source_fingerprint", "parser_policy_version", "structuring_policy_version");

-- Extraction state and citation anchors are security and audit boundaries.
ALTER TABLE "extraction_runs"
  ADD CONSTRAINT "extraction_runs_progress_percentage_check"
  CHECK ("progress_percentage" BETWEEN 0 AND 100),
  ADD CONSTRAINT "extraction_runs_event_sequence_check"
  CHECK ("event_sequence" > 0),
  ADD CONSTRAINT "extraction_runs_retry_count_check"
  CHECK ("retry_count" >= 0);

ALTER TABLE "extracted_units"
  ADD CONSTRAINT "extracted_units_index_and_count_check"
  CHECK ("unit_index" > 0 AND "character_count" >= 0);

ALTER TABLE "extracted_blocks"
  ADD CONSTRAINT "extracted_blocks_offsets_check"
  CHECK (
    "reading_order" >= 0
    AND "source_start_offset" >= 0
    AND "source_end_offset" >= "source_start_offset"
  );

ALTER TABLE "extracted_tables"
  ADD CONSTRAINT "extracted_tables_dimensions_check"
  CHECK ("row_count" >= 0 AND "column_count" >= 0);

ALTER TABLE "extracted_table_cells"
  ADD CONSTRAINT "extracted_table_cells_coordinates_check"
  CHECK (
    "row_index" >= 0
    AND "column_index" >= 0
    AND "row_span" > 0
    AND "column_span" > 0
  );

ALTER TABLE "classified_sections"
  ADD CONSTRAINT "classified_sections_order_check"
  CHECK (
    "start_reading_order" >= 0
    AND "end_reading_order" >= "start_reading_order"
  );

ALTER TABLE "extraction_citations"
  ADD CONSTRAINT "extraction_citations_target_check"
  CHECK (
    (("extracted_tender_field_id" IS NOT NULL)::integer
      + ("structured_requirement_id" IS NOT NULL)::integer) = 1
  ),
  ADD CONSTRAINT "extraction_citations_offsets_check"
  CHECK (
    "start_offset" >= 0
    AND "end_offset" >= "start_offset"
    AND ("page_number" IS NULL OR "page_number" > 0)
  );

-- CreateIndex
CREATE INDEX "extraction_run_documents_tender_document_id_extraction_run__idx" ON "extraction_run_documents"("tender_document_id", "extraction_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_run_documents_extraction_run_id_tender_document__key" ON "extraction_run_documents"("extraction_run_id", "tender_document_id");

-- CreateIndex
CREATE INDEX "extracted_units_extraction_run_id_unit_type_unit_index_idx" ON "extracted_units"("extraction_run_id", "unit_type", "unit_index");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_units_extraction_run_document_id_unit_type_unit_i_key" ON "extracted_units"("extraction_run_document_id", "unit_type", "unit_index", "archive_member_path");

-- CreateIndex
CREATE INDEX "extracted_blocks_extraction_run_id_block_type_reading_order_idx" ON "extracted_blocks"("extraction_run_id", "block_type", "reading_order");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_blocks_extracted_unit_id_reading_order_key" ON "extracted_blocks"("extracted_unit_id", "reading_order");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_tables_extracted_block_id_key" ON "extracted_tables"("extracted_block_id");

-- CreateIndex
CREATE INDEX "extracted_tables_extraction_run_id_idx" ON "extracted_tables"("extraction_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_table_cells_extracted_table_id_row_index_column_i_key" ON "extracted_table_cells"("extracted_table_id", "row_index", "column_index");

-- CreateIndex
CREATE INDEX "classified_sections_extraction_run_id_category_start_readin_idx" ON "classified_sections"("extraction_run_id", "category", "start_reading_order");

-- CreateIndex
CREATE INDEX "extracted_tender_fields_extraction_run_id_field_type_review_idx" ON "extracted_tender_fields"("extraction_run_id", "field_type", "review_state");

-- CreateIndex
CREATE INDEX "structured_requirements_extraction_run_id_category_obligati_idx" ON "structured_requirements"("extraction_run_id", "category", "obligation", "confidence", "review_state");

-- CreateIndex
CREATE INDEX "extraction_citations_extraction_run_id_tender_document_id_p_idx" ON "extraction_citations"("extraction_run_id", "tender_document_id", "page_number");

-- CreateIndex
CREATE INDEX "extraction_citations_extracted_tender_field_id_idx" ON "extraction_citations"("extracted_tender_field_id");

-- CreateIndex
CREATE INDEX "extraction_citations_structured_requirement_id_idx" ON "extraction_citations"("structured_requirement_id");

-- CreateIndex
CREATE INDEX "extraction_issues_extraction_run_id_issue_type_resolved_at_idx" ON "extraction_issues"("extraction_run_id", "issue_type", "resolved_at");

-- CreateIndex
CREATE INDEX "extraction_reviews_organisation_id_extraction_run_id_target_idx" ON "extraction_reviews"("organisation_id", "extraction_run_id", "target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_reviews_extraction_run_id_target_type_target_id__key" ON "extraction_reviews"("extraction_run_id", "target_type", "target_id", "review_version");

-- CreateIndex
CREATE UNIQUE INDEX "tender_versions_active_extraction_run_id_key" ON "tender_versions"("active_extraction_run_id");

-- AddForeignKey
ALTER TABLE "tender_versions" ADD CONSTRAINT "tender_versions_active_extraction_run_id_fkey" FOREIGN KEY ("active_extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_run_documents" ADD CONSTRAINT "extraction_run_documents_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_run_documents" ADD CONSTRAINT "extraction_run_documents_tender_document_id_fkey" FOREIGN KEY ("tender_document_id") REFERENCES "tender_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_units" ADD CONSTRAINT "extracted_units_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_units" ADD CONSTRAINT "extracted_units_extraction_run_document_id_fkey" FOREIGN KEY ("extraction_run_document_id") REFERENCES "extraction_run_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_blocks" ADD CONSTRAINT "extracted_blocks_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_blocks" ADD CONSTRAINT "extracted_blocks_extraction_run_document_id_fkey" FOREIGN KEY ("extraction_run_document_id") REFERENCES "extraction_run_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_blocks" ADD CONSTRAINT "extracted_blocks_extracted_unit_id_fkey" FOREIGN KEY ("extracted_unit_id") REFERENCES "extracted_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_tables" ADD CONSTRAINT "extracted_tables_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_tables" ADD CONSTRAINT "extracted_tables_extracted_block_id_fkey" FOREIGN KEY ("extracted_block_id") REFERENCES "extracted_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_table_cells" ADD CONSTRAINT "extracted_table_cells_extracted_table_id_fkey" FOREIGN KEY ("extracted_table_id") REFERENCES "extracted_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_sections" ADD CONSTRAINT "classified_sections_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_tender_fields" ADD CONSTRAINT "extracted_tender_fields_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structured_requirements" ADD CONSTRAINT "structured_requirements_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structured_requirements" ADD CONSTRAINT "structured_requirements_supersedes_requirement_id_fkey" FOREIGN KEY ("supersedes_requirement_id") REFERENCES "structured_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_citations" ADD CONSTRAINT "extraction_citations_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_citations" ADD CONSTRAINT "extraction_citations_extraction_run_document_id_fkey" FOREIGN KEY ("extraction_run_document_id") REFERENCES "extraction_run_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_citations" ADD CONSTRAINT "extraction_citations_tender_document_id_fkey" FOREIGN KEY ("tender_document_id") REFERENCES "tender_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_citations" ADD CONSTRAINT "extraction_citations_extracted_unit_id_fkey" FOREIGN KEY ("extracted_unit_id") REFERENCES "extracted_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_citations" ADD CONSTRAINT "extraction_citations_extracted_block_id_fkey" FOREIGN KEY ("extracted_block_id") REFERENCES "extracted_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_citations" ADD CONSTRAINT "extraction_citations_extracted_tender_field_id_fkey" FOREIGN KEY ("extracted_tender_field_id") REFERENCES "extracted_tender_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_citations" ADD CONSTRAINT "extraction_citations_structured_requirement_id_fkey" FOREIGN KEY ("structured_requirement_id") REFERENCES "structured_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_issues" ADD CONSTRAINT "extraction_issues_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_reviews" ADD CONSTRAINT "extraction_reviews_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_reviews" ADD CONSTRAINT "extraction_reviews_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_reviews" ADD CONSTRAINT "extraction_reviews_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
