-- CreateEnum
CREATE TYPE "DraftType" AS ENUM ('REQUIREMENT_RESPONSE', 'TECHNICAL_RESPONSE', 'ELIGIBILITY_RESPONSE', 'COMPANY_PROFILE_RESPONSE', 'EXPERIENCE_RESPONSE', 'CERTIFICATION_RESPONSE', 'OEM_AUTHORISATION_RESPONSE', 'DELIVERY_AND_SUPPORT_RESPONSE', 'DECLARATION_RESPONSE', 'CLARIFICATION_AND_DEVIATION_RESPONSE', 'CONSOLIDATED_FIRST_DRAFT');

-- CreateEnum
CREATE TYPE "DraftGenerationStatus" AS ENUM ('QUEUED', 'SNAPSHOTTING', 'PLANNING', 'RETRIEVING', 'GENERATING', 'VALIDATING', 'COMPLETE', 'FAILED', 'CANCELLED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "DraftLifecycle" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "DraftReviewState" AS ENUM ('NOT_REVIEWED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "DraftContentOrigin" AS ENUM ('GENERATED', 'HUMAN_EDITED', 'TEMPLATE', 'PLACEHOLDER');

-- CreateEnum
CREATE TYPE "DraftClaimClass" AS ENUM ('TENDER_SOURCE_STATEMENT', 'APPROVED_COMPANY_FACT', 'HUMAN_AUTHORED_COMMITMENT', 'DERIVED_ASSESSMENT_REFERENCE', 'RISK_OR_CHECKLIST_WARNING', 'INFERENCE_REQUIRING_REVIEW', 'PLACEHOLDER');

-- CreateEnum
CREATE TYPE "DraftSupportState" AS ENUM ('SUPPORTED', 'UNSUPPORTED', 'CONFLICTING', 'EXPIRED', 'HUMAN_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "DraftPlaceholderType" AS ENUM ('MISSING_APPROVED_COMPANY_FACT', 'MISSING_DOCUMENT_EVIDENCE', 'UNRESOLVED_CONFLICT', 'HUMAN_REVIEW_REQUIRED', 'TECHNICAL_INPUT_REQUIRED', 'COMMERCIAL_INPUT_REQUIRED', 'SIGNATORY_INPUT_REQUIRED', 'CLARIFICATION_REQUIRED', 'SOURCE_EXTRACTION_UNAVAILABLE', 'EXPIRED_EVIDENCE', 'UNSUPPORTED_COMMITMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DraftPlaceholderResolutionState" AS ENUM ('OPEN', 'RESOLVED', 'REOPENED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "DraftHumanInputClass" AS ENUM ('WRITING_PREFERENCE', 'TECHNICAL_RESPONSE', 'DELIVERY_COMMITMENT', 'COMMERCIAL_INPUT', 'SIGNATORY_INPUT', 'DECLARATION_INPUT', 'CLARIFICATION_RESPONSE', 'OTHER');

-- CreateEnum
CREATE TYPE "DraftHumanInputReviewState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "DraftReviewAction" AS ENUM ('START_REVIEW', 'COMMENT', 'REQUEST_CHANGES', 'ACCEPT_SECTION', 'REJECT_SECTION', 'LINK_SOURCE', 'RESOLVE_PLACEHOLDER', 'REOPEN_PLACEHOLDER', 'APPROVE_VERSION', 'REJECT_VERSION', 'REOPEN_VERSION');

-- CreateEnum
CREATE TYPE "DraftSnapshotSourceKind" AS ENUM ('EXTRACTION_CITATION', 'STRUCTURED_REQUIREMENT', 'RISK_FINDING', 'ELIGIBILITY_ASSESSMENT', 'COMPANY_EVIDENCE_FACT_VERSION', 'COMPANY_EVIDENCE_CITATION', 'CHECKLIST_ITEM', 'RAG_CHUNK', 'HUMAN_INPUT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_GENERATION_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_GENERATION_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_GENERATION_RETRIED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_GENERATION_COMPLETED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_GENERATION_INVALIDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_VERSION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_SECTION_EDITED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_HUMAN_INPUT_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_HUMAN_INPUT_REVIEWED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_PLACEHOLDER_RESOLVED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_PLACEHOLDER_REOPENED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_REVIEW_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_CHANGES_REQUESTED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_VERSION_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_VERSION_REJECTED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_VERSION_REOPENED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_ARCHIVED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_DELETED';
ALTER TYPE "AuditEventType" ADD VALUE 'DRAFT_ACCESS_DENIED';

-- CreateTable
CREATE TABLE "draft_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "draft_type" "DraftType" NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "active_version_id" UUID,
    "retired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "draft_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_template_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "sections" JSONB NOT NULL,
    "required_review_role" "Role" NOT NULL,
    "template_policy_version" VARCHAR(80) NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "activated_at" TIMESTAMPTZ(3),
    "retired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_generation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "extraction_run_id" UUID NOT NULL,
    "risk_analysis_run_id" UUID NOT NULL,
    "pursuit_decision_id" UUID NOT NULL,
    "assessment_run_id" UUID NOT NULL,
    "evidence_snapshot_id" UUID NOT NULL,
    "checklist_generation_run_id" UUID NOT NULL,
    "rag_index_run_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "input_snapshot_id" UUID,
    "draft_id" UUID,
    "draft_type" "DraftType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "source_mode" "RagSourceMode" NOT NULL,
    "status" "DraftGenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" VARCHAR(80) NOT NULL,
    "model" VARCHAR(160) NOT NULL,
    "prompt_policy_version" VARCHAR(80) NOT NULL,
    "retrieval_policy_version" VARCHAR(80) NOT NULL,
    "template_policy_version" VARCHAR(80) NOT NULL,
    "drafting_policy_version" VARCHAR(80) NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "trigger" VARCHAR(40) NOT NULL,
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "current_stage" VARCHAR(120) NOT NULL DEFAULT 'Queued',
    "event_sequence" INTEGER NOT NULL DEFAULT 1,
    "section_count" INTEGER NOT NULL DEFAULT 0,
    "validated_claim_count" INTEGER NOT NULL DEFAULT 0,
    "placeholder_count" INTEGER NOT NULL DEFAULT 0,
    "citation_count" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "requested_by_user_id" UUID NOT NULL,
    "cancellation_requested_at" TIMESTAMPTZ(3),
    "safe_failure_code" VARCHAR(80),
    "planning_latency_ms" INTEGER,
    "retrieval_latency_ms" INTEGER,
    "generation_latency_ms" INTEGER,
    "validation_latency_ms" INTEGER,
    "total_latency_ms" INTEGER,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "invalidation_reason" VARCHAR(240),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "draft_generation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_input_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "extraction_run_id" UUID NOT NULL,
    "risk_analysis_run_id" UUID NOT NULL,
    "pursuit_decision_id" UUID NOT NULL,
    "assessment_run_id" UUID NOT NULL,
    "evidence_snapshot_id" UUID NOT NULL,
    "checklist_generation_run_id" UUID NOT NULL,
    "rag_index_run_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "generation_run_id" UUID NOT NULL,
    "source_mode" "RagSourceMode" NOT NULL,
    "draft_type" "DraftType" NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "model" VARCHAR(160) NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "prompt_policy_version" VARCHAR(80) NOT NULL,
    "retrieval_policy_version" VARCHAR(80) NOT NULL,
    "template_policy_version" VARCHAR(80) NOT NULL,
    "drafting_policy_version" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_input_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_input_snapshot_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "source_kind" "DraftSnapshotSourceKind" NOT NULL,
    "source_record_id" UUID NOT NULL,
    "source_version" VARCHAR(160) NOT NULL,
    "source_checksum" CHAR(64),
    "extraction_citation_id" UUID,
    "evidence_fact_version_id" UUID,
    "evidence_citation_id" UUID,
    "human_input_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_input_snapshot_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "draft_type" "DraftType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "lifecycle" "DraftLifecycle" NOT NULL DEFAULT 'ACTIVE',
    "current_version_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "retention_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "draft_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "generation_run_id" UUID,
    "parent_version_id" UUID,
    "input_snapshot_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "provider" VARCHAR(80),
    "model" VARCHAR(160),
    "review_state" "DraftReviewState" NOT NULL DEFAULT 'NOT_REVIEWED',
    "created_by_user_id" UUID NOT NULL,
    "change_summary" VARCHAR(1000),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "approval_rationale" VARCHAR(2000),
    "invalidated_at" TIMESTAMPTZ(3),
    "invalidation_reason" VARCHAR(240),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "draft_version_id" UUID NOT NULL,
    "section_key" VARCHAR(120) NOT NULL,
    "heading" VARCHAR(240) NOT NULL,
    "section_order" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_origin" "DraftContentOrigin" NOT NULL,
    "requirement_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "review_state" "DraftReviewState" NOT NULL DEFAULT 'NOT_REVIEWED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "section_id" UUID NOT NULL,
    "claim_text" VARCHAR(2000) NOT NULL,
    "claim_class" "DraftClaimClass" NOT NULL,
    "material" BOOLEAN NOT NULL DEFAULT true,
    "support_state" "DraftSupportState" NOT NULL,
    "evidence_fact_version_id" UUID,
    "human_input_id" UUID,
    "review_state" "DraftReviewState" NOT NULL DEFAULT 'NOT_REVIEWED',
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_claim_citations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "claim_id" UUID NOT NULL,
    "rag_chunk_id" UUID,
    "extraction_citation_id" UUID,
    "evidence_citation_id" UUID,
    "handle" VARCHAR(32) NOT NULL,
    "document_name" VARCHAR(255) NOT NULL,
    "page_number" INTEGER,
    "clause_label" VARCHAR(240),
    "excerpt" VARCHAR(1000) NOT NULL,
    "source_checksum" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_claim_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_placeholders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "draft_version_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "placeholder_type" "DraftPlaceholderType" NOT NULL,
    "marker_text" VARCHAR(1000) NOT NULL,
    "explanation" VARCHAR(2000) NOT NULL,
    "structured_requirement_id" UUID,
    "assessment_id" UUID,
    "checklist_item_id" UUID,
    "material" BOOLEAN NOT NULL DEFAULT true,
    "approval_blocking" BOOLEAN NOT NULL DEFAULT true,
    "resolution_state" "DraftPlaceholderResolutionState" NOT NULL DEFAULT 'OPEN',
    "resolved_by_user_id" UUID,
    "resolution_rationale" VARCHAR(2000),
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "draft_placeholders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_human_inputs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "input_class" "DraftHumanInputClass" NOT NULL,
    "value" VARCHAR(4000) NOT NULL,
    "section_key" VARCHAR(120),
    "structured_requirement_id" UUID,
    "provenance_description" VARCHAR(1000) NOT NULL,
    "review_state" "DraftHumanInputReviewState" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" UUID NOT NULL,
    "reviewed_by_user_id" UUID,
    "review_rationale" VARCHAR(2000),
    "reviewed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "superseded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_human_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "draft_version_id" UUID NOT NULL,
    "state" "DraftReviewState" NOT NULL DEFAULT 'IN_REVIEW',
    "started_by_user_id" UUID NOT NULL,
    "assigned_user_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "draft_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_review_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "draft_version_id" UUID NOT NULL,
    "section_id" UUID,
    "action" "DraftReviewAction" NOT NULL,
    "prior_state" "DraftReviewState",
    "new_state" "DraftReviewState",
    "rationale" VARCHAR(2000) NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "event_sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_review_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "draft_templates_organisation_id_draft_type_retired_at_idx" ON "draft_templates"("organisation_id", "draft_type", "retired_at");

-- CreateIndex
CREATE INDEX "draft_template_versions_template_id_activated_at_retired_at_idx" ON "draft_template_versions"("template_id", "activated_at", "retired_at");

-- CreateIndex
CREATE UNIQUE INDEX "draft_template_versions_template_id_version_number_key" ON "draft_template_versions"("template_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "draft_generation_runs_input_snapshot_id_key" ON "draft_generation_runs"("input_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "draft_generation_runs_idempotency_key_key" ON "draft_generation_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "draft_generation_runs_organisation_id_tender_id_tender_vers_idx" ON "draft_generation_runs"("organisation_id", "tender_id", "tender_version_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "draft_generation_runs_organisation_id_source_fingerprint_dr_idx" ON "draft_generation_runs"("organisation_id", "source_fingerprint", "draft_type");

-- CreateIndex
CREATE UNIQUE INDEX "draft_input_snapshots_generation_run_id_key" ON "draft_input_snapshots"("generation_run_id");

-- CreateIndex
CREATE INDEX "draft_input_snapshots_organisation_id_tender_id_source_fing_idx" ON "draft_input_snapshots"("organisation_id", "tender_id", "source_fingerprint");

-- CreateIndex
CREATE INDEX "draft_input_snapshot_sources_organisation_id_tender_id_sour_idx" ON "draft_input_snapshot_sources"("organisation_id", "tender_id", "source_kind");

-- CreateIndex
CREATE UNIQUE INDEX "draft_input_snapshot_sources_snapshot_id_source_kind_source_key" ON "draft_input_snapshot_sources"("snapshot_id", "source_kind", "source_record_id");

-- CreateIndex
CREATE INDEX "drafts_organisation_id_tender_id_lifecycle_updated_at_idx" ON "drafts"("organisation_id", "tender_id", "lifecycle", "updated_at");

-- CreateIndex
CREATE INDEX "draft_versions_organisation_id_tender_id_draft_id_review_st_idx" ON "draft_versions"("organisation_id", "tender_id", "draft_id", "review_state");

-- CreateIndex
CREATE UNIQUE INDEX "draft_versions_draft_id_version_number_key" ON "draft_versions"("draft_id", "version_number");

-- CreateIndex
CREATE INDEX "draft_sections_draft_version_id_section_order_idx" ON "draft_sections"("draft_version_id", "section_order");

-- CreateIndex
CREATE UNIQUE INDEX "draft_sections_draft_version_id_section_key_key" ON "draft_sections"("draft_version_id", "section_key");

-- CreateIndex
CREATE INDEX "draft_claims_section_id_claim_class_support_state_idx" ON "draft_claims"("section_id", "claim_class", "support_state");

-- CreateIndex
CREATE INDEX "draft_claim_citations_rag_chunk_id_idx" ON "draft_claim_citations"("rag_chunk_id");

-- CreateIndex
CREATE UNIQUE INDEX "draft_claim_citations_claim_id_handle_key" ON "draft_claim_citations"("claim_id", "handle");

-- CreateIndex
CREATE INDEX "draft_placeholders_organisation_id_tender_id_draft_version__idx" ON "draft_placeholders"("organisation_id", "tender_id", "draft_version_id", "resolution_state");

-- CreateIndex
CREATE INDEX "draft_human_inputs_organisation_id_tender_id_input_class_re_idx" ON "draft_human_inputs"("organisation_id", "tender_id", "input_class", "review_state");

-- CreateIndex
CREATE INDEX "draft_reviews_organisation_id_tender_id_draft_version_id_st_idx" ON "draft_reviews"("organisation_id", "tender_id", "draft_version_id", "state");

-- CreateIndex
CREATE INDEX "draft_review_events_organisation_id_tender_id_draft_version_idx" ON "draft_review_events"("organisation_id", "tender_id", "draft_version_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "draft_review_events_draft_version_id_event_sequence_key" ON "draft_review_events"("draft_version_id", "event_sequence");

-- AddForeignKey
ALTER TABLE "draft_template_versions" ADD CONSTRAINT "draft_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "draft_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_input_snapshots" ADD CONSTRAINT "draft_input_snapshots_generation_run_id_fkey" FOREIGN KEY ("generation_run_id") REFERENCES "draft_generation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_input_snapshot_sources" ADD CONSTRAINT "draft_input_snapshot_sources_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "draft_input_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_sections" ADD CONSTRAINT "draft_sections_draft_version_id_fkey" FOREIGN KEY ("draft_version_id") REFERENCES "draft_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_claims" ADD CONSTRAINT "draft_claims_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "draft_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_claim_citations" ADD CONSTRAINT "draft_claim_citations_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "draft_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_placeholders" ADD CONSTRAINT "draft_placeholders_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "draft_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_reviews" ADD CONSTRAINT "draft_reviews_draft_version_id_fkey" FOREIGN KEY ("draft_version_id") REFERENCES "draft_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_review_events" ADD CONSTRAINT "draft_review_events_draft_version_id_fkey" FOREIGN KEY ("draft_version_id") REFERENCES "draft_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-scope keys keep selectors and source identifiers inside one organisation
-- and tender even if an application query is accidentally under-scoped.
CREATE UNIQUE INDEX "draft_generation_runs_tenant_scope_key"
  ON "draft_generation_runs" ("id", "organisation_id", "tender_id");
CREATE UNIQUE INDEX "draft_input_snapshots_tenant_scope_key"
  ON "draft_input_snapshots" ("id", "organisation_id", "tender_id");
CREATE UNIQUE INDEX "drafts_tenant_scope_key"
  ON "drafts" ("id", "organisation_id", "tender_id");
CREATE UNIQUE INDEX "draft_versions_tenant_scope_key"
  ON "draft_versions" ("id", "organisation_id", "tender_id");
CREATE UNIQUE INDEX "draft_human_inputs_tenant_scope_key"
  ON "draft_human_inputs" ("id", "organisation_id", "tender_id");

ALTER TABLE "draft_generation_runs" ADD CONSTRAINT "draft_generation_runs_tender_scope_fkey"
  FOREIGN KEY ("tender_id", "organisation_id")
  REFERENCES "tenders" ("id", "organisation_id") ON DELETE CASCADE;
ALTER TABLE "draft_input_snapshots" ADD CONSTRAINT "draft_input_snapshots_run_scope_fkey"
  FOREIGN KEY ("generation_run_id", "organisation_id", "tender_id")
  REFERENCES "draft_generation_runs" ("id", "organisation_id", "tender_id") ON DELETE CASCADE;
ALTER TABLE "draft_input_snapshot_sources" ADD CONSTRAINT "draft_snapshot_sources_scope_fkey"
  FOREIGN KEY ("snapshot_id", "organisation_id", "tender_id")
  REFERENCES "draft_input_snapshots" ("id", "organisation_id", "tender_id") ON DELETE CASCADE;
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_draft_scope_fkey"
  FOREIGN KEY ("draft_id", "organisation_id", "tender_id")
  REFERENCES "drafts" ("id", "organisation_id", "tender_id") ON DELETE CASCADE;
ALTER TABLE "draft_placeholders" ADD CONSTRAINT "draft_placeholders_version_scope_fkey"
  FOREIGN KEY ("draft_version_id", "organisation_id", "tender_id")
  REFERENCES "draft_versions" ("id", "organisation_id", "tender_id") ON DELETE CASCADE;
ALTER TABLE "draft_reviews" ADD CONSTRAINT "draft_reviews_version_scope_fkey"
  FOREIGN KEY ("draft_version_id", "organisation_id", "tender_id")
  REFERENCES "draft_versions" ("id", "organisation_id", "tender_id") ON DELETE CASCADE;
ALTER TABLE "draft_review_events" ADD CONSTRAINT "draft_review_events_version_scope_fkey"
  FOREIGN KEY ("draft_version_id", "organisation_id", "tender_id")
  REFERENCES "draft_versions" ("id", "organisation_id", "tender_id") ON DELETE CASCADE;
