CREATE TYPE "OrganisationType" AS ENUM ('MSME', 'CONSULTANT');
CREATE TYPE "Role" AS ENUM (
  'OWNER',
  'ADMIN',
  'TENDER_EXECUTIVE',
  'CONSULTANT',
  'REVIEWER',
  'PLATFORM_ADMIN'
);
CREATE TYPE "InvitationStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'REVOKED',
  'EXPIRED'
);
CREATE TYPE "AuditEventType" AS ENUM (
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'ORGANISATION_CREATED',
  'INVITATION_CREATED',
  'INVITATION_ACCEPTED',
  'ROLE_CHANGED',
  'SESSION_REVOKED',
  'PASSWORD_RESET_COMPLETED'
);

CREATE TABLE "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" VARCHAR(320) NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "display_name" VARCHAR(120) NOT NULL,
  "platform_role" "Role",
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_email_normalized" CHECK ("email" = lower(btrim("email"))),
  CONSTRAINT "users_platform_role_valid"
    CHECK ("platform_role" IS NULL OR "platform_role" = 'PLATFORM_ADMIN')
);

CREATE TABLE "organisations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(160) NOT NULL,
  "type" "OrganisationType" NOT NULL,
  "created_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organisations_name_not_blank" CHECK (length(btrim("name")) > 0)
);

CREATE TABLE "sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "active_organisation_id" UUID REFERENCES "organisations"("id") ON DELETE SET NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_hash" CHAR(64),
  "user_agent_hash" CHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "sessions_user_id_revoked_at_expires_at_idx"
  ON "sessions" ("user_id", "revoked_at", "expires_at");

CREATE TABLE "organisation_memberships" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "Role" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "organisation_memberships_organisation_id_user_id_key"
    UNIQUE ("organisation_id", "user_id"),
  CONSTRAINT "organisation_memberships_role_valid"
    CHECK ("role" <> 'PLATFORM_ADMIN')
);
CREATE INDEX "organisation_memberships_user_id_revoked_at_idx"
  ON "organisation_memberships" ("user_id", "revoked_at");

CREATE TABLE "invitations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "email" VARCHAR(320) NOT NULL,
  "role" "Role" NOT NULL,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "invited_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "accepted_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at" TIMESTAMPTZ(3),
  CONSTRAINT "invitations_email_normalized" CHECK ("email" = lower(btrim("email"))),
  CONSTRAINT "invitations_role_valid" CHECK ("role" <> 'PLATFORM_ADMIN')
);
CREATE INDEX "invitations_organisation_id_status_idx"
  ON "invitations" ("organisation_id", "status");
CREATE INDEX "invitations_email_status_idx" ON "invitations" ("email", "status");
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_fkey"
  FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;

CREATE TABLE "password_reset_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "password_reset_tokens_user_id_consumed_at_expires_at_idx"
  ON "password_reset_tokens" ("user_id", "consumed_at", "expires_at");

CREATE TABLE "audit_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type" "AuditEventType" NOT NULL,
  "actor_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "organisation_id" UUID REFERENCES "organisations"("id") ON DELETE SET NULL,
  "subject_type" VARCHAR(80),
  "subject_id" UUID,
  "outcome" VARCHAR(32) NOT NULL,
  "request_id" VARCHAR(128),
  "ip_hash" CHAR(64),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "audit_events_organisation_id_created_at_idx"
  ON "audit_events" ("organisation_id", "created_at");
CREATE INDEX "audit_events_actor_user_id_created_at_idx"
  ON "audit_events" ("actor_user_id", "created_at");
CREATE INDEX "audit_events_event_type_created_at_idx"
  ON "audit_events" ("event_type", "created_at");

CREATE TABLE "onboarding_progress" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "completed_steps" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "onboarding_progress_organisation_id_user_id_key"
    UNIQUE ("organisation_id", "user_id")
);

CREATE TABLE "company_profiles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL UNIQUE
    REFERENCES "organisations"("id") ON DELETE CASCADE,
  "profile_data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
