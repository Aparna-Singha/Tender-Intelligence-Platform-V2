const { signedUrl } = vi.hoisted(() => ({
  signedUrl: vi.fn().mockResolvedValue("https://signed.example/private-upload"),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: signedUrl }));

import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { createPrismaClient } from "@tender/database";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import { DocumentsService } from "../src/documents/documents.service.js";
import { RequirementEvidenceService } from "../src/eligibility/requirement-evidence.service.js";

const url = process.env.BIDVEDA_ATTACHMENT_TEST_DATABASE_URL;
const isolated = (() => {
  if (!url) return false;
  const parsed = new URL(url);
  return (
    parsed.hostname === "127.0.0.1" &&
    parsed.port === "5432" &&
    /^\/bidveda_attachment_rehearsal_[0-9_]+$/.test(parsed.pathname)
  );
})();

describe.skipIf(!isolated)(
  "requirement evidence API services in isolated PostgreSQL",
  () => {
    it("persists scoped upload and reusable selections without accepting facts", async () => {
      const sql = new Client({ connectionString: url });
      await sql.connect();
      const db = createPrismaClient(url!);
      const documentIds: string[] = [];
      try {
        const fixture = await sql.query<{
          organisation_id: string;
          tender_id: string;
          tender_version_id: string;
          extraction_run_id: string;
          requirement_id: string;
          user_id: string;
        }>(`
        SELECT e.organisation_id,e.tender_id,e.tender_version_id,
          e.id AS extraction_run_id,r.id AS requirement_id,m.user_id
        FROM structured_requirements r
        JOIN extraction_runs e ON e.id=r.extraction_run_id
        JOIN tender_versions v ON v.id=e.tender_version_id
        JOIN tenders t ON t.id=e.tender_id
        JOIN organisation_memberships m ON m.organisation_id=e.organisation_id
        WHERE e.status='COMPLETE' AND e.invalidated_at IS NULL
          AND v.active_extraction_run_id=e.id AND t.current_version_id=v.id
          AND r.finding_state='FOUND' AND r.review_state<>'REJECTED'
          AND (SELECT count(*) FROM structured_requirements peer
            WHERE peer.extraction_run_id=e.id)>1
        ORDER BY r.id LIMIT 1
      `);
        const row = fixture.rows[0];
        expect(row).toBeDefined();
        if (!row) return;
        const scope = {
          organisationId: row.organisation_id,
          tenderId: row.tender_id,
          tenderVersionId: row.tender_version_id,
          requirementId: row.requirement_id,
        };
        const secondRequirement = (
          await sql.query<{ id: string }>(
            "SELECT id FROM structured_requirements WHERE extraction_run_id=$1 AND id<>$2 LIMIT 1",
            [row.extraction_run_id, row.requirement_id],
          )
        ).rows[0]!.id;
        const createReusable = async (
          expired: boolean,
        ): Promise<{ documentId: string; versionId: string }> => {
          const documentId = randomUUID();
          const versionId = randomUUID();
          documentIds.push(documentId);
          await sql.query(
            `INSERT INTO documents (id,organisation_id,owner_user_id,category,
             display_name,status,expiry_date,created_at,updated_at)
           VALUES ($1,$2,$3,'OTHER',$4,'READY',$5,now(),now())`,
            [
              documentId,
              row.organisation_id,
              row.user_id,
              `Synthetic ${documentId}.pdf`,
              expired ? "2020-01-01" : null,
            ],
          );
          await sql.query(
            `INSERT INTO document_versions (id,document_id,version_number,
             original_filename,declared_mime_type,detected_mime_type,
             extension,size_bytes,sha256,quarantine_object_key,
             approved_object_key,uploaded_by_user_id)
           VALUES ($1,$2,1,'synthetic.pdf','application/pdf','application/pdf',
             '.pdf',10,$3,$4,$5,$6)`,
            [
              versionId,
              documentId,
              randomUUID().replaceAll("-", "").repeat(2),
              `quarantine/${row.organisation_id}/${versionId}`,
              `approved/${row.organisation_id}/${versionId}`,
              row.user_id,
            ],
          );
          await sql.query(
            "UPDATE documents SET current_version_id=$2 WHERE id=$1",
            [documentId, versionId],
          );
          return { documentId, versionId };
        };
        const first = await createReusable(false);
        const expired = await createReusable(true);
        const storage = {
          send: vi.fn((command: unknown) => {
            if (command instanceof HeadObjectCommand)
              return Promise.resolve({
                ContentLength: 10,
                ContentType: "application/pdf",
                Metadata: { sha256: "a".repeat(64) },
              });
            throw new Error("unexpected storage operation");
          }),
        };
        const jobs = { add: vi.fn().mockResolvedValue(undefined) };
        const documents = new DocumentsService(
          db,
          storage as never,
          jobs as never,
          {
            DOCUMENT_UPLOAD_TTL_SECONDS: 300,
            S3_BUCKET: "private-test",
          } as never,
        );
        const evidence = new RequirementEvidenceService(db, documents);

        const candidates = await evidence.candidates(scope, {
          limit: 50,
          offset: 0,
        });
        expect(JSON.stringify(candidates)).toContain(first.documentId);
        expect(JSON.stringify(candidates)).toContain(expired.documentId);
        expect(JSON.stringify(candidates)).not.toContain("download_url");
        const key = randomUUID();
        const selected = await evidence.attachExisting(
          scope,
          {
            document_id: first.documentId,
            document_version_id: first.versionId,
            idempotency_key: key,
          },
          row.user_id,
        );
        const concurrentKey = randomUUID();
        const concurrentDocument = await createReusable(false);
        const concurrentSelections = await Promise.all([
          evidence.attachExisting(
            scope,
            {
              document_id: concurrentDocument.documentId,
              document_version_id: concurrentDocument.versionId,
              idempotency_key: concurrentKey,
            },
            row.user_id,
          ),
          evidence.attachExisting(
            scope,
            {
              document_id: concurrentDocument.documentId,
              document_version_id: concurrentDocument.versionId,
              idempotency_key: concurrentKey,
            },
            row.user_id,
          ),
        ]);
        expect(concurrentSelections[0]).toEqual(concurrentSelections[1]);
        await expect(
          evidence.attachExisting(
            { ...scope, organisationId: randomUUID() },
            {
              document_id: first.documentId,
              document_version_id: first.versionId,
              idempotency_key: randomUUID(),
            },
            row.user_id,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          evidence.attachExisting(
            { ...scope, tenderId: randomUUID() },
            {
              document_id: first.documentId,
              document_version_id: first.versionId,
              idempotency_key: randomUUID(),
            },
            row.user_id,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          evidence.attachExisting(
            scope,
            {
              document_id: first.documentId,
              document_version_id: expired.versionId,
              idempotency_key: randomUUID(),
            },
            row.user_id,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          evidence.attachExisting(
            { ...scope, tenderVersionId: randomUUID() },
            {
              document_id: first.documentId,
              document_version_id: first.versionId,
              idempotency_key: randomUUID(),
            },
            row.user_id,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(
          await evidence.attachExisting(
            scope,
            {
              document_id: first.documentId,
              document_version_id: first.versionId,
              idempotency_key: key,
            },
            row.user_id,
          ),
        ).toEqual(selected);
        await expect(
          evidence.attachExisting(
            scope,
            {
              document_id: expired.documentId,
              document_version_id: expired.versionId,
              idempotency_key: key,
            },
            row.user_id,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        await evidence.attachExisting(
          scope,
          {
            document_id: expired.documentId,
            document_version_id: expired.versionId,
            idempotency_key: randomUUID(),
          },
          row.user_id,
        );
        await evidence.attachExisting(
          { ...scope, requirementId: secondRequirement },
          {
            document_id: first.documentId,
            document_version_id: first.versionId,
            idempotency_key: randomUUID(),
          },
          row.user_id,
        );

        const uploadKey = randomUUID();
        const upload = (await evidence.createUpload(
          scope,
          row.user_id,
          {
            checksum_sha256: "a".repeat(64),
            filename: "pending.pdf",
            mime_type: "application/pdf",
            size_bytes: 10,
            idempotency_key: uploadKey,
          },
          randomUUID(),
        )) as {
          attachment_id: string;
          document_id: string;
          upload_session_id: string;
          upload_status: string;
        };
        documentIds.push(upload.document_id);
        expect(upload.upload_status).toBe("PENDING");
        const pending = await evidence.get(scope, upload.attachment_id);
        expect(JSON.stringify(pending)).toContain("PENDING");
        expect(JSON.stringify(pending)).toContain('"context_only":true');
        const retry = (await evidence.createUpload(
          scope,
          row.user_id,
          {
            checksum_sha256: "a".repeat(64),
            filename: "pending.pdf",
            mime_type: "application/pdf",
            size_bytes: 10,
            idempotency_key: uploadKey,
          },
          randomUUID(),
        )) as { attachment_id: string };
        expect(retry.attachment_id).toBe(upload.attachment_id);
        await expect(
          evidence.createUpload(
            { ...scope, tenderVersionId: randomUUID() },
            row.user_id,
            {
              checksum_sha256: "a".repeat(64),
              filename: "pending.pdf",
              mime_type: "application/pdf",
              size_bytes: 10,
              idempotency_key: uploadKey,
            },
            randomUUID(),
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        await evidence.completeUpload(
          scope,
          upload.upload_session_id,
          row.user_id,
          { checksum_sha256: "a".repeat(64) },
          randomUUID(),
        );
        expect(
          JSON.stringify(await evidence.get(scope, upload.attachment_id)),
        ).toContain("COMPLETED");
        expect(jobs.add).toHaveBeenCalledOnce();

        const abandoned = (await evidence.createUpload(
          scope,
          row.user_id,
          {
            checksum_sha256: "b".repeat(64),
            filename: "abandoned.pdf",
            mime_type: "application/pdf",
            size_bytes: 10,
            idempotency_key: randomUUID(),
          },
          randomUUID(),
        )) as {
          attachment_id: string;
          document_id: string;
          upload_session_id: string;
        };
        documentIds.push(abandoned.document_id);
        await evidence.abandonUpload(
          scope,
          abandoned.upload_session_id,
          row.user_id,
          randomUUID(),
        );
        expect(
          JSON.stringify(await evidence.get(scope, abandoned.attachment_id)),
        ).toContain("CANCELLED");
        await expect(
          evidence.completeUpload(
            scope,
            abandoned.upload_session_id,
            row.user_id,
            { checksum_sha256: "b".repeat(64) },
            randomUUID(),
          ),
        ).rejects.toBeInstanceOf(NotFoundException);

        const attachmentId = (selected as { attachment_id: string })
          .attachment_id;
        await evidence.detach(scope, attachmentId, row.user_id);
        expect(
          JSON.stringify(await evidence.get(scope, attachmentId)),
        ).toContain("detached_at");
        expect(
          (
            await sql.query(
              "SELECT count(*)::int AS n FROM documents WHERE id=$1",
              [first.documentId],
            )
          ).rows[0].n,
        ).toBe(1);
      } finally {
        await db.$disconnect();
        if (documentIds.length) {
          await sql.query(
            "DELETE FROM requirement_evidence_attachments WHERE document_id = ANY($1::uuid[])",
            [documentIds],
          );
          await sql.query(
            "DELETE FROM upload_sessions WHERE document_version_id IN (SELECT id FROM document_versions WHERE document_id = ANY($1::uuid[]))",
            [documentIds],
          );
          await sql.query(
            "UPDATE documents SET current_version_id=NULL WHERE id = ANY($1::uuid[])",
            [documentIds],
          );
          await sql.query(
            "DELETE FROM document_versions WHERE document_id = ANY($1::uuid[])",
            [documentIds],
          );
          await sql.query("DELETE FROM documents WHERE id = ANY($1::uuid[])", [
            documentIds,
          ]);
          await sql.query(
            "DELETE FROM audit_events WHERE subject_id = ANY($1::uuid[])",
            [documentIds],
          );
        }
        await sql.end();
      }
    });
  },
);
