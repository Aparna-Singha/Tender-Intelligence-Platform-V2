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
      userId: "user-a",
    });
  });
});
