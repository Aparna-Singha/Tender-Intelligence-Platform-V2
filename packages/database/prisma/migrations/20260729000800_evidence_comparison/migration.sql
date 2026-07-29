-- CreateEnum
CREATE TYPE "EligibilityAssessmentRunStatus" AS ENUM ('QUEUED', 'SNAPSHOTTING', 'MATCHING', 'VALIDATING', 'COMPLETE', 'FAILED', 'CANCELLED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "EligibilityAssessmentTriggerType" AS ENUM ('USER', 'RETRY');

-- CreateEnum
CREATE TYPE "EligibilityState" AS ENUM ('VERIFIED', 'LIKELY_MET', 'MISSING', 'CONFLICT', 'NOT_APPLICABLE', 'HUMAN_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "EligibilityReviewState" AS ENUM ('UNREVIEWED', 'HUMAN_REVIEW_REQUIRED', 'REVIEWED', 'FINALISED');

-- CreateEnum
CREATE TYPE "EvidenceValueType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'MONEY', 'DURATION', 'TEXT_LIST', 'IDENTIFIER', 'DOCUMENT_EXISTENCE');

-- CreateEnum
CREATE TYPE "EvidenceFactReviewState" AS ENUM ('UNREVIEWED', 'ACCEPTED', 'REJECTED', 'HUMAN_REVIEW_REQUIRED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "EvidenceLinkType" AS ENUM ('DIRECT_SUPPORT', 'PARTIAL_SUPPORT', 'CONTRADICTS', 'CONTEXT_ONLY', 'DOCUMENT_EXISTS_ONLY', 'SELF_DECLARED_SUPPORT');

-- CreateEnum
CREATE TYPE "EligibilityReviewAction" AS ENUM ('ACCEPT_PROPOSAL', 'MARK_VERIFIED', 'MARK_LIKELY_MET', 'MARK_MISSING', 'MARK_CONFLICT', 'MARK_NOT_APPLICABLE', 'REQUEST_HUMAN_REVIEW', 'RESOLVE_CONFLICT', 'REOPEN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_ASSESSMENT_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_ASSESSMENT_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_ASSESSMENT_RETRIED';
ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_ASSESSMENT_ACTIVATED';
ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_ASSESSMENT_INVALIDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_SNAPSHOT_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'COMPANY_EVIDENCE_FACT_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'COMPANY_EVIDENCE_FACT_VERSION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'COMPANY_EVIDENCE_CITATION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'COMPANY_EVIDENCE_FACT_REVIEWED';
ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_ASSESSMENT_REVIEWED';
ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_ASSESSMENT_VERIFIED';
ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_ASSESSMENT_NOT_APPLICABLE';
ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_CONFLICT_RESOLVED';
ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_EVIDENCE_LINKED';
ALTER TYPE "AuditEventType" ADD VALUE 'ELIGIBILITY_EVIDENCE_UNLINKED';

-- AlterTable
ALTER TABLE "tender_versions" ADD COLUMN     "active_eligibility_assessment_run_id" UUID;

-- CreateTable
CREATE TABLE "company_evidence_facts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "fact_type" VARCHAR(80) NOT NULL,
    "current_version_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_evidence_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_evidence_fact_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evidence_fact_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "value_type" "EvidenceValueType" NOT NULL,
    "text_value" VARCHAR(1000),
    "number_value" DECIMAL(20,4),
    "boolean_value" BOOLEAN,
    "date_value" DATE,
    "text_list_value" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unit" VARCHAR(40),
    "currency" CHAR(3),
    "financial_year" VARCHAR(7),
    "issuing_authority" VARCHAR(240),
    "scope" VARCHAR(1000),
    "valid_from" DATE,
    "valid_until" DATE,
    "review_state" "EvidenceFactReviewState" NOT NULL DEFAULT 'UNREVIEWED',
    "confidence" DECIMAL(3,2) NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_evidence_fact_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_evidence_citations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "evidence_fact_version_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "document_checksum" CHAR(64) NOT NULL,
    "document_name" VARCHAR(255) NOT NULL,
    "document_category" "DocumentCategory" NOT NULL,
    "locator_type" VARCHAR(32) NOT NULL,
    "page_number" INTEGER,
    "section_label" VARCHAR(160),
    "sheet_name" VARCHAR(200),
    "cell_range" VARCHAR(80),
    "bounded_excerpt" VARCHAR(1000) NOT NULL,
    "validation_status" VARCHAR(40) NOT NULL DEFAULT 'PENDING_REVIEW',
    "invalidated_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_evidence_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_evidence_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "evidence_fact_id" UUID NOT NULL,
    "evidence_fact_version_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "previous_state" "EvidenceFactReviewState" NOT NULL,
    "new_state" "EvidenceFactReviewState" NOT NULL,
    "rationale" VARCHAR(1000) NOT NULL,
    "review_version" INTEGER NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_evidence_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_input_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "extraction_run_id" UUID NOT NULL,
    "risk_analysis_run_id" UUID NOT NULL,
    "pursuit_decision_id" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eligibility_input_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_snapshot_profile_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_id" UUID NOT NULL,
    "source_profile_value_id" UUID NOT NULL,
    "field_key" VARCHAR(80) NOT NULL,
    "value_type" "ProfileValueType" NOT NULL,
    "text_value" TEXT,
    "number_value" DECIMAL(18,2),
    "boolean_value" BOOLEAN,
    "date_value" DATE,
    "text_list_value" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "ProfileValueSource" NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL,
    "evidence_document_id" UUID,
    "source_updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "eligibility_snapshot_profile_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_snapshot_turnover" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_id" UUID NOT NULL,
    "source_turnover_id" UUID NOT NULL,
    "financial_year" VARCHAR(7) NOT NULL,
    "amount_inr" DECIMAL(18,2) NOT NULL,
    "source" "ProfileValueSource" NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL,
    "evidence_document_id" UUID,
    "source_updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "eligibility_snapshot_turnover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_snapshot_document_readiness" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_id" UUID NOT NULL,
    "source_readiness_id" UUID NOT NULL,
    "document_type" VARCHAR(80) NOT NULL,
    "readiness_status" VARCHAR(24) NOT NULL,
    "expected_expiry" DATE,
    "source" "ProfileValueSource" NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL,
    "evidence_document_id" UUID,
    "source_updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "eligibility_snapshot_document_readiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_snapshot_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "verification_status" "DocumentVerificationStatus" NOT NULL,
    "expiry_date" DATE,
    "checksum" CHAR(64) NOT NULL,

    CONSTRAINT "eligibility_snapshot_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_snapshot_evidence_facts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_id" UUID NOT NULL,
    "evidence_fact_version_id" UUID NOT NULL,
    "review_state" "EvidenceFactReviewState" NOT NULL,

    CONSTRAINT "eligibility_snapshot_evidence_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_snapshot_evidence_citations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_id" UUID NOT NULL,
    "source_evidence_citation_id" UUID NOT NULL,
    "evidence_fact_version_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "document_checksum" CHAR(64) NOT NULL,
    "locator_type" VARCHAR(32) NOT NULL,
    "page_number" INTEGER,
    "section_label" VARCHAR(160),
    "sheet_name" VARCHAR(200),
    "cell_range" VARCHAR(80),
    "bounded_excerpt" VARCHAR(1000) NOT NULL,
    "validation_status" VARCHAR(40) NOT NULL,
    "source_created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "eligibility_snapshot_evidence_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_assessment_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "extraction_run_id" UUID NOT NULL,
    "risk_analysis_run_id" UUID NOT NULL,
    "pursuit_decision_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "status" "EligibilityAssessmentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger_type" "EligibilityAssessmentTriggerType" NOT NULL,
    "comparison_policy_version" VARCHAR(80) NOT NULL,
    "normalisation_policy_version" VARCHAR(80) NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(240) NOT NULL,
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "current_stage" VARCHAR(80) NOT NULL DEFAULT 'QUEUED',
    "public_message" VARCHAR(240) NOT NULL DEFAULT 'Evidence assessment queued',
    "event_sequence" INTEGER NOT NULL DEFAULT 1,
    "requested_by_user_id" UUID NOT NULL,
    "cancellation_requested_at" TIMESTAMPTZ(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "failure_category" VARCHAR(80),
    "safe_failure_message" VARCHAR(240),
    "internal_failure_reference" VARCHAR(128),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "eligibility_assessment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "assessment_run_id" UUID NOT NULL,
    "structured_requirement_id" UUID NOT NULL,
    "tender_citation_id" UUID NOT NULL,
    "requirement_obligation" "RequirementObligation" NOT NULL,
    "requirement_category" VARCHAR(80) NOT NULL,
    "proposed_state" "EligibilityState" NOT NULL,
    "current_state" "EligibilityState" NOT NULL,
    "proposed_confidence" DECIMAL(3,2) NOT NULL,
    "proposed_rationale" VARCHAR(2000) NOT NULL,
    "uncertainty" VARCHAR(2000) NOT NULL,
    "comparison_policy_rule" VARCHAR(120) NOT NULL,
    "policy_version" VARCHAR(80) NOT NULL,
    "review_state" "EligibilityReviewState" NOT NULL DEFAULT 'UNREVIEWED',
    "finalised_by_user_id" UUID,
    "finalised_at" TIMESTAMPTZ(3),
    "final_rationale" VARCHAR(2000),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "eligibility_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_assessment_evidence_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessment_id" UUID NOT NULL,
    "evidence_fact_version_id" UUID,
    "evidence_citation_id" UUID,
    "snapshot_profile_value_id" UUID,
    "snapshot_document_id" UUID,
    "link_type" "EvidenceLinkType" NOT NULL,
    "relevance" DECIMAL(3,2) NOT NULL,
    "scope" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eligibility_assessment_evidence_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_assessment_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "action" "EligibilityReviewAction" NOT NULL,
    "previous_state" "EligibilityState" NOT NULL,
    "new_state" "EligibilityState" NOT NULL,
    "previous_review_state" "EligibilityReviewState" NOT NULL,
    "new_review_state" "EligibilityReviewState" NOT NULL,
    "rationale" VARCHAR(2000) NOT NULL,
    "review_version" INTEGER NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eligibility_assessment_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_evidence_facts_current_version_id_key" ON "company_evidence_facts"("current_version_id");

-- CreateIndex
CREATE INDEX "company_evidence_facts_organisation_id_fact_type_invalidate_idx" ON "company_evidence_facts"("organisation_id", "fact_type", "invalidated_at");

-- CreateIndex
CREATE INDEX "company_evidence_fact_versions_document_version_id_review_s_idx" ON "company_evidence_fact_versions"("document_version_id", "review_state");

-- CreateIndex
CREATE UNIQUE INDEX "company_evidence_fact_versions_evidence_fact_id_version_num_key" ON "company_evidence_fact_versions"("evidence_fact_id", "version_number");

-- CreateIndex
CREATE INDEX "company_evidence_citations_organisation_id_document_id_docu_idx" ON "company_evidence_citations"("organisation_id", "document_id", "document_version_id");

-- CreateIndex
CREATE INDEX "company_evidence_reviews_organisation_id_evidence_fact_id_idx" ON "company_evidence_reviews"("organisation_id", "evidence_fact_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_evidence_reviews_evidence_fact_id_review_version_key" ON "company_evidence_reviews"("evidence_fact_id", "review_version");

-- CreateIndex
CREATE INDEX "eligibility_input_snapshots_organisation_id_tender_version__idx" ON "eligibility_input_snapshots"("organisation_id", "tender_version_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_snapshot_profile_values_snapshot_id_source_prof_key" ON "eligibility_snapshot_profile_values"("snapshot_id", "source_profile_value_id");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_snapshot_turnover_snapshot_id_source_turnover_i_key" ON "eligibility_snapshot_turnover"("snapshot_id", "source_turnover_id");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_snapshot_document_readiness_snapshot_id_source__key" ON "eligibility_snapshot_document_readiness"("snapshot_id", "source_readiness_id");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_snapshot_documents_snapshot_id_document_id_key" ON "eligibility_snapshot_documents"("snapshot_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_snapshot_evidence_facts_snapshot_id_evidence_fa_key" ON "eligibility_snapshot_evidence_facts"("snapshot_id", "evidence_fact_version_id");

-- CreateIndex
CREATE INDEX "eligibility_snapshot_evidence_citations_snapshot_id_evidenc_idx" ON "eligibility_snapshot_evidence_citations"("snapshot_id", "evidence_fact_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_snapshot_evidence_citations_snapshot_id_source__key" ON "eligibility_snapshot_evidence_citations"("snapshot_id", "source_evidence_citation_id");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_assessment_runs_snapshot_id_key" ON "eligibility_assessment_runs"("snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_assessment_runs_idempotency_key_key" ON "eligibility_assessment_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "eligibility_assessment_runs_organisation_id_tender_id_tende_idx" ON "eligibility_assessment_runs"("organisation_id", "tender_id", "tender_version_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "eligibility_assessment_runs_organisation_id_source_fingerpr_idx" ON "eligibility_assessment_runs"("organisation_id", "source_fingerprint", "comparison_policy_version");

-- CreateIndex
CREATE INDEX "eligibility_assessments_organisation_id_assessment_run_id_c_idx" ON "eligibility_assessments"("organisation_id", "assessment_run_id", "current_state", "review_state");

-- CreateIndex
CREATE INDEX "eligibility_assessments_assessment_run_id_requirement_categ_idx" ON "eligibility_assessments"("assessment_run_id", "requirement_category", "requirement_obligation");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_assessments_assessment_run_id_structured_requir_key" ON "eligibility_assessments"("assessment_run_id", "structured_requirement_id");

-- CreateIndex
CREATE INDEX "eligibility_assessment_evidence_links_assessment_id_link_ty_idx" ON "eligibility_assessment_evidence_links"("assessment_id", "link_type");

-- CreateIndex
CREATE INDEX "eligibility_assessment_evidence_links_evidence_fact_version_idx" ON "eligibility_assessment_evidence_links"("evidence_fact_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_assessment_evidence_links_assessment_id_evidenc_key" ON "eligibility_assessment_evidence_links"("assessment_id", "evidence_fact_version_id", "link_type");

-- CreateIndex
CREATE INDEX "eligibility_assessment_reviews_organisation_id_assessment_i_idx" ON "eligibility_assessment_reviews"("organisation_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_assessment_reviews_assessment_id_review_version_key" ON "eligibility_assessment_reviews"("assessment_id", "review_version");

-- CreateIndex
CREATE UNIQUE INDEX "tender_versions_active_eligibility_assessment_run_id_key" ON "tender_versions"("active_eligibility_assessment_run_id");

-- AddForeignKey
ALTER TABLE "tender_versions" ADD CONSTRAINT "tender_versions_active_eligibility_assessment_run_id_fkey" FOREIGN KEY ("active_eligibility_assessment_run_id") REFERENCES "eligibility_assessment_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_facts" ADD CONSTRAINT "company_evidence_facts_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_facts" ADD CONSTRAINT "company_evidence_facts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_facts" ADD CONSTRAINT "company_evidence_facts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_facts" ADD CONSTRAINT "company_evidence_facts_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "company_evidence_fact_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_fact_versions" ADD CONSTRAINT "company_evidence_fact_versions_evidence_fact_id_fkey" FOREIGN KEY ("evidence_fact_id") REFERENCES "company_evidence_facts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_fact_versions" ADD CONSTRAINT "company_evidence_fact_versions_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_fact_versions" ADD CONSTRAINT "company_evidence_fact_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_citations" ADD CONSTRAINT "company_evidence_citations_evidence_fact_version_id_fkey" FOREIGN KEY ("evidence_fact_version_id") REFERENCES "company_evidence_fact_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_citations" ADD CONSTRAINT "company_evidence_citations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_citations" ADD CONSTRAINT "company_evidence_citations_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_citations" ADD CONSTRAINT "company_evidence_citations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_reviews" ADD CONSTRAINT "company_evidence_reviews_evidence_fact_id_fkey" FOREIGN KEY ("evidence_fact_id") REFERENCES "company_evidence_facts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_evidence_reviews" ADD CONSTRAINT "company_evidence_reviews_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_input_snapshots" ADD CONSTRAINT "eligibility_input_snapshots_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_snapshot_profile_values" ADD CONSTRAINT "eligibility_snapshot_profile_values_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "eligibility_input_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_snapshot_turnover" ADD CONSTRAINT "eligibility_snapshot_turnover_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "eligibility_input_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_snapshot_document_readiness" ADD CONSTRAINT "eligibility_snapshot_document_readiness_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "eligibility_input_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_snapshot_documents" ADD CONSTRAINT "eligibility_snapshot_documents_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "eligibility_input_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_snapshot_documents" ADD CONSTRAINT "eligibility_snapshot_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_snapshot_documents" ADD CONSTRAINT "eligibility_snapshot_documents_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_snapshot_evidence_facts" ADD CONSTRAINT "eligibility_snapshot_evidence_facts_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "eligibility_input_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_snapshot_evidence_facts" ADD CONSTRAINT "eligibility_snapshot_evidence_facts_evidence_fact_version__fkey" FOREIGN KEY ("evidence_fact_version_id") REFERENCES "company_evidence_fact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_snapshot_evidence_citations" ADD CONSTRAINT "eligibility_snapshot_evidence_citations_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "eligibility_input_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_runs" ADD CONSTRAINT "eligibility_assessment_runs_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_runs" ADD CONSTRAINT "eligibility_assessment_runs_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_runs" ADD CONSTRAINT "eligibility_assessment_runs_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_runs" ADD CONSTRAINT "eligibility_assessment_runs_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_runs" ADD CONSTRAINT "eligibility_assessment_runs_risk_analysis_run_id_fkey" FOREIGN KEY ("risk_analysis_run_id") REFERENCES "risk_analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_runs" ADD CONSTRAINT "eligibility_assessment_runs_pursuit_decision_id_fkey" FOREIGN KEY ("pursuit_decision_id") REFERENCES "early_pursuit_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_runs" ADD CONSTRAINT "eligibility_assessment_runs_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "eligibility_input_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_runs" ADD CONSTRAINT "eligibility_assessment_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessments" ADD CONSTRAINT "eligibility_assessments_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessments" ADD CONSTRAINT "eligibility_assessments_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessments" ADD CONSTRAINT "eligibility_assessments_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessments" ADD CONSTRAINT "eligibility_assessments_assessment_run_id_fkey" FOREIGN KEY ("assessment_run_id") REFERENCES "eligibility_assessment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessments" ADD CONSTRAINT "eligibility_assessments_structured_requirement_id_fkey" FOREIGN KEY ("structured_requirement_id") REFERENCES "structured_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessments" ADD CONSTRAINT "eligibility_assessments_tender_citation_id_fkey" FOREIGN KEY ("tender_citation_id") REFERENCES "extraction_citations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_evidence_links" ADD CONSTRAINT "eligibility_assessment_evidence_links_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "eligibility_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_evidence_links" ADD CONSTRAINT "eligibility_assessment_evidence_links_evidence_fact_versio_fkey" FOREIGN KEY ("evidence_fact_version_id") REFERENCES "company_evidence_fact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_evidence_links" ADD CONSTRAINT "eligibility_assessment_evidence_links_evidence_citation_id_fkey" FOREIGN KEY ("evidence_citation_id") REFERENCES "company_evidence_citations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_reviews" ADD CONSTRAINT "eligibility_assessment_reviews_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "eligibility_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_assessment_reviews" ADD CONSTRAINT "eligibility_assessment_reviews_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
