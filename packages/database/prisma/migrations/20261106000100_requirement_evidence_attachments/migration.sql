-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "tender_scope_id" UUID;

-- CreateTable
CREATE TABLE "requirement_evidence_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "tender_version_id" UUID NOT NULL,
    "extraction_run_id" UUID NOT NULL,
    "structured_requirement_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "attached_by_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detached_at" TIMESTAMPTZ(3),
    "detached_by_user_id" UUID,

    CONSTRAINT "requirement_evidence_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "requirement_evidence_attachments_organisation_id_tender_id__idx" ON "requirement_evidence_attachments"("organisation_id", "tender_id", "structured_requirement_id", "detached_at");

-- CreateIndex
CREATE INDEX "requirement_evidence_attachments_document_id_document_versi_idx" ON "requirement_evidence_attachments"("document_id", "document_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "requirement_evidence_attachments_organisation_id_tender_id__key" ON "requirement_evidence_attachments"("organisation_id", "tender_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "documents_organisation_id_tender_scope_id_status_idx" ON "documents"("organisation_id", "tender_scope_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "documents_id_organisation_id_key" ON "documents"("id", "organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_id_document_id_key" ON "document_versions"("id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenders_id_organisation_id_key" ON "tenders"("id", "organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "tender_versions_id_tender_id_key" ON "tender_versions"("id", "tender_id");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_runs_id_tender_version_id_key" ON "extraction_runs"("id", "tender_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "structured_requirements_id_extraction_run_id_key" ON "structured_requirements"("id", "extraction_run_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tender_scope_id_organisation_id_fkey" FOREIGN KEY ("tender_scope_id", "organisation_id") REFERENCES "tenders"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_attachments" ADD CONSTRAINT "requirement_evidence_attachments_tender_id_organisation_id_fkey" FOREIGN KEY ("tender_id", "organisation_id") REFERENCES "tenders"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_attachments" ADD CONSTRAINT "requirement_evidence_attachments_tender_version_id_tender__fkey" FOREIGN KEY ("tender_version_id", "tender_id") REFERENCES "tender_versions"("id", "tender_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_attachments" ADD CONSTRAINT "requirement_evidence_attachments_extraction_run_id_tender__fkey" FOREIGN KEY ("extraction_run_id", "tender_version_id") REFERENCES "extraction_runs"("id", "tender_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_attachments" ADD CONSTRAINT "requirement_evidence_attachments_structured_requirement_id_fkey" FOREIGN KEY ("structured_requirement_id", "extraction_run_id") REFERENCES "structured_requirements"("id", "extraction_run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_attachments" ADD CONSTRAINT "requirement_evidence_attachments_document_id_organisation__fkey" FOREIGN KEY ("document_id", "organisation_id") REFERENCES "documents"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_attachments" ADD CONSTRAINT "requirement_evidence_attachments_document_version_id_docum_fkey" FOREIGN KEY ("document_version_id", "document_id") REFERENCES "document_versions"("id", "document_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_attachments" ADD CONSTRAINT "requirement_evidence_attachments_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_attachments" ADD CONSTRAINT "requirement_evidence_attachments_attached_by_user_id_fkey" FOREIGN KEY ("attached_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_attachments" ADD CONSTRAINT "requirement_evidence_attachments_detached_by_user_id_fkey" FOREIGN KEY ("detached_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One active link per exact requirement and document version; detached rows remain auditable.
CREATE UNIQUE INDEX "requirement_evidence_attachments_active_key"
  ON "requirement_evidence_attachments" ("structured_requirement_id", "document_version_id")
  WHERE "detached_at" IS NULL;

-- A reusable company document has no tender scope. A scoped document may only
-- support the tender that owns it, including after its scope is updated.
CREATE FUNCTION "check_requirement_attachment_document_scope"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE document_scope uuid;
BEGIN
  SELECT d.tender_scope_id INTO document_scope FROM "documents" d
    WHERE d.id = NEW.document_id FOR SHARE;
  IF document_scope IS NOT NULL AND document_scope <> NEW.tender_id THEN
    RAISE EXCEPTION 'attachment document belongs to another tender' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "requirement_attachment_document_scope_check"
  BEFORE INSERT OR UPDATE OF "document_id", "tender_id" ON "requirement_evidence_attachments"
  FOR EACH ROW EXECUTE FUNCTION "check_requirement_attachment_document_scope"();

CREATE FUNCTION "check_document_scope_existing_attachments"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tender_scope_id IS DISTINCT FROM OLD.tender_scope_id AND EXISTS (
    SELECT 1 FROM "requirement_evidence_attachments" a
    WHERE a.document_id = NEW.id
      AND NEW.tender_scope_id IS NOT NULL
      AND a.tender_id <> NEW.tender_scope_id
  ) THEN
    RAISE EXCEPTION 'document scope conflicts with historical attachments' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "document_scope_attachment_check"
  BEFORE UPDATE OF "tender_scope_id" ON "documents"
  FOR EACH ROW EXECUTE FUNCTION "check_document_scope_existing_attachments"();
