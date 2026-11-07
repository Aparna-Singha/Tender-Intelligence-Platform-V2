import { randomUUID } from "node:crypto";
import { Client, type QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@tender/database";
import { DocumentsService } from "../src/documents/documents.service.js";

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
  "referenced upload abandonment in isolated PostgreSQL",
  () => {
    it("retains the version, session and private object for historical evidence", async () => {
      const client = new Client({ connectionString: url });
      await client.connect();
      const prisma = createPrismaClient(url!);
      const documentId = randomUUID();
      const versionId = randomUUID();
      const sessionId = randomUUID();
      try {
        const fixture = await client.query<{
          organisation_id: string;
          tender_id: string;
          tender_version_id: string;
          extraction_run_id: string;
          requirement_id: string;
          user_id: string;
        }>(`
        SELECT e.organisation_id, e.tender_id, e.tender_version_id,
          e.id AS extraction_run_id, r.id AS requirement_id, m.user_id
        FROM structured_requirements r
        JOIN extraction_runs e ON e.id=r.extraction_run_id
        JOIN organisation_memberships m ON m.organisation_id=e.organisation_id
        ORDER BY r.id LIMIT 1
      `);
        const scope = fixture.rows[0];
        expect(scope).toBeDefined();
        if (!scope) return;
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO documents (id,organisation_id,tender_scope_id,owner_user_id,
          category,display_name,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,'OTHER','Synthetic pending evidence','UPLOADING',now(),now())`,
          [documentId, scope.organisation_id, scope.tender_id, scope.user_id],
        );
        await client.query(
          `INSERT INTO document_versions (id,document_id,version_number,original_filename,
          declared_mime_type,extension,size_bytes,sha256,quarantine_object_key,uploaded_by_user_id)
         VALUES ($1,$2,1,'synthetic.pdf','application/pdf','.pdf',10,$3,$4,$5)`,
          [
            versionId,
            documentId,
            "a".repeat(64),
            `quarantine/${scope.organisation_id}/${versionId}`,
            scope.user_id,
          ],
        );
        await client.query(
          `INSERT INTO upload_sessions (id,organisation_id,document_version_id,status,expires_at)
         VALUES ($1,$2,$3,'PENDING',now() + interval '1 hour')`,
          [sessionId, scope.organisation_id, versionId],
        );
        await client.query(
          `INSERT INTO requirement_evidence_attachments
          (organisation_id,tender_id,tender_version_id,extraction_run_id,
           structured_requirement_id,document_id,document_version_id,
           attached_by_user_id,idempotency_key,request_fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            scope.organisation_id,
            scope.tender_id,
            scope.tender_version_id,
            scope.extraction_run_id,
            scope.requirement_id,
            documentId,
            versionId,
            scope.user_id,
            randomUUID(),
            "b".repeat(64),
          ],
        );
        await client.query("COMMIT");

        const storage = { send: vi.fn() };
        const jobs = { add: vi.fn() };
        const service = new DocumentsService(
          prisma,
          storage as never,
          jobs as never,
          {} as never,
        );
        await expect(
          service.abandonUploadSession(
            scope.organisation_id,
            sessionId,
            scope.user_id,
            randomUUID(),
            {
              organisationId: scope.organisation_id,
              tenderId: scope.tender_id,
              tenderVersionId: scope.tender_version_id,
              requirementId: scope.requirement_id,
            },
          ),
        ).resolves.toEqual({ removed: true });
        const state = await client.query(
          `SELECT s.status AS session_status,d.status AS document_status,
          (v.id IS NOT NULL) AS version_retained
         FROM upload_sessions s JOIN document_versions v ON v.id=s.document_version_id
         JOIN documents d ON d.id=v.document_id WHERE s.id=$1`,
          [sessionId],
        );
        expect(state.rows[0]).toMatchObject({
          session_status: "CANCELLED",
          document_status: "FAILED",
          version_retained: true,
        });
        expect(storage.send).not.toHaveBeenCalled();
        expect(jobs.add).not.toHaveBeenCalled();

        await client.query(
          "UPDATE requirement_evidence_attachments SET detached_at=now(), detached_by_user_id=$2 WHERE document_id=$1",
          [documentId, scope.user_id],
        );
        const contender = new Client({ connectionString: url });
        await contender.connect();
        try {
          const attach = (connection: Client): Promise<QueryResult> =>
            connection.query(
              `INSERT INTO requirement_evidence_attachments
            (organisation_id,tender_id,tender_version_id,extraction_run_id,
             structured_requirement_id,document_id,document_version_id,
             attached_by_user_id,idempotency_key,request_fingerprint)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [
                scope.organisation_id,
                scope.tender_id,
                scope.tender_version_id,
                scope.extraction_run_id,
                scope.requirement_id,
                documentId,
                versionId,
                scope.user_id,
                randomUUID(),
                "c".repeat(64),
              ],
            );
          const outcomes = await Promise.allSettled([
            attach(client),
            attach(contender),
          ]);
          expect(
            outcomes.filter((outcome) => outcome.status === "fulfilled"),
          ).toHaveLength(1);
          expect(
            outcomes.filter((outcome) => outcome.status === "rejected"),
          ).toHaveLength(1);
          const rejected = outcomes.find(
            (outcome) => outcome.status === "rejected",
          );
          if (rejected?.status !== "rejected")
            throw new Error("expected rejection");
          expect(rejected.reason.code).toBe("23505");
        } finally {
          await contender.end();
        }
      } finally {
        await prisma.$disconnect();
        await client.query(
          "DELETE FROM requirement_evidence_attachments WHERE document_id=$1",
          [documentId],
        );
        await client.query("DELETE FROM upload_sessions WHERE id=$1", [
          sessionId,
        ]);
        await client.query("DELETE FROM document_versions WHERE id=$1", [
          versionId,
        ]);
        await client.query("DELETE FROM documents WHERE id=$1", [documentId]);
        await client.query("DELETE FROM audit_events WHERE subject_id=$1", [
          documentId,
        ]);
        await client.end();
      }
    });
  },
);
