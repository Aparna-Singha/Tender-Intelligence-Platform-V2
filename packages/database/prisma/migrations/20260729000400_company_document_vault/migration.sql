-- Phase 3 reusable company document vault.
-- Recovery: stop document workers, delete the new tables in reverse dependency
-- order, remove the added enum values/types, and restore the preceding application.
-- Objects under quarantine/ and approved/ must be reconciled separately by key.

ALTER TYPE "AuditEventType" ADD VALUE 'DOCUMENT_UPLOAD_REQUESTED';
ALTER TYPE "AuditEventType" ADD VALUE 'DOCUMENT_UPLOAD_COMPLETED';
ALTER TYPE "AuditEventType" ADD VALUE 'DOCUMENT_DOWNLOADED';
ALTER TYPE "AuditEventType" ADD VALUE 'DOCUMENT_DELETED';
ALTER TYPE "AuditEventType" ADD VALUE 'DOCUMENT_VERSION_CREATED';

CREATE TYPE "DocumentCategory" AS ENUM (
  'UDYAM', 'GST', 'PAN', 'CIN', 'AUDITED_FINANCIAL_STATEMENT',
  'TURNOVER_CERTIFICATE', 'PURCHASE_ORDER', 'COMPLETION_CERTIFICATE',
  'EXPERIENCE_CERTIFICATE', 'OEM_AUTHORISATION', 'ISO_CERTIFICATE', 'LICENCE',
  'PRODUCT_DATASHEET', 'DECLARATION', 'BANK_DOCUMENT', 'OTHER'
);
CREATE TYPE "DocumentStatus" AS ENUM (
  'UPLOADING', 'UPLOADED', 'SCANNING', 'QUARANTINED', 'PROCESSING',
  'READY', 'REJECTED', 'FAILED', 'EXPIRED'
);
CREATE TYPE "DocumentVerificationStatus" AS ENUM (
  'UNVERIFIED', 'VERIFIED', 'REJECTED', 'HUMAN_REVIEW_REQUIRED'
);
CREATE TYPE "UploadSessionStatus" AS ENUM (
  'PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED'
);
CREATE TABLE "documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "owner_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "category" "DocumentCategory" NOT NULL,
  "display_name" VARCHAR(255) NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADING',
  "verification_status" "DocumentVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "expiry_date" DATE,
  "current_version_id" UUID UNIQUE,
  "retention_until" TIMESTAMPTZ(3),
  "deletion_requested_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE "document_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "version_number" INTEGER NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "declared_mime_type" VARCHAR(120) NOT NULL,
  "detected_mime_type" VARCHAR(120),
  "extension" VARCHAR(16) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "quarantine_object_key" VARCHAR(512) NOT NULL UNIQUE,
  "approved_object_key" VARCHAR(512) UNIQUE,
  "uploaded_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_versions_document_id_version_number_key"
    UNIQUE ("document_id", "version_number"),
  CONSTRAINT "document_versions_positive_size" CHECK ("size_bytes" > 0),
  CONSTRAINT "document_versions_valid_sha256"
    CHECK ("sha256" ~ '^[a-f0-9]{64}$')
);

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_current_version_id_fkey"
  FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id")
  ON DELETE SET NULL;

CREATE TABLE "upload_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "document_version_id" UUID NOT NULL UNIQUE
    REFERENCES "document_versions"("id") ON DELETE CASCADE,
  "status" "UploadSessionStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "document_extractions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_version_id" UUID NOT NULL UNIQUE
    REFERENCES "document_versions"("id") ON DELETE CASCADE,
  "status" "DocumentStatus" NOT NULL,
  "metadata" JSONB,
  "failure_code" VARCHAR(80),
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "document_verifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "status" "DocumentVerificationStatus" NOT NULL,
  "rationale" VARCHAR(1000),
  "verified_by_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "document_access_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "action" VARCHAR(32) NOT NULL,
  "outcome" VARCHAR(32) NOT NULL,
  "request_id" VARCHAR(128),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "documents_organisation_id_category_status_idx"
  ON "documents"("organisation_id", "category", "status");
CREATE INDEX "documents_organisation_id_expiry_date_idx"
  ON "documents"("organisation_id", "expiry_date");
CREATE INDEX "document_versions_sha256_idx" ON "document_versions"("sha256");
CREATE INDEX "upload_sessions_organisation_id_status_expires_at_idx"
  ON "upload_sessions"("organisation_id", "status", "expires_at");
CREATE INDEX "document_verifications_document_id_created_at_idx"
  ON "document_verifications"("document_id", "created_at");
CREATE INDEX "document_access_events_organisation_id_document_id_created_at_idx"
  ON "document_access_events"("organisation_id", "document_id", "created_at");
