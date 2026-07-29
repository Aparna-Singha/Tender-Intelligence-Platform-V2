-- CreateEnum
CREATE TYPE "RiskAnalysisGate" AS ENUM ('EARLY', 'FINAL_READINESS');

-- CreateEnum
CREATE TYPE "RiskAnalysisRunStatus" AS ENUM ('QUEUED', 'ANALYSING', 'VALIDATING', 'COMPLETE', 'FAILED', 'CANCELLED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "RiskAnalysisTriggerType" AS ENUM ('USER', 'RETRY', 'EXTRACTION_CHANGE', 'CORRIGENDUM');

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('INFORMATIONAL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskMateriality" AS ENUM ('NON_MATERIAL', 'MATERIAL', 'POTENTIALLY_BLOCKING', 'BLOCKING_REQUIRES_HUMAN_DISPOSITION');

-- CreateEnum
CREATE TYPE "RiskFindingStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACKNOWLEDGED', 'MITIGATED', 'ACCEPTED_RISK', 'DISMISSED', 'RESOLVED', 'SUPERSEDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "RiskReviewState" AS ENUM ('UNREVIEWED', 'HUMAN_REVIEW_REQUIRED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "RiskReviewAction" AS ENUM ('ACKNOWLEDGE', 'REQUEST_REVIEW', 'CONFIRM', 'DISMISS', 'CHANGE_SEVERITY', 'MARK_MITIGATED', 'ACCEPT_RISK', 'RESOLVE', 'REOPEN');

-- CreateEnum
CREATE TYPE "PursuitDecision" AS ENUM ('CONTINUE', 'HOLD', 'STOP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'RISK_ANALYSIS_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'RISK_ANALYSIS_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'RISK_ANALYSIS_RETRIED';
ALTER TYPE "AuditEventType" ADD VALUE 'RISK_ANALYSIS_ACTIVATED';
ALTER TYPE "AuditEventType" ADD VALUE 'RISK_ANALYSIS_INVALIDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'RISK_FINDING_REVIEWED';
ALTER TYPE "AuditEventType" ADD VALUE 'RISK_PURSUIT_DECISION_RECORDED';
ALTER TYPE "AuditEventType" ADD VALUE 'RISK_PURSUIT_DECISION_SUPERSEDED';

-- AlterTable
ALTER TABLE "tender_versions" ADD COLUMN     "active_early_risk_run_id" UUID;

-- CreateTable
CREATE TABLE "risk_analysis_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "extraction_run_id" UUID NOT NULL,
    "gate_type" "RiskAnalysisGate" NOT NULL DEFAULT 'EARLY',
    "status" "RiskAnalysisRunStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger_type" "RiskAnalysisTriggerType" NOT NULL,
    "risk_policy_version" VARCHAR(80) NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(240) NOT NULL,
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "current_stage" VARCHAR(80) NOT NULL DEFAULT 'QUEUED',
    "public_message" VARCHAR(240) NOT NULL DEFAULT 'Early risk analysis queued',
    "event_sequence" INTEGER NOT NULL DEFAULT 1,
    "requested_by_user_id" UUID NOT NULL,
    "cancellation_requested_at" TIMESTAMPTZ(3),
    "failure_category" VARCHAR(80),
    "safe_failure_message" VARCHAR(240),
    "internal_failure_reference" VARCHAR(128),
    "summary" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "risk_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "extraction_run_id" UUID NOT NULL,
    "risk_analysis_run_id" UUID NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "explanation" VARCHAR(2000) NOT NULL,
    "source_supported_rationale" VARCHAR(4000) NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "confidence" "ExtractionConfidence" NOT NULL,
    "materiality" "RiskMateriality" NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "finding_status" "RiskFindingStatus" NOT NULL DEFAULT 'OPEN',
    "review_state" "RiskReviewState" NOT NULL DEFAULT 'UNREVIEWED',
    "deterministic_rule_id" VARCHAR(120) NOT NULL,
    "deterministic_rule_version" VARCHAR(40) NOT NULL,
    "source_input_fingerprint" CHAR(64) NOT NULL,
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "risk_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_finding_citations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "risk_finding_id" UUID NOT NULL,
    "extraction_citation_id" UUID NOT NULL,
    "validation_status" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_finding_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_finding_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "risk_analysis_run_id" UUID NOT NULL,
    "risk_finding_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" "RiskReviewAction" NOT NULL,
    "previous_status" "RiskFindingStatus" NOT NULL,
    "new_status" "RiskFindingStatus" NOT NULL,
    "previous_severity" "RiskSeverity" NOT NULL,
    "new_severity" "RiskSeverity" NOT NULL,
    "rationale" VARCHAR(1000) NOT NULL,
    "review_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_finding_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "early_pursuit_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "risk_analysis_run_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "decision" "PursuitDecision" NOT NULL,
    "rationale" VARCHAR(2000) NOT NULL,
    "unresolved_high_critical_count" INTEGER NOT NULL,
    "acknowledged_limitations" BOOLEAN NOT NULL,
    "prior_decision_id" UUID,
    "superseded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "early_pursuit_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "risk_analysis_runs_idempotency_key_key" ON "risk_analysis_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "risk_analysis_runs_organisation_id_tender_id_gate_type_stat_idx" ON "risk_analysis_runs"("organisation_id", "tender_id", "gate_type", "status", "created_at");

-- CreateIndex
CREATE INDEX "risk_analysis_runs_tender_version_id_extraction_run_id_crea_idx" ON "risk_analysis_runs"("tender_version_id", "extraction_run_id", "created_at");

-- CreateIndex
CREATE INDEX "risk_analysis_runs_organisation_id_source_fingerprint_risk__idx" ON "risk_analysis_runs"("organisation_id", "source_fingerprint", "risk_policy_version");

-- CreateIndex
CREATE INDEX "risk_findings_organisation_id_risk_analysis_run_id_severity_idx" ON "risk_findings"("organisation_id", "risk_analysis_run_id", "severity", "category");

-- CreateIndex
CREATE INDEX "risk_findings_risk_analysis_run_id_finding_status_review_st_idx" ON "risk_findings"("risk_analysis_run_id", "finding_status", "review_state", "blocking");

-- CreateIndex
CREATE INDEX "risk_finding_citations_extraction_citation_id_idx" ON "risk_finding_citations"("extraction_citation_id");

-- CreateIndex
CREATE UNIQUE INDEX "risk_finding_citations_risk_finding_id_extraction_citation__key" ON "risk_finding_citations"("risk_finding_id", "extraction_citation_id");

-- CreateIndex
CREATE INDEX "risk_finding_reviews_organisation_id_risk_analysis_run_id_r_idx" ON "risk_finding_reviews"("organisation_id", "risk_analysis_run_id", "risk_finding_id");

-- CreateIndex
CREATE UNIQUE INDEX "risk_finding_reviews_risk_finding_id_review_version_key" ON "risk_finding_reviews"("risk_finding_id", "review_version");

-- CreateIndex
CREATE INDEX "early_pursuit_decisions_organisation_id_tender_id_tender_ve_idx" ON "early_pursuit_decisions"("organisation_id", "tender_id", "tender_version_id", "created_at");

-- CreateIndex
CREATE INDEX "early_pursuit_decisions_risk_analysis_run_id_superseded_at_idx" ON "early_pursuit_decisions"("risk_analysis_run_id", "superseded_at");

-- CreateIndex
CREATE UNIQUE INDEX "tender_versions_active_early_risk_run_id_key" ON "tender_versions"("active_early_risk_run_id");

-- AddForeignKey
ALTER TABLE "tender_versions" ADD CONSTRAINT "tender_versions_active_early_risk_run_id_fkey" FOREIGN KEY ("active_early_risk_run_id") REFERENCES "risk_analysis_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_analysis_runs" ADD CONSTRAINT "risk_analysis_runs_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_analysis_runs" ADD CONSTRAINT "risk_analysis_runs_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_analysis_runs" ADD CONSTRAINT "risk_analysis_runs_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_analysis_runs" ADD CONSTRAINT "risk_analysis_runs_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_analysis_runs" ADD CONSTRAINT "risk_analysis_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_findings" ADD CONSTRAINT "risk_findings_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_findings" ADD CONSTRAINT "risk_findings_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_findings" ADD CONSTRAINT "risk_findings_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_findings" ADD CONSTRAINT "risk_findings_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_findings" ADD CONSTRAINT "risk_findings_risk_analysis_run_id_fkey" FOREIGN KEY ("risk_analysis_run_id") REFERENCES "risk_analysis_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_finding_citations" ADD CONSTRAINT "risk_finding_citations_risk_finding_id_fkey" FOREIGN KEY ("risk_finding_id") REFERENCES "risk_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_finding_citations" ADD CONSTRAINT "risk_finding_citations_extraction_citation_id_fkey" FOREIGN KEY ("extraction_citation_id") REFERENCES "extraction_citations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_finding_reviews" ADD CONSTRAINT "risk_finding_reviews_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_finding_reviews" ADD CONSTRAINT "risk_finding_reviews_risk_analysis_run_id_fkey" FOREIGN KEY ("risk_analysis_run_id") REFERENCES "risk_analysis_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_finding_reviews" ADD CONSTRAINT "risk_finding_reviews_risk_finding_id_fkey" FOREIGN KEY ("risk_finding_id") REFERENCES "risk_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_finding_reviews" ADD CONSTRAINT "risk_finding_reviews_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_pursuit_decisions" ADD CONSTRAINT "early_pursuit_decisions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_pursuit_decisions" ADD CONSTRAINT "early_pursuit_decisions_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_pursuit_decisions" ADD CONSTRAINT "early_pursuit_decisions_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_pursuit_decisions" ADD CONSTRAINT "early_pursuit_decisions_risk_analysis_run_id_fkey" FOREIGN KEY ("risk_analysis_run_id") REFERENCES "risk_analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_pursuit_decisions" ADD CONSTRAINT "early_pursuit_decisions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_pursuit_decisions" ADD CONSTRAINT "early_pursuit_decisions_prior_decision_id_fkey" FOREIGN KEY ("prior_decision_id") REFERENCES "early_pursuit_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Authoritative workflow bounds. Recovery is forward-only: correct invalid rows,
-- deploy a follow-up migration, and rerun analysis; historical runs are retained.
ALTER TABLE "risk_analysis_runs"
  ADD CONSTRAINT "risk_analysis_runs_progress_check"
  CHECK ("progress_percentage" BETWEEN 0 AND 100),
  ADD CONSTRAINT "risk_analysis_runs_event_sequence_check"
  CHECK ("event_sequence" > 0);

ALTER TABLE "risk_findings"
  ADD CONSTRAINT "risk_findings_rule_identity_check"
  CHECK (
    length("deterministic_rule_id") > 0
    AND length("deterministic_rule_version") > 0
  );

ALTER TABLE "risk_finding_reviews"
  ADD CONSTRAINT "risk_finding_reviews_version_check"
  CHECK ("review_version" > 0 AND length("rationale") >= 10);

ALTER TABLE "early_pursuit_decisions"
  ADD CONSTRAINT "early_pursuit_decisions_counts_and_rationale_check"
  CHECK (
    "unresolved_high_critical_count" >= 0
    AND length("rationale") >= 20
    AND "acknowledged_limitations" = TRUE
  );
