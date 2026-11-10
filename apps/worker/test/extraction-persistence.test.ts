import { describe, expect, it, vi } from "vitest";
import type { ParsedDocument } from "@tender/domain";
import { ExtractionProcessor } from "../src/extraction-processor.js";

interface SyntheticSource {
  document: {
    displayFilename: string;
    extension: string;
    id: string;
    sha256: string;
  };
  parsed: ParsedDocument;
}
interface Write {
  model: string;
  rows: readonly Record<string, unknown>[];
}
interface MockState {
  database: { $transaction: ReturnType<typeof vi.fn> };
  transaction: {
    extractionRun: {
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    extractionRunDocument: { createMany: ReturnType<typeof vi.fn> };
    tenderVersion: { update: ReturnType<typeof vi.fn> };
  };
  writes: Write[];
}

function fixture(blockCount: number): SyntheticSource[] {
  return ["primary", "boq"].map((name, documentIndex) => ({
    document: {
      displayFilename: `${name}.pdf`,
      extension: ".pdf",
      id: `document-${name}`,
      sha256: "a".repeat(64),
    },
    parsed: {
      format: "PDF",
      issues: [],
      parserName: "synthetic-parser",
      parserVersion: "1",
      units: [
        {
          blocks: Array.from({ length: blockCount }, (_, index) => {
            const text =
              index === 0 && documentIndex === 0
                ? "Buyer: Synthetic purchaser. Bidder shall submit GST certificate."
                : `Bidder shall submit synthetic certificate ${index}.`;
            return {
              confidence: "HIGH",
              readingOrder: index,
              sourceEndOffset: text.length,
              sourceStartOffset: 0,
              ...(index === 0 && documentIndex === 1
                ? {
                    table: {
                      columnCount: 2,
                      rowCount: 1,
                      cells: [
                        {
                          columnIndex: 0,
                          displayedValue: "Line item",
                          rowIndex: 0,
                        },
                        { columnIndex: 1, displayedValue: "18", rowIndex: 0 },
                      ],
                    },
                  }
                : {}),
              text,
              type: "PARAGRAPH",
              warnings: [],
            };
          }),
          characterCount: blockCount * 45,
          confidence: "HIGH",
          ocrStatus: "NOT_REQUIRED",
          unitIndex: 1,
          unitType: "PAGE",
        },
      ],
    },
  }));
}

function mockDatabase(failAt?: string): MockState {
  const writes: Write[] = [];
  const createMany = (model: string): ReturnType<typeof vi.fn> =>
    vi.fn(
      ({
        data,
      }: {
        data: readonly Record<string, unknown>[];
      }): Promise<{ count: number }> => {
        if (model === failAt) throw new Error("synthetic database failure");
        writes.push({ model, rows: data });
        return Promise.resolve({ count: data.length });
      },
    );
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    extractionRunDocument: { createMany: createMany("documents") },
    extractedUnit: { createMany: createMany("units") },
    extractedBlock: { createMany: createMany("blocks") },
    extractedTable: { createMany: createMany("tables") },
    extractedTableCell: { createMany: createMany("cells") },
    classifiedSection: { createMany: createMany("sections") },
    extractedTenderField: { createMany: createMany("fields") },
    structuredRequirement: { createMany: createMany("requirements") },
    extractionCitation: { createMany: createMany("citations") },
    extractionIssue: { createMany: createMany("issues") },
    extractionRun: {
      findFirst: vi.fn().mockResolvedValue({ id: "run-a" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    riskAnalysisRun: { findMany: vi.fn().mockResolvedValue([]) },
    tenderVersion: { update: vi.fn() },
    eligibilityAssessmentRun: { updateMany: vi.fn() },
    eligibilityAssessment: { updateMany: vi.fn() },
    checklistGenerationRun: { updateMany: vi.fn() },
    checklistItem: { updateMany: vi.fn() },
  };
  const database = {
    $transaction: vi.fn(
      async (callback: (tx: typeof transaction) => Promise<void>) =>
        callback(transaction),
    ),
  };
  return { database, transaction, writes };
}

async function persist(
  database: unknown,
  sources = fixture(310),
): Promise<void> {
  const processor = new ExtractionProcessor(
    database as never,
    {} as never,
    "synthetic-bucket",
  );
  return (
    processor as unknown as {
      persist: (
        runId: string,
        versionId: string,
        sources: unknown,
      ) => Promise<void>;
    }
  ).persist("run-a", "version-a", sources);
}

describe("bulk extraction persistence", () => {
  it("keeps four-document PDF, BOQ, scanned-terms, and specification summaries", async () => {
    const [primary, boq] = fixture(1);
    expect(primary).toBeDefined();
    expect(boq).toBeDefined();
    const sources: SyntheticSource[] = [
      {
        ...primary!,
        parsed: {
          ...primary!.parsed,
          units: Array.from({ length: 24 }, (_, index) => ({
            ...primary!.parsed.units[0]!,
            unitIndex: index + 1,
          })),
        },
      },
      { ...boq!, parsed: { ...boq!.parsed, format: "CSV" } },
      {
        ...primary!,
        document: { ...primary!.document, id: "document-scanned-terms" },
        parsed: {
          ...primary!.parsed,
          units: Array.from({ length: 3 }, (_, index) => ({
            ...primary!.parsed.units[0]!,
            ocrStatus: "OCR_PERFORMED",
            unitIndex: index + 1,
          })),
        },
      },
      {
        ...primary!,
        document: { ...primary!.document, id: "document-specification" },
      },
    ];
    const { database, transaction, writes } = mockDatabase();
    await persist(database, sources);
    expect(
      writes
        .filter((write) => write.model === "documents")
        .flatMap((write) => write.rows),
    ).toHaveLength(4);
    expect(
      writes
        .filter((write) => write.model === "units")
        .flatMap((write) => write.rows),
    ).toHaveLength(29);
    expect(
      writes
        .filter((write) => write.model === "cells")
        .flatMap((write) => write.rows),
    ).toHaveLength(2);
    expect(transaction.extractionRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          qualitySummary: expect.objectContaining({
            documents_processed: 4,
            ocr_pages_attempted: 3,
            ocr_pages_succeeded: 3,
            units_processed: 29,
          }),
        }),
      }),
    );
  });

  it("keeps multi-document citation relationships and activation in one bounded transaction", async () => {
    const { database, transaction, writes } = mockDatabase();
    await persist(database);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    const rows = (model: string): Record<string, unknown>[] =>
      writes
        .filter((write) => write.model === model)
        .flatMap((write) => write.rows);
    expect(rows("documents")).toHaveLength(2);
    expect(rows("units")).toHaveLength(2);
    expect(rows("blocks")).toHaveLength(620);
    expect(rows("requirements")).toHaveLength(620);
    expect(rows("tables")).toHaveLength(1);
    expect(rows("cells")).toHaveLength(2);
    expect(rows("fields").length).toBeGreaterThan(0);
    expect(rows("citations")).toHaveLength(
      rows("requirements").length + rows("fields").length,
    );
    expect(writes.every((write) => write.rows.length <= 200)).toBe(true);
    expect(writes.length).toBeLessThan(20);
    const documentIds = new Set(rows("documents").map((row) => row.id));
    const unitIds = new Set(rows("units").map((row) => row.id));
    const blockIds = new Set(rows("blocks").map((row) => row.id));
    const requirementIds = new Set(rows("requirements").map((row) => row.id));
    expect(
      rows("units").every((row) =>
        documentIds.has(row.extractionRunDocumentId),
      ),
    ).toBe(true);
    expect(
      rows("blocks").every((row) => unitIds.has(row.extractedUnitId)),
    ).toBe(true);
    expect(
      rows("citations").every(
        (row) =>
          documentIds.has(row.extractionRunDocumentId) &&
          unitIds.has(row.extractedUnitId) &&
          blockIds.has(row.extractedBlockId) &&
          (row.structuredRequirementId === undefined ||
            requirementIds.has(row.structuredRequirementId)),
      ),
    ).toBe(true);
    expect(transaction.extractionRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETE",
          qualitySummary: expect.objectContaining({
            documents_processed: 2,
            requirements_extracted: 620,
          }),
        }),
      }),
    );
  });

  it("does not activate after a bulk insert failure", async () => {
    const { database, transaction } = mockDatabase("citations");
    await expect(persist(database)).rejects.toThrow(
      "synthetic database failure",
    );
    expect(transaction.extractionRun.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.tenderVersion.update).not.toHaveBeenCalled();
  });

  it("does not insert or activate when another worker completed the run", async () => {
    const { database, transaction } = mockDatabase();
    transaction.extractionRun.updateMany.mockResolvedValue({ count: 0 });
    await expect(persist(database)).rejects.toMatchObject({
      code: "STALE_EXTRACTION_RUN",
    });
    expect(transaction.extractionRunDocument.createMany).not.toHaveBeenCalled();
    expect(transaction.tenderVersion.update).not.toHaveBeenCalled();
  });

  it("does not activate an older retry after a newer extraction run exists", async () => {
    const { database, transaction } = mockDatabase();
    transaction.extractionRun.findFirst.mockResolvedValue({ id: "newer-run" });
    await expect(persist(database)).rejects.toMatchObject({
      code: "STALE_EXTRACTION_RUN",
    });
    expect(transaction.extractionRunDocument.createMany).not.toHaveBeenCalled();
    expect(transaction.tenderVersion.update).not.toHaveBeenCalled();
  });
});
