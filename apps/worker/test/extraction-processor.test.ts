import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ExtractionProcessor } from "../src/extraction-processor.js";

describe("extraction worker progression", () => {
  it("returns a progression trigger when the current extraction completes", async () => {
    const content = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const database = {
      extractionRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "extract-a",
          organisationId: "organisation-a",
          requestedByUserId: "user-a",
          status: "QUEUED",
          tenderId: "tender-a",
          tenderVersion: {
            documents: [
              {
                approvedObjectKey: "approved/object-key",
                displayFilename: "source.pdf",
                extension: ".pdf",
                id: "document-a",
                sha256,
                sizeBytes: BigInt(content.byteLength),
                status: "READY",
              },
            ],
            tender: { organisationId: "organisation-a" },
            tenderId: "tender-a",
          },
          tenderVersionId: "version-a",
        }),
        findUnique: vi.fn().mockResolvedValue({
          cancellationRequestedAt: null,
          status: "QUEUED",
        }),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const storage = {
      send: vi.fn().mockResolvedValue({
        Body: { transformToByteArray: vi.fn().mockResolvedValue(content) },
        ContentLength: content.byteLength,
      }),
    };
    const processor = new ExtractionProcessor(
      database as never,
      storage as never,
      "private-test",
      {
        parse: vi.fn().mockResolvedValue({
          format: "PDF",
          issues: [],
          parserName: "test-parser",
          parserVersion: "1.0.0",
          units: [],
        }),
      } as never,
    );
    vi.spyOn(
      processor as unknown as {
        persist: (...args: readonly unknown[]) => Promise<void>;
      },
      "persist",
    ).mockResolvedValue(undefined);

    await expect(
      processor.process({
        extractionRunId: "extract-a",
        organisationId: "organisation-a",
        requestId: "request-a",
      }),
    ).resolves.toEqual({
      organisationId: "organisation-a",
      requestId: "request-a",
      tenderId: "tender-a",
      triggerId: "extract-a",
      triggerType: "EXTRACTION_COMPLETE",
      userId: "user-a",
    });
  });

  it.each([
    ["P2028", "persist_transaction", true],
    ["P2003", "stage_update", true],
    ["P9999", "persist_transaction", false],
  ] as const)(
    "emits only an allowlisted Prisma code and fixed operation for %s",
    async (code, operation, expectedDiagnostic) => {
      const content = new TextEncoder().encode("synthetic source");
      const database = {
        extractionRun: {
          findFirst: vi.fn().mockResolvedValue({
            id: "synthetic-run",
            organisationId: "synthetic-org",
            requestedByUserId: "synthetic-user",
            status: "QUEUED",
            tenderId: "synthetic-tender",
            tenderVersionId: "synthetic-version",
            tenderVersion: {
              documents: [
                {
                  approvedObjectKey: "synthetic-key",
                  displayFilename: "synthetic.pdf",
                  extension: ".pdf",
                  id: "synthetic-document",
                  sha256: createHash("sha256").update(content).digest("hex"),
                  sizeBytes: BigInt(content.byteLength),
                  status: "READY",
                },
              ],
              tender: { organisationId: "synthetic-org" },
              tenderId: "synthetic-tender",
            },
          }),
          findUnique: vi.fn().mockResolvedValue({
            cancellationRequestedAt: null,
            status: "QUEUED",
          }),
          update: vi.fn().mockResolvedValue(undefined),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const storage = {
        send: vi.fn().mockResolvedValue({
          Body: { transformToByteArray: vi.fn().mockResolvedValue(content) },
          ContentLength: content.byteLength,
        }),
      };
      const diagnostic = vi.fn();
      const processor = new ExtractionProcessor(
        database as never,
        storage as never,
        "synthetic-bucket",
        {
          parse: vi.fn().mockResolvedValue({
            format: "PDF",
            issues: [],
            parserName: "test",
            parserVersion: "1",
            units: [],
          }),
        } as never,
        diagnostic,
      );
      const failure = Object.assign(new Error("sensitive message"), {
        code,
        meta: { query: "sensitive query" },
      });
      failure.name = "PrismaClientKnownRequestError";
      if (operation === "persist_transaction") {
        vi.spyOn(
          processor as unknown as {
            persist: (...args: readonly unknown[]) => Promise<void>;
          },
          "persist",
        ).mockRejectedValue(failure);
      } else {
        database.extractionRun.update.mockRejectedValueOnce(failure);
      }
      await expect(
        processor.process({
          extractionRunId: "synthetic-run",
          organisationId: "synthetic-org",
          requestId: "synthetic-request",
        }),
      ).rejects.toBe(failure);
      if (expectedDiagnostic) {
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith({ code, operation });
        expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(
          /sensitive|synthetic-/,
        );
      } else {
        expect(diagnostic).not.toHaveBeenCalled();
      }
    },
  );
});
