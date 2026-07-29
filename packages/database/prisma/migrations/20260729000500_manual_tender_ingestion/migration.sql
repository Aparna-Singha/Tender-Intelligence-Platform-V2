-- CreateEnum
CREATE TYPE "TenderSourceType" AS ENUM ('MANUAL_UPLOAD', 'CURATED_DATASET', 'ADMIN_IMPORT');

-- CreateEnum
CREATE TYPE "TenderLifecycleStatus" AS ENUM ('DRAFT', 'INGESTING', 'SOURCE_READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TenderWorkspaceStatus" AS ENUM ('DRAFT', 'INGESTING', 'SOURCE_READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TenderDocumentRole" AS ENUM ('PRIMARY', 'ANNEXURE', 'BOQ', 'SUPPORTING', 'TECHNICAL_SPECIFICATION', 'FORM', 'DECLARATION', 'CORRIGENDUM', 'AMENDMENT', 'CLARIFICATION');

-- CreateEnum
CREATE TYPE "TenderDocumentStatus" AS ENUM ('UPLOADING', 'UPLOADED', 'QUARANTINED', 'SCANNING', 'READY', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "TenderJobType" AS ENUM ('SOURCE_INGESTION');

-- CreateEnum
CREATE TYPE "TenderJobState" AS ENUM ('QUEUED', 'SCANNING', 'PARSING', 'STRUCTURING', 'ANALYSING', 'COMPLETE', 'FAILED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'TENDER_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'TENDER_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'TENDER_UPLOAD_REQUESTED';
ALTER TYPE "AuditEventType" ADD VALUE 'TENDER_UPLOAD_COMPLETED';
ALTER TYPE "AuditEventType" ADD VALUE 'TENDER_DUPLICATE_DETECTED';
ALTER TYPE "AuditEventType" ADD VALUE 'TENDER_VERSION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'TENDER_CORRIGENDUM_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'TENDER_DOCUMENT_DOWNLOADED';
ALTER TYPE "AuditEventType" ADD VALUE 'TENDER_JOB_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'TENDER_IMPORTED';

-- CreateTable
CREATE TABLE "tender_workspaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID,
    "status" "TenderWorkspaceStatus" NOT NULL DEFAULT 'DRAFT',
    "source_section_status" VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED',
    "processing_progress" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tender_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "current_version_id" UUID,
    "source_tender_number" VARCHAR(160),
    "title" VARCHAR(300) NOT NULL,
    "buyer" VARCHAR(240) NOT NULL,
    "category" VARCHAR(120),
    "procurement_type" VARCHAR(80),
    "publication_date" DATE,
    "submission_deadline" TIMESTAMPTZ(3) NOT NULL,
    "pre_bid_meeting_date" TIMESTAMPTZ(3),
    "opening_date" TIMESTAMPTZ(3),
    "official_source_url" VARCHAR(2048),
    "source_type" "TenderSourceType" NOT NULL,
    "description" VARCHAR(4000),
    "is_demonstration" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle_status" "TenderLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tender_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "previous_version_id" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "source_provenance" VARCHAR(1000) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "ingested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "role" "TenderDocumentRole" NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "display_filename" VARCHAR(255) NOT NULL,
    "declared_mime_type" VARCHAR(120) NOT NULL,
    "detected_mime_type" VARCHAR(120),
    "extension" VARCHAR(16) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "quarantine_object_key" VARCHAR(512) NOT NULL,
    "approved_object_key" VARCHAR(512),
    "status" "TenderDocumentStatus" NOT NULL DEFAULT 'UPLOADING',
    "source_url" VARCHAR(2048),
    "provenance" VARCHAR(1000) NOT NULL,
    "storage_metadata" JSONB NOT NULL DEFAULT '{}',
    "uploaded_by_user_id" UUID NOT NULL,
    "upload_session_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "upload_completed_at" TIMESTAMPTZ(3),
    "retention_until" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "adapter_type" "TenderSourceType" NOT NULL,
    "source_name" VARCHAR(160) NOT NULL,
    "source_url" VARCHAR(2048),
    "source_tender_id" VARCHAR(160),
    "provenance" VARCHAR(1000) NOT NULL,
    "import_method" VARCHAR(80) NOT NULL,
    "external_metadata" JSONB,
    "imported_by_user_id" UUID NOT NULL,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_corrigenda" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tender_id" UUID NOT NULL,
    "affected_version_id" UUID NOT NULL,
    "resulting_version_id" UUID NOT NULL,
    "identifier" VARCHAR(160) NOT NULL,
    "publication_date" DATE,
    "description" VARCHAR(2000) NOT NULL,
    "source_url" VARCHAR(2048),
    "ingested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_corrigenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "job_type" "TenderJobType" NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "state" "TenderJobState" NOT NULL DEFAULT 'QUEUED',
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "current_stage" VARCHAR(80) NOT NULL DEFAULT 'QUEUED',
    "public_message" VARCHAR(240) NOT NULL DEFAULT 'Source ingestion queued',
    "event_sequence" INTEGER NOT NULL DEFAULT 1,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "failure_category" VARCHAR(80),
    "internal_error_reference" VARCHAR(128),
    "cancellation_requested_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tender_workspaces" ADD CONSTRAINT "tender_workspaces_valid_progress"
CHECK ("processing_progress" BETWEEN 0 AND 100);

ALTER TABLE "tender_documents" ADD CONSTRAINT "tender_documents_positive_size"
CHECK ("size_bytes" > 0 AND "size_bytes" <= 26214400);

ALTER TABLE "tender_documents" ADD CONSTRAINT "tender_documents_valid_sha256"
CHECK ("sha256" ~ '^[a-f0-9]{64}$');

ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_valid_progress"
CHECK ("progress_percentage" BETWEEN 0 AND 100);

-- CreateIndex
CREATE UNIQUE INDEX "tender_workspaces_tender_id_key" ON "tender_workspaces"("tender_id");

-- CreateIndex
CREATE INDEX "tender_workspaces_organisation_id_status_updated_at_idx" ON "tender_workspaces"("organisation_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenders_current_version_id_key" ON "tenders"("current_version_id");

-- CreateIndex
CREATE INDEX "tenders_organisation_id_lifecycle_status_submission_deadlin_idx" ON "tenders"("organisation_id", "lifecycle_status", "submission_deadline");

-- CreateIndex
CREATE INDEX "tenders_organisation_id_source_tender_number_idx" ON "tenders"("organisation_id", "source_tender_number");

-- CreateIndex
CREATE UNIQUE INDEX "tender_versions_tender_id_version_number_key" ON "tender_versions"("tender_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "tender_versions_tender_id_source_fingerprint_key" ON "tender_versions"("tender_id", "source_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "tender_documents_quarantine_object_key_key" ON "tender_documents"("quarantine_object_key");

-- CreateIndex
CREATE UNIQUE INDEX "tender_documents_approved_object_key_key" ON "tender_documents"("approved_object_key");

-- CreateIndex
CREATE INDEX "tender_documents_organisation_id_sha256_idx" ON "tender_documents"("organisation_id", "sha256");

-- CreateIndex
CREATE INDEX "tender_documents_tender_version_id_status_idx" ON "tender_documents"("tender_version_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tender_documents_organisation_id_tender_version_id_role_sha_key" ON "tender_documents"("organisation_id", "tender_version_id", "role", "sha256");

-- CreateIndex
CREATE INDEX "tender_sources_organisation_id_adapter_type_source_tender_i_idx" ON "tender_sources"("organisation_id", "adapter_type", "source_tender_id");

-- CreateIndex
CREATE UNIQUE INDEX "tender_corrigenda_resulting_version_id_key" ON "tender_corrigenda"("resulting_version_id");

-- CreateIndex
CREATE INDEX "tender_corrigenda_tender_id_ingested_at_idx" ON "tender_corrigenda"("tender_id", "ingested_at");

-- CreateIndex
CREATE UNIQUE INDEX "tender_corrigenda_tender_id_identifier_key" ON "tender_corrigenda"("tender_id", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "processing_jobs_idempotency_key_key" ON "processing_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "processing_jobs_organisation_id_tender_id_state_idx" ON "processing_jobs"("organisation_id", "tender_id", "state");

-- CreateIndex
CREATE INDEX "processing_jobs_tender_version_id_created_at_idx" ON "processing_jobs"("tender_version_id", "created_at");

-- AddForeignKey
ALTER TABLE "tender_workspaces" ADD CONSTRAINT "tender_workspaces_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tender_workspaces" ADD CONSTRAINT "tender_workspaces_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_workspaces" ADD CONSTRAINT "tender_workspaces_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "tender_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_versions" ADD CONSTRAINT "tender_versions_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_versions" ADD CONSTRAINT "tender_versions_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_versions" ADD CONSTRAINT "tender_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_documents" ADD CONSTRAINT "tender_documents_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_documents" ADD CONSTRAINT "tender_documents_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_documents" ADD CONSTRAINT "tender_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_sources" ADD CONSTRAINT "tender_sources_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_sources" ADD CONSTRAINT "tender_sources_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_sources" ADD CONSTRAINT "tender_sources_imported_by_user_id_fkey" FOREIGN KEY ("imported_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_corrigenda" ADD CONSTRAINT "tender_corrigenda_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_corrigenda" ADD CONSTRAINT "tender_corrigenda_affected_version_id_fkey" FOREIGN KEY ("affected_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_corrigenda" ADD CONSTRAINT "tender_corrigenda_resulting_version_id_fkey" FOREIGN KEY ("resulting_version_id") REFERENCES "tender_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_tender_version_id_fkey" FOREIGN KEY ("tender_version_id") REFERENCES "tender_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
