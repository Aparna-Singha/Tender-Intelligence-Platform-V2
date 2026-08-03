-- CreateEnum
CREATE TYPE "FinalReadinessRunStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "FinalReadinessTreatment" AS ENUM ('BLOCKER', 'HUMAN_DISPOSITION_REQUIRED', 'WARNING', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "FinalReadinessFindingLifecycle" AS ENUM ('OPEN', 'UNDER_REVIEW', 'DISPOSITION_RECORDED', 'RESOLVED', 'SUPERSEDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "FinalReadinessFindingReviewState" AS ENUM ('UNREVIEWED', 'HUMAN_REVIEW_REQUIRED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "FinalReadinessFindingReviewAction" AS ENUM ('ACKNOWLEDGE', 'ACCEPT', 'REMEDIATE', 'DISMISS', 'REOPEN');

-- CreateEnum
CREATE TYPE "FinalReadinessDisposition" AS ENUM ('PROCEED_TO_CONTROLLED_EXPORT_REVIEW', 'HOLD_FOR_REMEDIATION', 'STOP_PURSUIT');

-- CreateEnum
CREATE TYPE "FinalReadinessProvenanceKind" AS ENUM ('EXTRACTION_CITATION', 'RISK_FINDING', 'ELIGIBILITY_ASSESSMENT', 'EVIDENCE_FACT_VERSION', 'EVIDENCE_CITATION', 'CHECKLIST_ITEM', 'DRAFT_VERSION', 'DRAFT_CLAIM', 'DRAFT_CITATION', 'DRAFT_PLACEHOLDER', 'HUMAN_REVIEW_RECORD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'FINAL_READINESS_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'FINAL_READINESS_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'FINAL_READINESS_RETRIED';
ALTER TYPE "AuditEventType" ADD VALUE 'FINAL_READINESS_ACTIVATED';
ALTER TYPE "AuditEventType" ADD VALUE 'FINAL_READINESS_INVALIDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'FINAL_READINESS_FINDING_REVIEWED';
ALTER TYPE "AuditEventType" ADD VALUE 'FINAL_READINESS_DISPOSITION_RECORDED';
ALTER TYPE "AuditEventType" ADD VALUE 'FINAL_READINESS_DISPOSITION_SUPERSEDED';
ALTER TYPE "AuditEventType" ADD VALUE 'FINAL_READINESS_ACTION_DENIED';

-- AlterTable
ALTER TABLE "tender_versions" ADD COLUMN     "active_final_readiness_run_id" UUID;

-- AlterTable
ALTER TABLE "risk_analysis_runs" ADD COLUMN     "final_readiness_run_id" UUID;

-- AlterTable
ALTER TABLE "draft_review_events" ADD COLUMN     "actor_role_at_action" "Role";

-- CreateTable
CREATE TABLE "final_readiness_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "status" "FinalReadinessRunStatus" NOT NULL DEFAULT 'QUEUED',
    "policy_version" VARCHAR(80) NOT NULL,
    "evidence_expiry_policy_version" VARCHAR(80) NOT NULL,
    "required_draft_policy_version" VARCHAR(80) NOT NULL,
    "input_fingerprint" CHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "current_stage" VARCHAR(80) NOT NULL DEFAULT 'QUEUED',
    "event_sequence" INTEGER NOT NULL DEFAULT 1,
    "cancellation_requested_at" TIMESTAMPTZ(3),
    "safe_failure_code" VARCHAR(80),
    "invalidation_code" VARCHAR(80),
    "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "final_readiness_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_readiness_input_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "extraction_run_id" UUID NOT NULL,
    "early_risk_run_id" UUID NOT NULL,
    "pursuit_decision_id" UUID NOT NULL,
    "eligibility_assessment_run_id" UUID NOT NULL,
    "eligibility_input_snapshot_id" UUID NOT NULL,
    "checklist_generation_run_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "policy_version" VARCHAR(80) NOT NULL,
    "evidence_expiry_policy_version" VARCHAR(80) NOT NULL,
    "required_draft_policy_version" VARCHAR(80) NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_readiness_input_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_readiness_snapshot_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_id" UUID NOT NULL,
    "tender_document_id" UUID NOT NULL,
    "tender_source_id" UUID,
    "role" "TenderDocumentRole" NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "source_identifier" VARCHAR(240) NOT NULL,
    "corrigendum" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_readiness_snapshot_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_readiness_snapshot_required_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_id" UUID NOT NULL,
    "draft_type" "DraftType" NOT NULL,
    "draft_id" UUID NOT NULL,
    "draft_version_id" UUID NOT NULL,
    "generation_run_id" UUID,
    "input_snapshot_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "draft_creator_user_id" UUID NOT NULL,
    "qualifying_review_event_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_readiness_snapshot_required_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_readiness_findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "treatment" "FinalReadinessTreatment" NOT NULL,
    "rule_code" VARCHAR(120) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "explanation" VARCHAR(2000) NOT NULL,
    "lifecycle" "FinalReadinessFindingLifecycle" NOT NULL DEFAULT 'OPEN',
    "review_state" "FinalReadinessFindingReviewState" NOT NULL DEFAULT 'UNREVIEWED',
    "materiality" "RiskMateriality",
    "provenance_valid" BOOLEAN NOT NULL DEFAULT false,
    "finding_order" INTEGER NOT NULL,
    "superseded_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_readiness_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_readiness_finding_provenance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "finding_id" UUID NOT NULL,
    "kind" "FinalReadinessProvenanceKind" NOT NULL,
    "extraction_citation_id" UUID,
    "risk_finding_id" UUID,
    "eligibility_assessment_id" UUID,
    "evidence_fact_version_id" UUID,
    "evidence_citation_id" UUID,
    "checklist_item_id" UUID,
    "draft_version_id" UUID,
    "draft_claim_id" UUID,
    "draft_citation_id" UUID,
    "draft_placeholder_id" UUID,
    "draft_review_event_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_readiness_finding_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_readiness_finding_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" "FinalReadinessFindingReviewAction" NOT NULL,
    "rationale" VARCHAR(2000) NOT NULL,
    "acknowledgement_recorded" BOOLEAN NOT NULL DEFAULT false,
    "review_version" INTEGER NOT NULL,
    "superseded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_readiness_finding_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_readiness_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_role_at_decision" "Role" NOT NULL,
    "disposition" "FinalReadinessDisposition" NOT NULL,
    "run_fingerprint" CHAR(64) NOT NULL,
    "rationale" VARCHAR(2000) NOT NULL,
    "supersedes_decision_id" UUID,
    "superseded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_readiness_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_readiness_decision_acknowledgements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "decision_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_readiness_decision_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "final_readiness_runs_organisation_id_tender_id_tender_versi_idx" ON "final_readiness_runs"("organisation_id", "tender_id", "tender_version_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "final_readiness_runs_tender_version_id_created_at_idx" ON "final_readiness_runs"("tender_version_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "final_readiness_runs_organisation_id_tender_id_idempotency__key" ON "final_readiness_runs"("organisation_id", "tender_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "final_readiness_input_snapshots_run_id_key" ON "final_readiness_input_snapshots"("run_id");

-- CreateIndex
CREATE INDEX "final_readiness_input_snapshots_organisation_id_tender_id_t_idx" ON "final_readiness_input_snapshots"("organisation_id", "tender_id", "tender_version_id", "captured_at");

-- CreateIndex
CREATE INDEX "final_readiness_snapshot_documents_tender_document_id_idx" ON "final_readiness_snapshot_documents"("tender_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "final_readiness_snapshot_documents_snapshot_id_tender_docum_key" ON "final_readiness_snapshot_documents"("snapshot_id", "tender_document_id");

-- CreateIndex
CREATE INDEX "final_readiness_snapshot_required_drafts_draft_version_id_q_idx" ON "final_readiness_snapshot_required_drafts"("draft_version_id", "qualifying_review_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "final_readiness_snapshot_required_drafts_snapshot_id_draft__key" ON "final_readiness_snapshot_required_drafts"("snapshot_id", "draft_type");

-- CreateIndex
CREATE INDEX "final_readiness_findings_organisation_id_tender_id_run_id_t_idx" ON "final_readiness_findings"("organisation_id", "tender_id", "run_id", "treatment", "lifecycle");

-- CreateIndex
CREATE UNIQUE INDEX "final_readiness_findings_run_id_finding_order_key" ON "final_readiness_findings"("run_id", "finding_order");

-- CreateIndex
CREATE INDEX "final_readiness_finding_provenance_finding_id_kind_idx" ON "final_readiness_finding_provenance"("finding_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "final_readiness_finding_provenance_finding_id_kind_extracti_key" ON "final_readiness_finding_provenance"("finding_id", "kind", "extraction_citation_id", "risk_finding_id", "eligibility_assessment_id", "evidence_fact_version_id", "evidence_citation_id", "checklist_item_id", "draft_version_id", "draft_claim_id", "draft_citation_id", "draft_placeholder_id", "draft_review_event_id");

-- CreateIndex
CREATE INDEX "final_readiness_finding_reviews_organisation_id_finding_id__idx" ON "final_readiness_finding_reviews"("organisation_id", "finding_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "final_readiness_finding_reviews_finding_id_review_version_key" ON "final_readiness_finding_reviews"("finding_id", "review_version");

-- CreateIndex
CREATE INDEX "final_readiness_decisions_organisation_id_tender_id_run_id__idx" ON "final_readiness_decisions"("organisation_id", "tender_id", "run_id", "created_at");

-- CreateIndex
CREATE INDEX "final_readiness_decisions_run_id_superseded_at_idx" ON "final_readiness_decisions"("run_id", "superseded_at");

-- CreateIndex
CREATE UNIQUE INDEX "final_readiness_decision_acknowledgements_decision_id_findi_key" ON "final_readiness_decision_acknowledgements"("decision_id", "finding_id");

-- CreateIndex
CREATE UNIQUE INDEX "tender_versions_active_final_readiness_run_id_key" ON "tender_versions"("active_final_readiness_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "risk_analysis_runs_final_readiness_run_id_key" ON "risk_analysis_runs"("final_readiness_run_id");

-- AddForeignKey
ALTER TABLE "tender_versions" ADD CONSTRAINT "tender_versions_active_final_readiness_run_id_fkey" FOREIGN KEY ("active_final_readiness_run_id") REFERENCES "final_readiness_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_analysis_runs" ADD CONSTRAINT "risk_analysis_runs_final_readiness_run_id_fkey" FOREIGN KEY ("final_readiness_run_id") REFERENCES "final_readiness_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_runs" ADD CONSTRAINT "final_readiness_runs_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_runs" ADD CONSTRAINT "final_readiness_runs_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_runs" ADD CONSTRAINT "final_readiness_runs_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_runs" ADD CONSTRAINT "final_readiness_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_input_snapshots" ADD CONSTRAINT "final_readiness_input_snapshots_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "final_readiness_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_input_snapshots" ADD CONSTRAINT "final_readiness_input_snapshots_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_input_snapshots" ADD CONSTRAINT "final_readiness_input_snapshots_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_input_snapshots" ADD CONSTRAINT "final_readiness_input_snapshots_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_input_snapshots" ADD CONSTRAINT "final_readiness_input_snapshots_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_input_snapshots" ADD CONSTRAINT "final_readiness_input_snapshots_early_risk_run_id_fkey" FOREIGN KEY ("early_risk_run_id") REFERENCES "risk_analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_input_snapshots" ADD CONSTRAINT "final_readiness_input_snapshots_pursuit_decision_id_fkey" FOREIGN KEY ("pursuit_decision_id") REFERENCES "early_pursuit_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_input_snapshots" ADD CONSTRAINT "final_readiness_input_snapshots_eligibility_assessment_run_fkey" FOREIGN KEY ("eligibility_assessment_run_id") REFERENCES "eligibility_assessment_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_input_snapshots" ADD CONSTRAINT "final_readiness_input_snapshots_eligibility_input_snapshot_fkey" FOREIGN KEY ("eligibility_input_snapshot_id") REFERENCES "eligibility_input_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_input_snapshots" ADD CONSTRAINT "final_readiness_input_snapshots_checklist_generation_run_i_fkey" FOREIGN KEY ("checklist_generation_run_id") REFERENCES "checklist_generation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_input_snapshots" ADD CONSTRAINT "final_readiness_input_snapshots_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_snapshot_documents" ADD CONSTRAINT "final_readiness_snapshot_documents_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "final_readiness_input_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_snapshot_documents" ADD CONSTRAINT "final_readiness_snapshot_documents_tender_document_id_fkey" FOREIGN KEY ("tender_document_id") REFERENCES "tender_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_snapshot_documents" ADD CONSTRAINT "final_readiness_snapshot_documents_tender_source_id_fkey" FOREIGN KEY ("tender_source_id") REFERENCES "tender_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_snapshot_required_drafts" ADD CONSTRAINT "final_readiness_snapshot_required_drafts_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "final_readiness_input_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_snapshot_required_drafts" ADD CONSTRAINT "final_readiness_snapshot_required_drafts_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_snapshot_required_drafts" ADD CONSTRAINT "final_readiness_snapshot_required_drafts_draft_version_id_fkey" FOREIGN KEY ("draft_version_id") REFERENCES "draft_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_snapshot_required_drafts" ADD CONSTRAINT "final_readiness_snapshot_required_drafts_generation_run_id_fkey" FOREIGN KEY ("generation_run_id") REFERENCES "draft_generation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_snapshot_required_drafts" ADD CONSTRAINT "final_readiness_snapshot_required_drafts_input_snapshot_id_fkey" FOREIGN KEY ("input_snapshot_id") REFERENCES "draft_input_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_snapshot_required_drafts" ADD CONSTRAINT "final_readiness_snapshot_required_drafts_template_version__fkey" FOREIGN KEY ("template_version_id") REFERENCES "draft_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_snapshot_required_drafts" ADD CONSTRAINT "final_readiness_snapshot_required_drafts_draft_creator_use_fkey" FOREIGN KEY ("draft_creator_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_snapshot_required_drafts" ADD CONSTRAINT "final_readiness_snapshot_required_drafts_qualifying_review_fkey" FOREIGN KEY ("qualifying_review_event_id") REFERENCES "draft_review_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_findings" ADD CONSTRAINT "final_readiness_findings_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_findings" ADD CONSTRAINT "final_readiness_findings_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_findings" ADD CONSTRAINT "final_readiness_findings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "final_readiness_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "final_readiness_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_extraction_citation_id_fkey" FOREIGN KEY ("extraction_citation_id") REFERENCES "extraction_citations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_risk_finding_id_fkey" FOREIGN KEY ("risk_finding_id") REFERENCES "risk_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_eligibility_assessment__fkey" FOREIGN KEY ("eligibility_assessment_id") REFERENCES "eligibility_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_evidence_fact_version_i_fkey" FOREIGN KEY ("evidence_fact_version_id") REFERENCES "company_evidence_fact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_evidence_citation_id_fkey" FOREIGN KEY ("evidence_citation_id") REFERENCES "company_evidence_citations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_checklist_item_id_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "checklist_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_draft_version_id_fkey" FOREIGN KEY ("draft_version_id") REFERENCES "draft_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_draft_claim_id_fkey" FOREIGN KEY ("draft_claim_id") REFERENCES "draft_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_draft_citation_id_fkey" FOREIGN KEY ("draft_citation_id") REFERENCES "draft_claim_citations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_draft_placeholder_id_fkey" FOREIGN KEY ("draft_placeholder_id") REFERENCES "draft_placeholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_provenance" ADD CONSTRAINT "final_readiness_finding_provenance_draft_review_event_id_fkey" FOREIGN KEY ("draft_review_event_id") REFERENCES "draft_review_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_reviews" ADD CONSTRAINT "final_readiness_finding_reviews_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_reviews" ADD CONSTRAINT "final_readiness_finding_reviews_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "final_readiness_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_finding_reviews" ADD CONSTRAINT "final_readiness_finding_reviews_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_decisions" ADD CONSTRAINT "final_readiness_decisions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_decisions" ADD CONSTRAINT "final_readiness_decisions_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_decisions" ADD CONSTRAINT "final_readiness_decisions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "final_readiness_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_decisions" ADD CONSTRAINT "final_readiness_decisions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_decisions" ADD CONSTRAINT "final_readiness_decisions_supersedes_decision_id_fkey" FOREIGN KEY ("supersedes_decision_id") REFERENCES "final_readiness_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_decision_acknowledgements" ADD CONSTRAINT "final_readiness_decision_acknowledgements_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "final_readiness_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_readiness_decision_acknowledgements" ADD CONSTRAINT "final_readiness_decision_acknowledgements_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "final_readiness_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 11 audit history is retained until a future approved retention procedure.
-- Authoritative upstream references therefore use RESTRICT; only true owned children
-- cascade when their final-readiness parent is deliberately removed.

-- Prisma cannot express these bounded and state-dependent invariants.
ALTER TABLE "final_readiness_runs"
  ADD CONSTRAINT "final_readiness_runs_progress_check"
  CHECK ("progress_percentage" BETWEEN 0 AND 100),
  ADD CONSTRAINT "final_readiness_runs_event_sequence_check"
  CHECK ("event_sequence" > 0),
  ADD CONSTRAINT "final_readiness_runs_failure_code_check"
  CHECK ("safe_failure_code" IS NULL OR "safe_failure_code" ~ '^[A-Z][A-Z0-9_]*$'),
  ADD CONSTRAINT "final_readiness_runs_invalidation_code_check"
  CHECK ("invalidation_code" IS NULL OR "invalidation_code" ~ '^[A-Z][A-Z0-9_]*$');

ALTER TABLE "final_readiness_snapshot_required_drafts"
  ADD CONSTRAINT "final_readiness_required_draft_type_check"
  CHECK ("draft_type" = 'CONSOLIDATED_FIRST_DRAFT');

ALTER TABLE "final_readiness_findings"
  ADD CONSTRAINT "final_readiness_findings_order_check"
  CHECK ("finding_order" >= 0),
  ADD CONSTRAINT "final_readiness_findings_rule_code_check"
  CHECK ("rule_code" ~ '^[A-Z][A-Z0-9_]*$');

ALTER TABLE "final_readiness_finding_reviews"
  ADD CONSTRAINT "final_readiness_finding_reviews_version_check"
  CHECK ("review_version" > 0);

ALTER TABLE "final_readiness_decisions"
  ADD CONSTRAINT "final_readiness_decision_actor_role_check"
  CHECK ("actor_role_at_decision" IN ('OWNER', 'ADMIN', 'REVIEWER')),
  ADD CONSTRAINT "final_readiness_decision_no_self_supersession_check"
  CHECK ("supersedes_decision_id" IS NULL OR "supersedes_decision_id" <> "id");

ALTER TABLE "final_readiness_finding_provenance"
  ADD CONSTRAINT "final_readiness_provenance_exactly_one_source_check"
  CHECK (num_nonnulls(
    "extraction_citation_id", "risk_finding_id", "eligibility_assessment_id",
    "evidence_fact_version_id", "evidence_citation_id", "checklist_item_id",
    "draft_version_id", "draft_claim_id", "draft_citation_id",
    "draft_placeholder_id", "draft_review_event_id"
  ) = 1),
  ADD CONSTRAINT "final_readiness_provenance_kind_matches_source_check"
  CHECK (
    ("kind" = 'EXTRACTION_CITATION' AND "extraction_citation_id" IS NOT NULL) OR
    ("kind" = 'RISK_FINDING' AND "risk_finding_id" IS NOT NULL) OR
    ("kind" = 'ELIGIBILITY_ASSESSMENT' AND "eligibility_assessment_id" IS NOT NULL) OR
    ("kind" = 'EVIDENCE_FACT_VERSION' AND "evidence_fact_version_id" IS NOT NULL) OR
    ("kind" = 'EVIDENCE_CITATION' AND "evidence_citation_id" IS NOT NULL) OR
    ("kind" = 'CHECKLIST_ITEM' AND "checklist_item_id" IS NOT NULL) OR
    ("kind" = 'DRAFT_VERSION' AND "draft_version_id" IS NOT NULL) OR
    ("kind" = 'DRAFT_CLAIM' AND "draft_claim_id" IS NOT NULL) OR
    ("kind" = 'DRAFT_CITATION' AND "draft_citation_id" IS NOT NULL) OR
    ("kind" = 'DRAFT_PLACEHOLDER' AND "draft_placeholder_id" IS NOT NULL) OR
    ("kind" = 'HUMAN_REVIEW_RECORD' AND "draft_review_event_id" IS NOT NULL)
  );

-- Only one authoritative operation and one current human decision may exist per run.
CREATE UNIQUE INDEX "final_readiness_one_in_progress_per_version_idx"
  ON "final_readiness_runs" ("tender_version_id")
  WHERE "status" IN ('QUEUED', 'PROCESSING');

CREATE UNIQUE INDEX "final_readiness_one_current_decision_per_run_idx"
  ON "final_readiness_decisions" ("run_id")
  WHERE "superseded_at" IS NULL;

-- NULL-aware typed provenance uniqueness; the generated all-column unique index is
-- insufficient in PostgreSQL because NULL values are distinct.
CREATE UNIQUE INDEX "final_readiness_provenance_extraction_unique_idx" ON "final_readiness_finding_provenance" ("finding_id", "extraction_citation_id") WHERE "extraction_citation_id" IS NOT NULL;
CREATE UNIQUE INDEX "final_readiness_provenance_risk_unique_idx" ON "final_readiness_finding_provenance" ("finding_id", "risk_finding_id") WHERE "risk_finding_id" IS NOT NULL;
CREATE UNIQUE INDEX "final_readiness_provenance_eligibility_unique_idx" ON "final_readiness_finding_provenance" ("finding_id", "eligibility_assessment_id") WHERE "eligibility_assessment_id" IS NOT NULL;
CREATE UNIQUE INDEX "final_readiness_provenance_evidence_fact_unique_idx" ON "final_readiness_finding_provenance" ("finding_id", "evidence_fact_version_id") WHERE "evidence_fact_version_id" IS NOT NULL;
CREATE UNIQUE INDEX "final_readiness_provenance_evidence_citation_unique_idx" ON "final_readiness_finding_provenance" ("finding_id", "evidence_citation_id") WHERE "evidence_citation_id" IS NOT NULL;
CREATE UNIQUE INDEX "final_readiness_provenance_checklist_unique_idx" ON "final_readiness_finding_provenance" ("finding_id", "checklist_item_id") WHERE "checklist_item_id" IS NOT NULL;
CREATE UNIQUE INDEX "final_readiness_provenance_draft_version_unique_idx" ON "final_readiness_finding_provenance" ("finding_id", "draft_version_id") WHERE "draft_version_id" IS NOT NULL;
CREATE UNIQUE INDEX "final_readiness_provenance_draft_claim_unique_idx" ON "final_readiness_finding_provenance" ("finding_id", "draft_claim_id") WHERE "draft_claim_id" IS NOT NULL;
CREATE UNIQUE INDEX "final_readiness_provenance_draft_citation_unique_idx" ON "final_readiness_finding_provenance" ("finding_id", "draft_citation_id") WHERE "draft_citation_id" IS NOT NULL;
CREATE UNIQUE INDEX "final_readiness_provenance_draft_placeholder_unique_idx" ON "final_readiness_finding_provenance" ("finding_id", "draft_placeholder_id") WHERE "draft_placeholder_id" IS NOT NULL;
CREATE UNIQUE INDEX "final_readiness_provenance_review_unique_idx" ON "final_readiness_finding_provenance" ("finding_id", "draft_review_event_id") WHERE "draft_review_event_id" IS NOT NULL;

-- Composite scope keys make cross-organisation/tender/version links fail closed.
CREATE UNIQUE INDEX "final_readiness_runs_full_scope_key"
  ON "final_readiness_runs" ("id", "organisation_id", "tender_id", "tender_version_id");
CREATE UNIQUE INDEX "final_readiness_runs_version_scope_key"
  ON "final_readiness_runs" ("id", "tender_version_id");
CREATE UNIQUE INDEX "final_readiness_runs_tenant_scope_key"
  ON "final_readiness_runs" ("id", "organisation_id", "tender_id");
CREATE UNIQUE INDEX "final_readiness_findings_tenant_scope_key"
  ON "final_readiness_findings" ("id", "organisation_id");

ALTER TABLE "final_readiness_input_snapshots"
  ADD CONSTRAINT "final_readiness_snapshot_run_scope_fkey"
  FOREIGN KEY ("run_id", "organisation_id", "tender_id", "tender_version_id")
  REFERENCES "final_readiness_runs" ("id", "organisation_id", "tender_id", "tender_version_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "final_readiness_findings"
  ADD CONSTRAINT "final_readiness_findings_run_scope_fkey"
  FOREIGN KEY ("run_id", "organisation_id", "tender_id")
  REFERENCES "final_readiness_runs" ("id", "organisation_id", "tender_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "final_readiness_decisions"
  ADD CONSTRAINT "final_readiness_decisions_run_scope_fkey"
  FOREIGN KEY ("run_id", "organisation_id", "tender_id")
  REFERENCES "final_readiness_runs" ("id", "organisation_id", "tender_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "final_readiness_finding_reviews"
  ADD CONSTRAINT "final_readiness_reviews_finding_scope_fkey"
  FOREIGN KEY ("finding_id", "organisation_id")
  REFERENCES "final_readiness_findings" ("id", "organisation_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "risk_analysis_runs"
  ADD CONSTRAINT "risk_analysis_final_readiness_scope_fkey"
  FOREIGN KEY ("final_readiness_run_id", "organisation_id", "tender_id", "tender_version_id")
  REFERENCES "final_readiness_runs" ("id", "organisation_id", "tender_id", "tender_version_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tender_versions"
  ADD CONSTRAINT "tender_versions_active_final_readiness_scope_fkey"
  FOREIGN KEY ("active_final_readiness_run_id", "id")
  REFERENCES "final_readiness_runs" ("id", "tender_version_id")
  ON DELETE SET NULL ON UPDATE CASCADE;
