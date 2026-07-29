CREATE TYPE "VerificationStatus" AS ENUM (
  'SELF_DECLARED',
  'DOCUMENT_VERIFIED',
  'EXPIRED',
  'CONFLICTING',
  'HUMAN_REVIEW_REQUIRED'
);
CREATE TYPE "ProfileValueSource" AS ENUM ('USER_INPUT', 'ADMIN_INPUT', 'DOCUMENT');
CREATE TYPE "ProfileValueType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'TEXT_LIST');
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

ALTER TYPE "AuditEventType" ADD VALUE 'ONBOARDING_STEP_SAVED';
ALTER TYPE "AuditEventType" ADD VALUE 'ONBOARDING_COMPLETED';
ALTER TYPE "AuditEventType" ADD VALUE 'COMPANY_PROFILE_UPDATED';

ALTER TABLE "onboarding_progress"
  DROP COLUMN "completed_steps",
  ADD COLUMN "current_step" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "completed_steps" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "status" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "completed_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "onboarding_progress_current_step_valid"
    CHECK ("current_step" BETWEEN 1 AND 8);

ALTER TABLE "company_profiles" DROP COLUMN "profile_data";

CREATE TABLE "company_profile_values" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "field_key" VARCHAR(80) NOT NULL,
  "value_type" "ProfileValueType" NOT NULL,
  "text_value" TEXT,
  "number_value" DECIMAL(18, 2),
  "boolean_value" BOOLEAN,
  "date_value" DATE,
  "text_list_value" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source" "ProfileValueSource" NOT NULL DEFAULT 'USER_INPUT',
  "verification_status" "VerificationStatus" NOT NULL DEFAULT 'SELF_DECLARED',
  "evidence_document_id" UUID,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "company_profile_values_organisation_id_field_key_key"
    UNIQUE ("organisation_id", "field_key"),
  CONSTRAINT "company_profile_values_exactly_one_value"
    CHECK (
      num_nonnulls("text_value", "number_value", "boolean_value", "date_value") +
      CASE WHEN cardinality("text_list_value") > 0 THEN 1 ELSE 0 END = 1
    )
);
CREATE INDEX "company_profile_values_organisation_id_verification_status_idx"
  ON "company_profile_values" ("organisation_id", "verification_status");

CREATE TABLE "company_turnover" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "financial_year" VARCHAR(7) NOT NULL,
  "amount_inr" DECIMAL(18, 2) NOT NULL,
  "source" "ProfileValueSource" NOT NULL DEFAULT 'USER_INPUT',
  "verification_status" "VerificationStatus" NOT NULL DEFAULT 'SELF_DECLARED',
  "evidence_document_id" UUID,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  UNIQUE ("organisation_id", "financial_year"),
  CHECK ("financial_year" ~ '^[0-9]{4}-[0-9]{2}$'),
  CHECK ("amount_inr" >= 0)
);

CREATE TABLE "document_readiness" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "document_type" VARCHAR(80) NOT NULL,
  "readiness_status" VARCHAR(24) NOT NULL,
  "expected_expiry" DATE,
  "source" "ProfileValueSource" NOT NULL DEFAULT 'USER_INPUT',
  "verification_status" "VerificationStatus" NOT NULL DEFAULT 'SELF_DECLARED',
  "evidence_document_id" UUID,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  UNIQUE ("organisation_id", "document_type"),
  CHECK ("readiness_status" IN ('AVAILABLE', 'MISSING', 'NOT_APPLICABLE'))
);

-- Forward recovery: restore the dropped legacy JSON columns and backfill from
-- company_profile_values before rolling application code back. PostgreSQL enum
-- values are intentionally retained because removing enum members is unsafe.
