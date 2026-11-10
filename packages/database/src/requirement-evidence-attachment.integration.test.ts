import { randomUUID } from "node:crypto";
import { Client, type QueryResult } from "pg";
import { describe, expect, it } from "vitest";

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
  "requirement attachments in isolated PostgreSQL",
  () => {
    it("persists exact versions, rejects invalid links, and retains detached history", async () => {
      const client = new Client({ connectionString: url });
      await client.connect();
      await client.query("BEGIN");
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
        JOIN extraction_runs e ON e.id = r.extraction_run_id
        JOIN organisation_memberships m ON m.organisation_id = e.organisation_id
        WHERE (SELECT count(*) FROM structured_requirements peer
          WHERE peer.extraction_run_id=e.id) > 1
        ORDER BY r.id LIMIT 1
      `);
        const scope = fixture.rows[0];
        expect(scope).toBeDefined();
        if (!scope) return;

        const documentId = randomUUID();
        const versionId = randomUUID();
        await client.query(
          `INSERT INTO documents (id, organisation_id, tender_scope_id, owner_user_id,
          category, display_name, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'OTHER','Synthetic evidence','UPLOADING',now(),now())`,
          [documentId, scope.organisation_id, scope.tender_id, scope.user_id],
        );
        await client.query(
          `INSERT INTO document_versions (id, document_id, version_number,
          original_filename, declared_mime_type, extension, size_bytes, sha256,
          quarantine_object_key, uploaded_by_user_id)
         VALUES ($1,$2,1,'synthetic.pdf','application/pdf','.pdf',10,$3,$4,$5)`,
          [
            versionId,
            documentId,
            "a".repeat(64),
            `quarantine/test/${versionId}`,
            scope.user_id,
          ],
        );

        const insert = async (
          overrides: Record<string, string> = {},
        ): Promise<QueryResult<{ id: string }>> => {
          const data = {
            id: randomUUID(),
            organisationId: scope.organisation_id,
            tenderId: scope.tender_id,
            tenderVersionId: scope.tender_version_id,
            extractionRunId: scope.extraction_run_id,
            requirementId: scope.requirement_id,
            documentId,
            versionId,
            userId: scope.user_id,
            key: randomUUID(),
            ...overrides,
          };
          return client.query(
            `INSERT INTO requirement_evidence_attachments
           (id, organisation_id, tender_id, tender_version_id, extraction_run_id,
            structured_requirement_id, document_id, document_version_id,
            attached_by_user_id, idempotency_key, request_fingerprint)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [
              data.id,
              data.organisationId,
              data.tenderId,
              data.tenderVersionId,
              data.extractionRunId,
              data.requirementId,
              data.documentId,
              data.versionId,
              data.userId,
              data.key,
              "b".repeat(64),
            ],
          );
        };
        const idempotencyKey = randomUUID();
        const first = (await insert({ key: idempotencyKey })).rows[0]!.id;
        expect(
          (
            await client.query(
              "SELECT count(*)::int AS n FROM requirement_evidence_attachments WHERE id=$1",
              [first],
            )
          ).rows[0].n,
        ).toBe(1);

        const sessionId = randomUUID();
        await client.query(
          `INSERT INTO upload_sessions (id, organisation_id, document_version_id, status, expires_at)
         VALUES ($1,$2,$3,'PENDING',now() + interval '1 hour')`,
          [sessionId, scope.organisation_id, versionId],
        );

        const reject = async (
          action: () => Promise<unknown>,
          code: string,
        ): Promise<void> => {
          await client.query("SAVEPOINT expected_rejection");
          try {
            await action();
            throw new Error("expected database rejection");
          } catch (error) {
            expect((error as { code?: string }).code).toBe(code);
          } finally {
            await client.query("ROLLBACK TO SAVEPOINT expected_rejection");
          }
        };
        await reject(() => insert(), "23505"); // Active duplicate.
        await client.query(
          "UPDATE requirement_evidence_attachments SET detached_at=now(), detached_by_user_id=$2 WHERE id=$1",
          [first, scope.user_id],
        );
        await reject(() => insert({ key: idempotencyKey }), "23505");
        await reject(() => insert({ organisationId: randomUUID() }), "23503");
        await reject(() => insert({ tenderId: randomUUID() }), "23514");
        await reject(() => insert({ versionId: randomUUID() }), "23503");
        await reject(
          () =>
            client.query("DELETE FROM document_versions WHERE id=$1", [
              versionId,
            ]),
          "23503",
        );

        await client.query(
          "UPDATE upload_sessions SET status='CANCELLED' WHERE id=$1 AND status='PENDING'",
          [sessionId],
        );
        await client.query(
          "UPDATE documents SET status='FAILED' WHERE id=$1 AND status='UPLOADING'",
          [documentId],
        );
        expect(
          (
            await client.query(
              "SELECT status FROM upload_sessions WHERE id=$1",
              [sessionId],
            )
          ).rows[0].status,
        ).toBe("CANCELLED");
        expect(
          (
            await client.query("SELECT status FROM documents WHERE id=$1", [
              documentId,
            ])
          ).rows[0].status,
        ).toBe("FAILED");
        await reject(
          () =>
            client.query("DELETE FROM document_versions WHERE id=$1", [
              versionId,
            ]),
          "23503",
        );

        const second = (await insert()).rows[0]!.id;
        expect(second).not.toBe(first);
        expect(
          (
            await client.query(
              "SELECT count(*)::int AS n FROM requirement_evidence_attachments WHERE document_version_id=$1",
              [versionId],
            )
          ).rows[0].n,
        ).toBe(2);
        const anotherRequirement = (
          await client.query<{ id: string }>(
            "SELECT id FROM structured_requirements WHERE extraction_run_id=$1 AND id<>$2 LIMIT 1",
            [scope.extraction_run_id, scope.requirement_id],
          )
        ).rows[0]?.id;
        expect(anotherRequirement).toBeDefined();
        await insert({ requirementId: anotherRequirement! });
        const secondVersionId = randomUUID();
        await client.query(
          `INSERT INTO document_versions (id, document_id, version_number,
          original_filename, declared_mime_type, extension, size_bytes, sha256,
          quarantine_object_key, uploaded_by_user_id)
         VALUES ($1,$2,2,'synthetic-2.pdf','application/pdf','.pdf',10,$3,$4,$5)`,
          [
            secondVersionId,
            documentId,
            "c".repeat(64),
            `quarantine/test/${secondVersionId}`,
            scope.user_id,
          ],
        );
        await insert({ versionId: secondVersionId });
        expect(
          (
            await client.query(
              "SELECT count(*)::int AS n FROM requirement_evidence_attachments WHERE document_id=$1 AND detached_at IS NULL",
              [documentId],
            )
          ).rows[0].n,
        ).toBe(3);
        await reject(
          () =>
            client.query("DELETE FROM document_versions WHERE id=$1", [
              versionId,
            ]),
          "23503",
        );
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    });
  },
);
