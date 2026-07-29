ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_GENERATION_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_GENERATION_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_GENERATION_RETRIED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_GENERATION_ACTIVATED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_GENERATION_INVALIDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_ITEM_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_ITEM_ASSIGNED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_ITEM_PRIORITY_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_ITEM_DUE_DATE_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_ITEM_WORK_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_ITEM_BLOCKED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_ITEM_READY_FOR_REASSESSMENT';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_ITEM_RESOLVED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_ITEM_DISMISSED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_ITEM_REOPENED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_SOURCE_OPENED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_REASSESSMENT_REQUESTED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHECKLIST_ACTION_DENIED';

CREATE TYPE "ChecklistGenerationRunStatus" AS ENUM ('QUEUED', 'LOADING_ASSESSMENTS', 'GENERATING', 'DEDUPLICATING', 'VALIDATING', 'COMPLETE', 'FAILED', 'CANCELLED', 'INVALIDATED');
CREATE TYPE "ChecklistTriggerType" AS ENUM ('USER', 'RETRY');
CREATE TYPE "ChecklistPriority" AS ENUM ('BLOCKING', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "ChecklistItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'READY_FOR_REASSESSMENT', 'RESOLVED', 'DISMISSED', 'SUPERSEDED', 'INVALIDATED');
CREATE TYPE "ChecklistDateSource" AS ENUM ('REQUIREMENT_DEADLINE', 'CLARIFICATION_DEADLINE', 'PRE_BID_DATE', 'SUBMISSION_DEADLINE', 'EVIDENCE_EXPIRY', 'INTERNAL_BUFFER', 'HUMAN_ASSIGNED', 'UNSPECIFIED');
CREATE TYPE "ChecklistHistoryAction" AS ENUM ('CREATE_FROM_POLICY', 'EDIT_TITLE', 'EDIT_DESCRIPTION', 'CHANGE_PRIORITY', 'ASSIGN', 'UNASSIGN', 'SET_DUE_DATE', 'START', 'BLOCK', 'UNBLOCK', 'MARK_READY_FOR_REASSESSMENT', 'MARK_RESOLVED', 'DISMISS', 'REOPEN', 'SUPERSEDE', 'INVALIDATE', 'ADD_RESOLUTION_NOTE');
CREATE TYPE "ChecklistItemType" AS ENUM ('OBTAIN_DOCUMENT', 'UPLOAD_DOCUMENT', 'RENEW_DOCUMENT', 'VERIFY_DOCUMENT', 'REVIEW_DOCUMENT_CONTENT', 'CAPTURE_EVIDENCE_FACT', 'LINK_EXISTING_EVIDENCE', 'VERIFY_SELF_DECLARED_FACT', 'PROVIDE_FINANCIAL_EVIDENCE', 'PROVIDE_EXPERIENCE_EVIDENCE', 'OBTAIN_OEM_AUTHORISATION', 'PROVIDE_CERTIFICATION', 'PROVIDE_LICENCE', 'UPDATE_COMPANY_PROFILE', 'RESOLVE_EVIDENCE_CONFLICT', 'REVIEW_REQUIREMENT', 'CONFIRM_APPLICABILITY', 'SEEK_TENDER_CLARIFICATION', 'TECHNICAL_REVIEW', 'COMMERCIAL_REVIEW', 'LEGAL_REVIEW', 'READY_FOR_REASSESSMENT', 'OTHER');

CREATE TABLE "checklist_generation_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL,
  "tender_id" UUID NOT NULL,
  "tender_version_id" UUID NOT NULL,
  "extraction_run_id" UUID NOT NULL,
  "risk_analysis_run_id" UUID NOT NULL,
  "pursuit_decision_id" UUID NOT NULL,
  "assessment_run_id" UUID NOT NULL,
  "evidence_snapshot_id" UUID NOT NULL,
  "status" "ChecklistGenerationRunStatus" NOT NULL DEFAULT 'QUEUED',
  "trigger_type" "ChecklistTriggerType" NOT NULL,
  "checklist_policy_version" VARCHAR(80) NOT NULL,
  "priority_policy_version" VARCHAR(80) NOT NULL,
  "date_policy_version" VARCHAR(80) NOT NULL,
  "deduplication_policy_version" VARCHAR(80) NOT NULL,
  "source_fingerprint" CHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(240) NOT NULL,
  "progress_percentage" INTEGER NOT NULL DEFAULT 0,
  "current_stage" VARCHAR(80) NOT NULL DEFAULT 'QUEUED',
  "public_message" VARCHAR(240) NOT NULL DEFAULT 'Checklist generation queued',
  "event_sequence" INTEGER NOT NULL DEFAULT 1,
  "requested_by_user_id" UUID NOT NULL,
  "cancellation_requested_at" TIMESTAMPTZ(3),
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "failure_category" VARCHAR(80),
  "safe_failure_message" VARCHAR(240),
  "internal_failure_reference" VARCHAR(128),
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "activated_at" TIMESTAMPTZ(3),
  "invalidated_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "checklist_generation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checklist_generation_runs_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE,
  CONSTRAINT "checklist_generation_runs_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE,
  CONSTRAINT "checklist_generation_runs_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "checklist_generation_runs_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE RESTRICT,
  CONSTRAINT "checklist_generation_runs_risk_analysis_run_id_fkey" FOREIGN KEY ("risk_analysis_run_id") REFERENCES "risk_analysis_runs"("id") ON DELETE RESTRICT,
  CONSTRAINT "checklist_generation_runs_pursuit_decision_id_fkey" FOREIGN KEY ("pursuit_decision_id") REFERENCES "early_pursuit_decisions"("id") ON DELETE RESTRICT,
  CONSTRAINT "checklist_generation_runs_assessment_run_id_fkey" FOREIGN KEY ("assessment_run_id") REFERENCES "eligibility_assessment_runs"("id") ON DELETE RESTRICT,
  CONSTRAINT "checklist_generation_runs_evidence_snapshot_id_fkey" FOREIGN KEY ("evidence_snapshot_id") REFERENCES "eligibility_input_snapshots"("id") ON DELETE RESTRICT,
  CONSTRAINT "checklist_generation_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "checklist_generation_runs_idempotency_key_key" ON "checklist_generation_runs"("idempotency_key");
CREATE UNIQUE INDEX "checklist_one_active_run_per_version" ON "checklist_generation_runs"("organisation_id", "tender_version_id") WHERE "activated_at" IS NOT NULL AND "invalidated_at" IS NULL;
CREATE INDEX "checklist_generation_runs_scope_idx" ON "checklist_generation_runs"("organisation_id", "tender_id", "tender_version_id", "status", "created_at");
CREATE INDEX "checklist_generation_runs_source_idx" ON "checklist_generation_runs"("organisation_id", "assessment_run_id", "source_fingerprint");

CREATE TABLE "checklist_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL,
  "tender_id" UUID NOT NULL,
  "tender_version_id" UUID NOT NULL,
  "generation_run_id" UUID NOT NULL,
  "item_type" "ChecklistItemType" NOT NULL,
  "proposed_title" VARCHAR(240) NOT NULL,
  "current_title" VARCHAR(240) NOT NULL,
  "proposed_explanation" VARCHAR(2000) NOT NULL,
  "current_description" VARCHAR(2000),
  "proposed_priority" "ChecklistPriority" NOT NULL,
  "current_priority" "ChecklistPriority" NOT NULL,
  "priority_rationale" VARCHAR(1000) NOT NULL,
  "evidence_need_category" VARCHAR(80) NOT NULL,
  "completion_criteria" VARCHAR(1000) NOT NULL,
  "proposed_target_date" TIMESTAMPTZ(3),
  "current_due_date" TIMESTAMPTZ(3),
  "date_source" "ChecklistDateSource" NOT NULL DEFAULT 'UNSPECIFIED',
  "date_is_official" BOOLEAN NOT NULL DEFAULT false,
  "status" "ChecklistItemStatus" NOT NULL DEFAULT 'OPEN',
  "assignee_user_id" UUID,
  "blocked_reason" VARCHAR(1000),
  "resolution_note" VARCHAR(1000),
  "dismissal_rationale" VARCHAR(1000),
  "generation_rule_id" VARCHAR(120) NOT NULL,
  "policy_version" VARCHAR(80) NOT NULL,
  "deduplication_key" CHAR(64) NOT NULL,
  "source_fingerprint" CHAR(64) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "dismissed_at" TIMESTAMPTZ(3),
  "superseded_at" TIMESTAMPTZ(3),
  "invalidated_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checklist_items_generation_run_id_fkey" FOREIGN KEY ("generation_run_id") REFERENCES "checklist_generation_runs"("id") ON DELETE CASCADE,
  CONSTRAINT "checklist_items_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE,
  CONSTRAINT "checklist_items_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE,
  CONSTRAINT "checklist_items_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "checklist_items_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "checklist_items_generation_run_id_deduplication_key_key" ON "checklist_items"("generation_run_id", "deduplication_key");
CREATE INDEX "checklist_items_scope_idx" ON "checklist_items"("organisation_id", "tender_id", "generation_run_id", "status", "current_priority");
CREATE INDEX "checklist_items_assignment_idx" ON "checklist_items"("organisation_id", "assignee_user_id", "current_due_date");

CREATE TABLE "checklist_item_assessment_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "checklist_item_id" UUID NOT NULL,
  "eligibility_assessment_id" UUID NOT NULL, "assessment_state" "EligibilityState" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checklist_item_assessment_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checklist_item_assessment_links_item_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "checklist_items"("id") ON DELETE CASCADE,
  CONSTRAINT "checklist_item_assessment_links_assessment_fkey" FOREIGN KEY ("eligibility_assessment_id") REFERENCES "eligibility_assessments"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "checklist_item_assessment_links_unique" ON "checklist_item_assessment_links"("checklist_item_id", "eligibility_assessment_id");
CREATE INDEX "checklist_item_assessment_links_assessment_idx" ON "checklist_item_assessment_links"("eligibility_assessment_id");

CREATE TABLE "checklist_item_requirement_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "checklist_item_id" UUID NOT NULL,
  "structured_requirement_id" UUID NOT NULL, "requirement_category" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checklist_item_requirement_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checklist_item_requirement_links_item_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "checklist_items"("id") ON DELETE CASCADE,
  CONSTRAINT "checklist_item_requirement_links_requirement_fkey" FOREIGN KEY ("structured_requirement_id") REFERENCES "structured_requirements"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "checklist_item_requirement_links_unique" ON "checklist_item_requirement_links"("checklist_item_id", "structured_requirement_id");
CREATE INDEX "checklist_item_requirement_links_requirement_idx" ON "checklist_item_requirement_links"("structured_requirement_id");

CREATE TABLE "checklist_item_source_citations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "checklist_item_id" UUID NOT NULL,
  "extraction_citation_id" UUID NOT NULL, "evidence_citation_id" UUID,
  "source_kind" VARCHAR(40) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checklist_item_source_citations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checklist_item_source_citations_item_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "checklist_items"("id") ON DELETE CASCADE,
  CONSTRAINT "checklist_item_source_citations_extraction_fkey" FOREIGN KEY ("extraction_citation_id") REFERENCES "extraction_citations"("id") ON DELETE RESTRICT,
  CONSTRAINT "checklist_item_source_citations_evidence_fkey" FOREIGN KEY ("evidence_citation_id") REFERENCES "company_evidence_citations"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "checklist_item_source_citations_unique" ON "checklist_item_source_citations"("checklist_item_id", "extraction_citation_id", "evidence_citation_id");
CREATE INDEX "checklist_item_source_citations_extraction_idx" ON "checklist_item_source_citations"("extraction_citation_id");

CREATE TABLE "checklist_item_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organisation_id" UUID NOT NULL,
  "checklist_item_id" UUID NOT NULL, "action" "ChecklistHistoryAction" NOT NULL,
  "previous_state" "ChecklistItemStatus", "new_state" "ChecklistItemStatus",
  "previous_priority" "ChecklistPriority", "new_priority" "ChecklistPriority",
  "previous_assignee_id" UUID, "new_assignee_id" UUID, "rationale" VARCHAR(1000) NOT NULL,
  "actor_user_id" UUID, "event_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checklist_item_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checklist_item_history_item_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "checklist_items"("id") ON DELETE CASCADE,
  CONSTRAINT "checklist_item_history_organisation_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE,
  CONSTRAINT "checklist_item_history_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "checklist_item_history_item_version_key" ON "checklist_item_history"("checklist_item_id", "event_version");
CREATE INDEX "checklist_item_history_scope_idx" ON "checklist_item_history"("organisation_id", "checklist_item_id", "created_at");

-- Forward recovery: this migration is additive. Rollback before dependent data
-- exists may drop the six tables and seven checklist enum types; after use, retain
-- history and deploy a compensating migration instead of destroying audit records.
