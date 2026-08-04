ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_PREFLIGHT_EVALUATED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_GENERATION_REQUESTED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_GENERATION_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_GENERATION_COMPLETED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_GENERATION_FAILED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_REGENERATED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_REVIEWED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_REJECTED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_INVALIDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_REVOKED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_DOWNLOAD_GRANT_ISSUED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_DOWNLOAD_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE 'CONTROLLED_PACKAGE_DOWNLOAD_COMPLETED';

CREATE TYPE "ControlledPackageGenerationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'GENERATED', 'FAILED', 'CANCELLED', 'INVALIDATED');
CREATE TYPE "ControlledPackageReviewStatus" AS ENUM ('NOT_REVIEWED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'REVOKED', 'SUPERSEDED');
CREATE TYPE "ControlledPackageArtifactKind" AS ENUM ('PACKAGE_ZIP');
CREATE TYPE "ControlledPackageMemberKind" AS ENUM ('REVIEW_PDF', 'MANIFEST_JSON', 'CHECKSUMS_TEXT', 'PROVENANCE_INDEX_JSON');
CREATE TYPE "ControlledPackageReviewOutcome" AS ENUM ('COMMENTED', 'REVIEW_COMPLETE');
CREATE TYPE "ControlledPackageApprovalOutcome" AS ENUM ('APPROVED_FOR_CONTROLLED_DOWNLOAD', 'REJECTED');
CREATE TYPE "ControlledPackageMalwareStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');
CREATE TYPE "ControlledPackagePromotionStatus" AS ENUM ('PENDING', 'PROMOTED', 'FAILED');
CREATE TYPE "ControlledPackageProvenanceKind" AS ENUM ('SOURCE_DOCUMENT', 'EXTRACTION_CITATION', 'RISK_FINDING', 'ELIGIBILITY_ASSESSMENT', 'EVIDENCE_FACT_VERSION', 'EVIDENCE_CITATION', 'CHECKLIST_ITEM', 'DRAFT_VERSION', 'DRAFT_CLAIM', 'DRAFT_CITATION', 'FINAL_READINESS_FINDING');

CREATE TABLE "export_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(120) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "active_version_id" UUID,
  "retired_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "export_template_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "template_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "layout" JSONB NOT NULL,
  "template_policy_version" VARCHAR(80) NOT NULL,
  "source_fingerprint" CHAR(64) NOT NULL,
  "approved_at" TIMESTAMPTZ(3),
  "retired_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_template_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "export_template_version_positive_check" CHECK ("version_number" > 0),
  CONSTRAINT "export_template_version_fingerprint_check" CHECK ("source_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "export_template_version_dates_check" CHECK ("retired_at" IS NULL OR "approved_at" IS NOT NULL)
);

CREATE TABLE "controlled_review_package_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL,
  "tender_id" UUID NOT NULL,
  "tender_version_id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "requester_role_at_action" "Role" NOT NULL,
  "template_version_id" UUID NOT NULL,
  "retry_of_run_id" UUID,
  "supersedes_run_id" UUID,
  "generation_status" "ControlledPackageGenerationStatus" NOT NULL DEFAULT 'QUEUED',
  "review_status" "ControlledPackageReviewStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
  "generation_policy_version" VARCHAR(80) NOT NULL,
  "content_policy_version" VARCHAR(80) NOT NULL,
  "renderer_compatibility_version" VARCHAR(80) NOT NULL,
  "input_fingerprint" CHAR(64) NOT NULL,
  "logical_content_fingerprint" CHAR(64),
  "idempotency_key" VARCHAR(120) NOT NULL,
  "review_version" INTEGER NOT NULL DEFAULT 0,
  "cancellation_requested_at" TIMESTAMPTZ(3),
  "safe_failure_code" VARCHAR(120),
  "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "generated_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "stale_at" TIMESTAMPTZ(3),
  "invalidated_at" TIMESTAMPTZ(3),
  "superseded_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "controlled_review_package_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "controlled_package_requester_role_check" CHECK ("requester_role_at_action" IN ('OWNER', 'ADMIN', 'TENDER_EXECUTIVE', 'CONSULTANT')),
  CONSTRAINT "controlled_package_fingerprint_check" CHECK ("input_fingerprint" ~ '^[a-f0-9]{64}$' AND ("logical_content_fingerprint" IS NULL OR "logical_content_fingerprint" ~ '^[a-f0-9]{64}$')),
  CONSTRAINT "controlled_package_review_version_check" CHECK ("review_version" >= 0),
  CONSTRAINT "controlled_package_retry_not_self_check" CHECK ("retry_of_run_id" IS NULL OR "retry_of_run_id" <> "id"),
  CONSTRAINT "controlled_package_supersession_not_self_check" CHECK ("supersedes_run_id" IS NULL OR "supersedes_run_id" <> "id"),
  CONSTRAINT "controlled_package_lifecycle_dates_check" CHECK (
    ("started_at" IS NULL OR "started_at" >= "queued_at") AND
    ("generated_at" IS NULL OR "started_at" IS NOT NULL) AND
    ("failed_at" IS NULL OR "started_at" IS NOT NULL) AND
    ("cancelled_at" IS NULL OR "cancelled_at" >= "queued_at") AND
    ("invalidated_at" IS NULL OR "invalidated_at" >= "queued_at")
  )
);

CREATE TABLE "controlled_review_package_input_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "run_id" UUID NOT NULL,
  "organisation_id" UUID NOT NULL, "tender_id" UUID NOT NULL, "tender_version_id" UUID NOT NULL,
  "final_readiness_run_id" UUID NOT NULL, "final_risk_run_id" UUID NOT NULL,
  "final_readiness_decision_id" UUID NOT NULL, "final_readiness_snapshot_id" UUID NOT NULL,
  "draft_version_id" UUID NOT NULL, "draft_approval_review_event_id" UUID NOT NULL,
  "draft_creator_user_id" UUID NOT NULL, "draft_approver_role_at_action" "Role" NOT NULL,
  "extraction_run_id" UUID NOT NULL, "early_risk_run_id" UUID NOT NULL,
  "pursuit_decision_id" UUID NOT NULL, "eligibility_assessment_run_id" UUID NOT NULL,
  "eligibility_input_snapshot_id" UUID NOT NULL, "checklist_generation_run_id" UUID NOT NULL,
  "template_version_id" UUID NOT NULL, "input_fingerprint" CHAR(64) NOT NULL,
  "generation_policy_version" VARCHAR(80) NOT NULL, "content_policy_version" VARCHAR(80) NOT NULL,
  "canonical_render_timestamp" TIMESTAMPTZ(3) NOT NULL,
  "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "controlled_review_package_input_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "controlled_package_snapshot_fingerprint_check" CHECK ("input_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "controlled_package_snapshot_approver_role_check" CHECK ("draft_approver_role_at_action" IN ('OWNER', 'ADMIN', 'REVIEWER'))
);

CREATE TABLE "controlled_package_snapshot_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "snapshot_id" UUID NOT NULL,
  "organisation_id" UUID NOT NULL, "tender_id" UUID NOT NULL, "tender_document_id" UUID NOT NULL,
  "checksum" CHAR(64) NOT NULL, "source_identifier" VARCHAR(240) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "controlled_package_snapshot_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "controlled_package_snapshot_document_checksum_check" CHECK ("checksum" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "controlled_package_snapshot_provenance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "snapshot_id" UUID NOT NULL,
  "organisation_id" UUID NOT NULL, "tender_id" UUID NOT NULL,
  "kind" "ControlledPackageProvenanceKind" NOT NULL,
  "tender_document_id" UUID, "extraction_citation_id" UUID, "risk_finding_id" UUID,
  "eligibility_assessment_id" UUID, "evidence_fact_version_id" UUID, "evidence_citation_id" UUID,
  "checklist_item_id" UUID, "draft_version_id" UUID, "draft_claim_id" UUID,
  "draft_citation_id" UUID, "final_readiness_finding_id" UUID,
  "safe_handle" VARCHAR(160) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "controlled_package_snapshot_provenance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "controlled_package_provenance_exactly_one_source_check" CHECK (num_nonnulls("tender_document_id", "extraction_citation_id", "risk_finding_id", "eligibility_assessment_id", "evidence_fact_version_id", "evidence_citation_id", "checklist_item_id", "draft_version_id", "draft_claim_id", "draft_citation_id", "final_readiness_finding_id") = 1),
  CONSTRAINT "controlled_package_provenance_kind_matches_source_check" CHECK (
    ("kind" = 'SOURCE_DOCUMENT' AND "tender_document_id" IS NOT NULL) OR
    ("kind" = 'EXTRACTION_CITATION' AND "extraction_citation_id" IS NOT NULL) OR
    ("kind" = 'RISK_FINDING' AND "risk_finding_id" IS NOT NULL) OR
    ("kind" = 'ELIGIBILITY_ASSESSMENT' AND "eligibility_assessment_id" IS NOT NULL) OR
    ("kind" = 'EVIDENCE_FACT_VERSION' AND "evidence_fact_version_id" IS NOT NULL) OR
    ("kind" = 'EVIDENCE_CITATION' AND "evidence_citation_id" IS NOT NULL) OR
    ("kind" = 'CHECKLIST_ITEM' AND "checklist_item_id" IS NOT NULL) OR
    ("kind" = 'DRAFT_VERSION' AND "draft_version_id" IS NOT NULL) OR
    ("kind" = 'DRAFT_CLAIM' AND "draft_claim_id" IS NOT NULL) OR
    ("kind" = 'DRAFT_CITATION' AND "draft_citation_id" IS NOT NULL) OR
    ("kind" = 'FINAL_READINESS_FINDING' AND "final_readiness_finding_id" IS NOT NULL)
  )
);

CREATE TABLE "package_artifacts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "run_id" UUID NOT NULL,
  "organisation_id" UUID NOT NULL, "tender_id" UUID NOT NULL,
  "kind" "ControlledPackageArtifactKind" NOT NULL, "private_object_key" VARCHAR(1024) NOT NULL,
  "safe_filename" VARCHAR(120) NOT NULL, "mime_type" VARCHAR(120) NOT NULL,
  "byte_size" BIGINT NOT NULL, "sha256" CHAR(64) NOT NULL,
  "malware_status" "ControlledPackageMalwareStatus" NOT NULL DEFAULT 'PENDING',
  "promotion_status" "ControlledPackagePromotionStatus" NOT NULL DEFAULT 'PENDING',
  "integrity_verified_at" TIMESTAMPTZ(3), "promoted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "package_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "package_artifact_byte_size_check" CHECK ("byte_size" >= 0 AND "byte_size" <= 104857600),
  CONSTRAINT "package_artifact_checksum_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "package_artifact_filename_check" CHECK (octet_length("safe_filename") <= 120 AND "safe_filename" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  CONSTRAINT "package_artifact_promotion_check" CHECK (("promotion_status" <> 'PROMOTED') OR ("promoted_at" IS NOT NULL AND "integrity_verified_at" IS NOT NULL AND "malware_status" = 'CLEAN'))
);

CREATE TABLE "package_manifests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "run_id" UUID NOT NULL,
  "organisation_id" UUID NOT NULL, "tender_id" UUID NOT NULL,
  "schema_version" VARCHAR(80) NOT NULL, "logical_content_fingerprint" CHAR(64) NOT NULL,
  "generated_at" TIMESTAMPTZ(3) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "package_manifests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "package_manifest_fingerprint_check" CHECK ("logical_content_fingerprint" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "package_manifest_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "manifest_id" UUID NOT NULL,
  "kind" "ControlledPackageMemberKind" NOT NULL, "logical_path" VARCHAR(120) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL, "byte_size" BIGINT NOT NULL, "sha256" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "package_manifest_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "package_member_byte_size_check" CHECK ("byte_size" >= 0 AND "byte_size" <= 52428800),
  CONSTRAINT "package_member_checksum_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "package_member_path_check" CHECK (octet_length("logical_path") <= 120 AND "logical_path" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' AND "logical_path" !~ '\.\.')
);

CREATE TABLE "package_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "run_id" UUID NOT NULL,
  "organisation_id" UUID NOT NULL, "tender_id" UUID NOT NULL,
  "reviewer_user_id" UUID NOT NULL, "reviewer_role_at_action" "Role" NOT NULL,
  "outcome" "ControlledPackageReviewOutcome" NOT NULL, "comment" VARCHAR(2000) NOT NULL,
  "review_version" INTEGER NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "package_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "package_review_role_check" CHECK ("reviewer_role_at_action" IN ('OWNER', 'ADMIN', 'REVIEWER')),
  CONSTRAINT "package_review_version_check" CHECK ("review_version" > 0)
);

CREATE TABLE "package_approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "run_id" UUID NOT NULL,
  "organisation_id" UUID NOT NULL, "tender_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL, "actor_role_at_action" "Role" NOT NULL,
  "outcome" "ControlledPackageApprovalOutcome" NOT NULL, "rationale" VARCHAR(2000) NOT NULL,
  "run_fingerprint" CHAR(64) NOT NULL, "review_version" INTEGER NOT NULL,
  "supersedes_approval_id" UUID, "superseded_at" TIMESTAMPTZ(3), "revoked_at" TIMESTAMPTZ(3),
  "revocation_reason" VARCHAR(120), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "package_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "package_approval_role_check" CHECK ("actor_role_at_action" IN ('OWNER', 'ADMIN', 'REVIEWER')),
  CONSTRAINT "package_approval_fingerprint_check" CHECK ("run_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "package_approval_version_check" CHECK ("review_version" >= 0),
  CONSTRAINT "package_approval_revocation_check" CHECK (("revoked_at" IS NULL AND "revocation_reason" IS NULL) OR ("revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL))
);

CREATE TABLE "package_download_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "run_id" UUID NOT NULL, "artifact_id" UUID NOT NULL,
  "organisation_id" UUID NOT NULL, "tender_id" UUID NOT NULL, "requested_by_user_id" UUID NOT NULL,
  "requester_role_at_action" "Role" NOT NULL, "run_fingerprint" CHAR(64) NOT NULL,
  "artifact_checksum" CHAR(64) NOT NULL, "request_id" VARCHAR(128) NOT NULL,
  "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "invalidated_at" TIMESTAMPTZ(3), "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "package_download_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "package_download_grant_expiry_check" CHECK ("expires_at" > "issued_at"),
  CONSTRAINT "package_download_grant_checksum_check" CHECK ("run_fingerprint" ~ '^[a-f0-9]{64}$' AND "artifact_checksum" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "package_download_grant_role_check" CHECK ("requester_role_at_action" IN ('OWNER', 'ADMIN', 'TENDER_EXECUTIVE', 'REVIEWER'))
);

ALTER TABLE "tender_versions" ADD COLUMN "current_controlled_package_run_id" UUID;

CREATE UNIQUE INDEX "export_templates_key_key" ON "export_templates"("key");
CREATE UNIQUE INDEX "export_templates_active_version_id_key" ON "export_templates"("active_version_id");
CREATE UNIQUE INDEX "export_template_versions_template_id_version_number_key" ON "export_template_versions"("template_id", "version_number");
CREATE INDEX "export_template_versions_template_id_approved_at_retired_at_idx" ON "export_template_versions"("template_id", "approved_at", "retired_at");
CREATE UNIQUE INDEX "controlled_package_runs_idempotency_key" ON "controlled_review_package_runs"("organisation_id", "tender_id", "idempotency_key");
CREATE UNIQUE INDEX "controlled_package_one_active_run_per_version_idx" ON "controlled_review_package_runs"("tender_version_id") WHERE "generation_status" IN ('QUEUED', 'PROCESSING');
CREATE UNIQUE INDEX "controlled_package_runs_full_scope_key" ON "controlled_review_package_runs"("id", "organisation_id", "tender_id", "tender_version_id");
CREATE UNIQUE INDEX "controlled_package_runs_tenant_scope_key" ON "controlled_review_package_runs"("id", "organisation_id", "tender_id");
CREATE UNIQUE INDEX "controlled_package_runs_version_scope_key" ON "controlled_review_package_runs"("id", "tender_version_id");
CREATE UNIQUE INDEX "controlled_package_input_snapshots_run_id_key" ON "controlled_review_package_input_snapshots"("run_id");
CREATE UNIQUE INDEX "controlled_package_snapshots_scope_key" ON "controlled_review_package_input_snapshots"("id", "organisation_id", "tender_id");
CREATE UNIQUE INDEX "controlled_package_snapshot_documents_unique" ON "controlled_package_snapshot_documents"("snapshot_id", "tender_document_id");
CREATE UNIQUE INDEX "controlled_package_snapshot_provenance_handle_key" ON "controlled_package_snapshot_provenance"("snapshot_id", "safe_handle");
CREATE UNIQUE INDEX "package_artifacts_private_object_key_key" ON "package_artifacts"("private_object_key");
CREATE UNIQUE INDEX "package_artifacts_run_id_kind_key" ON "package_artifacts"("run_id", "kind");
CREATE UNIQUE INDEX "package_artifacts_scope_key" ON "package_artifacts"("id", "run_id", "organisation_id", "tender_id");
CREATE UNIQUE INDEX "package_manifests_run_id_key" ON "package_manifests"("run_id");
CREATE UNIQUE INDEX "package_manifest_members_manifest_id_kind_key" ON "package_manifest_members"("manifest_id", "kind");
CREATE UNIQUE INDEX "package_manifest_members_manifest_id_logical_path_key" ON "package_manifest_members"("manifest_id", "logical_path");
CREATE UNIQUE INDEX "package_reviews_run_id_review_version_key" ON "package_reviews"("run_id", "review_version");
CREATE UNIQUE INDEX "package_one_effective_approval_per_run_idx" ON "package_approvals"("run_id") WHERE "outcome" = 'APPROVED_FOR_CONTROLLED_DOWNLOAD' AND "superseded_at" IS NULL AND "revoked_at" IS NULL;
CREATE UNIQUE INDEX "tender_versions_current_controlled_package_run_id_key" ON "tender_versions"("current_controlled_package_run_id");

CREATE UNIQUE INDEX "controlled_package_provenance_document_unique" ON "controlled_package_snapshot_provenance"("snapshot_id", "tender_document_id") WHERE "tender_document_id" IS NOT NULL;
CREATE UNIQUE INDEX "controlled_package_provenance_extraction_unique" ON "controlled_package_snapshot_provenance"("snapshot_id", "extraction_citation_id") WHERE "extraction_citation_id" IS NOT NULL;
CREATE UNIQUE INDEX "controlled_package_provenance_risk_unique" ON "controlled_package_snapshot_provenance"("snapshot_id", "risk_finding_id") WHERE "risk_finding_id" IS NOT NULL;
CREATE UNIQUE INDEX "controlled_package_provenance_eligibility_unique" ON "controlled_package_snapshot_provenance"("snapshot_id", "eligibility_assessment_id") WHERE "eligibility_assessment_id" IS NOT NULL;
CREATE UNIQUE INDEX "controlled_package_provenance_evidence_fact_unique" ON "controlled_package_snapshot_provenance"("snapshot_id", "evidence_fact_version_id") WHERE "evidence_fact_version_id" IS NOT NULL;
CREATE UNIQUE INDEX "controlled_package_provenance_evidence_citation_unique" ON "controlled_package_snapshot_provenance"("snapshot_id", "evidence_citation_id") WHERE "evidence_citation_id" IS NOT NULL;
CREATE UNIQUE INDEX "controlled_package_provenance_checklist_unique" ON "controlled_package_snapshot_provenance"("snapshot_id", "checklist_item_id") WHERE "checklist_item_id" IS NOT NULL;
CREATE UNIQUE INDEX "controlled_package_provenance_draft_version_unique" ON "controlled_package_snapshot_provenance"("snapshot_id", "draft_version_id") WHERE "draft_version_id" IS NOT NULL;
CREATE UNIQUE INDEX "controlled_package_provenance_draft_claim_unique" ON "controlled_package_snapshot_provenance"("snapshot_id", "draft_claim_id") WHERE "draft_claim_id" IS NOT NULL;
CREATE UNIQUE INDEX "controlled_package_provenance_draft_citation_unique" ON "controlled_package_snapshot_provenance"("snapshot_id", "draft_citation_id") WHERE "draft_citation_id" IS NOT NULL;
CREATE UNIQUE INDEX "controlled_package_provenance_readiness_finding_unique" ON "controlled_package_snapshot_provenance"("snapshot_id", "final_readiness_finding_id") WHERE "final_readiness_finding_id" IS NOT NULL;

ALTER TABLE "export_template_versions" ADD CONSTRAINT "export_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "export_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_templates" ADD CONSTRAINT "export_templates_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "export_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_runs" ADD CONSTRAINT "controlled_package_runs_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_runs" ADD CONSTRAINT "controlled_package_runs_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_runs" ADD CONSTRAINT "controlled_package_runs_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_runs" ADD CONSTRAINT "controlled_package_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_runs" ADD CONSTRAINT "controlled_package_runs_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "export_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_runs" ADD CONSTRAINT "controlled_package_runs_retry_of_run_id_fkey" FOREIGN KEY ("retry_of_run_id") REFERENCES "controlled_review_package_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_runs" ADD CONSTRAINT "controlled_package_runs_supersedes_run_id_fkey" FOREIGN KEY ("supersedes_run_id") REFERENCES "controlled_review_package_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_run_scope_fkey" FOREIGN KEY ("run_id", "organisation_id", "tender_id", "tender_version_id") REFERENCES "controlled_review_package_runs"("id", "organisation_id", "tender_id", "tender_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_final_readiness_run_fkey" FOREIGN KEY ("final_readiness_run_id") REFERENCES "final_readiness_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_final_risk_run_fkey" FOREIGN KEY ("final_risk_run_id") REFERENCES "risk_analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_readiness_decision_fkey" FOREIGN KEY ("final_readiness_decision_id") REFERENCES "final_readiness_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_readiness_snapshot_fkey" FOREIGN KEY ("final_readiness_snapshot_id") REFERENCES "final_readiness_input_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_draft_version_fkey" FOREIGN KEY ("draft_version_id") REFERENCES "draft_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_draft_approval_fkey" FOREIGN KEY ("draft_approval_review_event_id") REFERENCES "draft_review_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_draft_creator_fkey" FOREIGN KEY ("draft_creator_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_extraction_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_early_risk_fkey" FOREIGN KEY ("early_risk_run_id") REFERENCES "risk_analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_pursuit_decision_fkey" FOREIGN KEY ("pursuit_decision_id") REFERENCES "early_pursuit_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_eligibility_run_fkey" FOREIGN KEY ("eligibility_assessment_run_id") REFERENCES "eligibility_assessment_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_evidence_snapshot_fkey" FOREIGN KEY ("eligibility_input_snapshot_id") REFERENCES "eligibility_input_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_checklist_run_fkey" FOREIGN KEY ("checklist_generation_run_id") REFERENCES "checklist_generation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_review_package_input_snapshots" ADD CONSTRAINT "controlled_package_snapshot_template_version_fkey" FOREIGN KEY ("template_version_id") REFERENCES "export_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_documents" ADD CONSTRAINT "controlled_package_snapshot_documents_scope_fkey" FOREIGN KEY ("snapshot_id", "organisation_id", "tender_id") REFERENCES "controlled_review_package_input_snapshots"("id", "organisation_id", "tender_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_documents" ADD CONSTRAINT "controlled_package_snapshot_documents_document_fkey" FOREIGN KEY ("tender_document_id") REFERENCES "tender_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_snapshot_provenance_scope_fkey" FOREIGN KEY ("snapshot_id", "organisation_id", "tender_id") REFERENCES "controlled_review_package_input_snapshots"("id", "organisation_id", "tender_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_provenance_document_fkey" FOREIGN KEY ("tender_document_id") REFERENCES "tender_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_provenance_extraction_fkey" FOREIGN KEY ("extraction_citation_id") REFERENCES "extraction_citations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_provenance_risk_fkey" FOREIGN KEY ("risk_finding_id") REFERENCES "risk_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_provenance_eligibility_fkey" FOREIGN KEY ("eligibility_assessment_id") REFERENCES "eligibility_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_provenance_evidence_fact_fkey" FOREIGN KEY ("evidence_fact_version_id") REFERENCES "company_evidence_fact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_provenance_evidence_citation_fkey" FOREIGN KEY ("evidence_citation_id") REFERENCES "company_evidence_citations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_provenance_checklist_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "checklist_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_provenance_draft_version_fkey" FOREIGN KEY ("draft_version_id") REFERENCES "draft_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_provenance_draft_claim_fkey" FOREIGN KEY ("draft_claim_id") REFERENCES "draft_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_provenance_draft_citation_fkey" FOREIGN KEY ("draft_citation_id") REFERENCES "draft_claim_citations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_package_snapshot_provenance" ADD CONSTRAINT "controlled_package_provenance_readiness_finding_fkey" FOREIGN KEY ("final_readiness_finding_id") REFERENCES "final_readiness_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_artifacts" ADD CONSTRAINT "package_artifacts_run_scope_fkey" FOREIGN KEY ("run_id", "organisation_id", "tender_id") REFERENCES "controlled_review_package_runs"("id", "organisation_id", "tender_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_manifests" ADD CONSTRAINT "package_manifests_run_scope_fkey" FOREIGN KEY ("run_id", "organisation_id", "tender_id") REFERENCES "controlled_review_package_runs"("id", "organisation_id", "tender_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_manifest_members" ADD CONSTRAINT "package_manifest_members_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "package_manifests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_reviews" ADD CONSTRAINT "package_reviews_run_scope_fkey" FOREIGN KEY ("run_id", "organisation_id", "tender_id") REFERENCES "controlled_review_package_runs"("id", "organisation_id", "tender_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_reviews" ADD CONSTRAINT "package_reviews_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_approvals" ADD CONSTRAINT "package_approvals_run_scope_fkey" FOREIGN KEY ("run_id", "organisation_id", "tender_id") REFERENCES "controlled_review_package_runs"("id", "organisation_id", "tender_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_approvals" ADD CONSTRAINT "package_approvals_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_approvals" ADD CONSTRAINT "package_approvals_supersedes_approval_id_fkey" FOREIGN KEY ("supersedes_approval_id") REFERENCES "package_approvals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_download_grants" ADD CONSTRAINT "package_download_grants_run_scope_fkey" FOREIGN KEY ("run_id", "organisation_id", "tender_id") REFERENCES "controlled_review_package_runs"("id", "organisation_id", "tender_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_download_grants" ADD CONSTRAINT "package_download_grants_artifact_scope_fkey" FOREIGN KEY ("artifact_id", "run_id", "organisation_id", "tender_id") REFERENCES "package_artifacts"("id", "run_id", "organisation_id", "tender_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_download_grants" ADD CONSTRAINT "package_download_grants_requester_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tender_versions" ADD CONSTRAINT "tender_versions_current_controlled_package_scope_fkey" FOREIGN KEY ("current_controlled_package_run_id", "id") REFERENCES "controlled_review_package_runs"("id", "tender_version_id") ON DELETE SET NULL ON UPDATE CASCADE;
