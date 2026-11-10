import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { TenderWorkflowProgressJob } from "@tender/contracts";
import type { Prisma, PrismaClient } from "@tender/database";
import {
  classifySections,
  extractDeterministicFields,
  extractDeterministicRequirements,
  validateCitation,
  type ParsedBlock,
  type ParsedDocument,
  type SourceAnchor,
} from "@tender/domain";
import { createHash, randomUUID } from "node:crypto";
import { ParserFailure, ParserRegistry } from "./tender-document-parsers.js";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const DIAGNOSTIC_PRISMA_CODES = new Set([
  "P2000",
  "P2002",
  "P2003",
  "P2004",
  "P2011",
  "P2014",
  "P2021",
  "P2022",
  "P2025",
  "P2028",
  "P2034",
]);

type ExtractionOperation =
  "stage_update" | "source_read" | "parse_source" | "persist_transaction";
export interface ExtractionPrismaDiagnostic {
  readonly code: string;
  readonly operation: ExtractionOperation;
}

function diagnosticPrismaCode(error: unknown): string | null {
  if (
    !(error instanceof Error) ||
    error.name !== "PrismaClientKnownRequestError" ||
    !("code" in error)
  )
    return null;
  const code = error.code;
  return typeof code === "string" && DIAGNOSTIC_PRISMA_CODES.has(code)
    ? code
    : null;
}

export interface ExtractionJob {
  readonly extractionRunId: string;
  readonly organisationId: string;
  readonly requestId: string;
}

interface ParsedSource {
  readonly document: {
    readonly displayFilename: string;
    readonly extension: string;
    readonly id: string;
    readonly sha256: string;
  };
  readonly parsed: ParsedDocument;
}

const PERSIST_BATCH_SIZE = 200;

function* batches<T>(rows: readonly T[]): Generator<T[]> {
  for (let offset = 0; offset < rows.length; offset += PERSIST_BATCH_SIZE)
    yield rows.slice(offset, offset + PERSIST_BATCH_SIZE);
}

export class ExtractionProcessor {
  public constructor(
    private readonly database: PrismaClient,
    private readonly storage: S3Client,
    private readonly bucket: string,
    private readonly parsers = new ParserRegistry(),
    private readonly onPrismaDiagnostic?: (
      diagnostic: ExtractionPrismaDiagnostic,
    ) => void,
  ) {}

  public async process(
    data: ExtractionJob,
    signal?: AbortSignal,
  ): Promise<TenderWorkflowProgressJob | null> {
    const run = await this.database.extractionRun.findFirst({
      include: {
        tenderVersion: {
          include: {
            documents: {
              orderBy: { id: "asc" },
              where: { deletedAt: null },
            },
            tender: true,
          },
        },
      },
      where: { id: data.extractionRunId, organisationId: data.organisationId },
    });
    if (
      run === null ||
      ["CANCELLED", "COMPLETE", "INVALIDATED"].includes(run.status)
    )
      return null;
    if (
      run.tenderVersion.tender.organisationId !== data.organisationId ||
      run.tenderVersion.tenderId !== run.tenderId ||
      run.tenderVersion.documents.length === 0 ||
      run.tenderVersion.documents.some(
        (document) =>
          document.status !== "READY" || document.approvedObjectKey === null,
      )
    ) {
      await this.fail(run.id, "SOURCE_CHANGED", "Approved source changed");
      return null;
    }
    let operation: ExtractionOperation = "stage_update";
    try {
      await this.stage(
        run.id,
        "PARSING",
        10,
        "Loading approved source documents",
      );
      const parsedSources: ParsedSource[] = [];
      for (const [index, document] of run.tenderVersion.documents.entries()) {
        operation = "source_read";
        signal?.throwIfAborted();
        if (await this.cancelled(run.id)) return null;
        const object = await this.storage.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: document.approvedObjectKey ?? "",
          }),
        );
        if (
          object.Body === undefined ||
          object.ContentLength !== Number(document.sizeBytes) ||
          object.ContentLength > MAX_SOURCE_BYTES
        )
          throw new ParserFailure("SOURCE_SIZE_MISMATCH");
        const content = await object.Body.transformToByteArray();
        signal?.throwIfAborted();
        if (
          createHash("sha256").update(content).digest("hex") !== document.sha256
        )
          throw new ParserFailure("SOURCE_CHECKSUM_MISMATCH");
        operation = "parse_source";
        const parsed = await this.parsers.parse(
          document.extension,
          content,
          signal,
        );
        parsedSources.push({
          document: {
            displayFilename: document.displayFilename,
            extension: document.extension,
            id: document.id,
            sha256: document.sha256,
          },
          parsed,
        });
        operation = "stage_update";
        await this.stage(
          run.id,
          "PARSING",
          10 +
            Math.round(((index + 1) / run.tenderVersion.documents.length) * 45),
          `Parsed source document ${index + 1} of ${run.tenderVersion.documents.length}`,
        );
      }
      signal?.throwIfAborted();
      if (await this.cancelled(run.id)) return null;
      await this.stage(
        run.id,
        "STRUCTURING",
        65,
        "Structuring source-grounded requirements",
      );
      operation = "persist_transaction";
      await this.persist(run.id, run.tenderVersionId, parsedSources, signal);
      return {
        organisationId: data.organisationId,
        requestId: data.requestId,
        tenderId: run.tenderId,
        triggerId: run.id,
        triggerType: "EXTRACTION_COMPLETE",
        userId: run.requestedByUserId,
      };
    } catch (error: unknown) {
      const code = diagnosticPrismaCode(error);
      if (code !== null) {
        try {
          this.onPrismaDiagnostic?.({ code, operation });
        } catch {
          // Diagnostic logging must not replace the original extraction failure.
        }
      }
      if (signal?.aborted === true)
        await this.fail(
          run.id,
          "PARSER_TIMEOUT",
          "Extraction exceeded its processing deadline",
        );
      else
        await this.fail(
          run.id,
          error instanceof ParserFailure
            ? error.code
            : code !== null && operation === "persist_transaction"
              ? "PERSISTENCE_FAILURE"
              : "PARSER_FAILURE",
          publicFailure(error),
        );
      throw error;
    }
  }

  private async persist(
    runId: string,
    tenderVersionId: string,
    parsedSources: readonly ParsedSource[],
    signal?: AbortSignal,
  ): Promise<void> {
    let documentsProcessed = 0;
    let unitsProcessed = 0;
    let ocrUnavailable = 0;
    let lowConfidenceItems = 0;
    let requirementCount = 0;
    let fieldCount = 0;
    let citationFailures = 0;
    let issueCount = 0;
    const documents: Prisma.ExtractionRunDocumentCreateManyInput[] = [];
    const units: Prisma.ExtractedUnitCreateManyInput[] = [];
    const blocks: Prisma.ExtractedBlockCreateManyInput[] = [];
    const tables: Prisma.ExtractedTableCreateManyInput[] = [];
    const cells: Prisma.ExtractedTableCellCreateManyInput[] = [];
    const sections: Prisma.ClassifiedSectionCreateManyInput[] = [];
    const fields: Prisma.ExtractedTenderFieldCreateManyInput[] = [];
    const requirements: Prisma.StructuredRequirementCreateManyInput[] = [];
    const citations: Prisma.ExtractionCitationCreateManyInput[] = [];
    const issues: Prisma.ExtractionIssueCreateManyInput[] = [];

    // Assign IDs and validate citations before opening the transaction. This
    // keeps CPU work out of the database lock window and preserves every link.
    for (const source of parsedSources) {
      signal?.throwIfAborted();
      const runDocumentId = randomUUID();
      documents.push({
        id: runDocumentId,
        detectedFormat: source.parsed.format,
        extractionRunId: runId,
        parserConfiguration: {
          active_content_execution: false,
          external_fetch: false,
          ocr: parserOcrConfiguration(source.parsed.units),
        },
        parserName: source.parsed.parserName,
        parserVersion: source.parsed.parserVersion,
        sourceChecksum: source.document.sha256,
        status: "COMPLETE",
        tenderDocumentId: source.document.id,
        warningCount: source.parsed.issues.length,
      });
      documentsProcessed += 1;
      for (const unit of source.parsed.units) {
        signal?.throwIfAborted();
        const unitId = randomUUID();
        units.push({
          id: unitId,
          archiveMemberPath: unit.archiveMemberPath ?? null,
          characterCount: unit.characterCount,
          extractionRunDocumentId: runDocumentId,
          extractionRunId: runId,
          label: unit.label ?? null,
          language: unit.language ?? null,
          ocrConfidence: unit.ocrConfidence ?? null,
          ocrStatus: unit.ocrStatus,
          parserConfidence: unit.confidence,
          unitIndex: unit.unitIndex,
          unitType: unit.unitType,
        });
        unitsProcessed += 1;
        if (
          unit.ocrStatus === "OCR_UNAVAILABLE" ||
          unit.ocrStatus === "OCR_FAILED"
        )
          ocrUnavailable += 1;
        const blockIds = new Map<number, string>();
        for (const block of unit.blocks) {
          const blockId = randomUUID();
          blocks.push({
            id: blockId,
            blockType: block.type,
            confidence: block.confidence,
            ...(block.coordinates === undefined
              ? {}
              : { coordinates: { ...block.coordinates } }),
            extractedUnitId: unitId,
            extractionRunDocumentId: runDocumentId,
            extractionRunId: runId,
            headingLevel: block.headingLevel ?? null,
            language: unit.language ?? null,
            normalizedText: block.text,
            readingOrder: block.readingOrder,
            sourceEndOffset: block.sourceEndOffset,
            sourceStartOffset: block.sourceStartOffset,
            warnings: [...block.warnings],
          });
          blockIds.set(block.readingOrder, blockId);
          if (
            block.confidence === "LOW" ||
            block.confidence === "HUMAN_REVIEW_REQUIRED"
          )
            lowConfidenceItems += 1;
          if (block.table !== undefined) {
            const tableId = randomUUID();
            tables.push({
              id: tableId,
              columnCount: block.table.columnCount,
              confidence: block.confidence,
              extractedBlockId: blockId,
              extractionRunId: runId,
              rowCount: block.table.rowCount,
            });
            for (const cell of block.table.cells)
              cells.push({
                cellReference: cell.cellReference ?? null,
                columnIndex: cell.columnIndex,
                columnSpan: cell.columnSpan ?? 1,
                displayedValue: cell.displayedValue,
                extractedTableId: tableId,
                formulaText: cell.formulaText ?? null,
                rowIndex: cell.rowIndex,
                rowSpan: cell.rowSpan ?? 1,
              });
          }
        }
        for (const section of classifySections(unit.blocks))
          sections.push({
            category: section.category,
            classificationState: section.state,
            confidence: section.confidence,
            endReadingOrder: section.endReadingOrder,
            extractionRunId: runId,
            startReadingOrder: section.startReadingOrder,
            title: section.title,
          });
        const anchorFor = (block: ParsedBlock): SourceAnchor => ({
          ...(unit.archiveMemberPath === undefined
            ? {}
            : { archiveMemberPath: unit.archiveMemberPath }),
          blockReadingOrder: block.readingOrder,
          documentId: source.document.id,
          documentName: source.document.displayFilename,
          endOffset: block.sourceEndOffset,
          excerpt: block.text.slice(0, 900),
          ...(unit.unitType === "PAGE" ? { pageNumber: unit.unitIndex } : {}),
          ...(unit.unitType === "SHEET" && unit.label !== undefined
            ? { sheetName: unit.label }
            : {}),
          sourceChecksum: source.document.sha256,
          startOffset: block.sourceStartOffset,
          unitIndex: unit.unitIndex,
        });
        for (const field of extractDeterministicFields(
          unit.blocks,
          anchorFor,
        )) {
          const block = requireBlock(
            unit.blocks,
            field.anchor.blockReadingOrder,
          );
          if (!validateCitation(block, field.anchor)) {
            citationFailures += 1;
            continue;
          }
          const fieldId = randomUUID();
          fields.push({
            id: fieldId,
            confidence: field.confidence,
            extractionRunId: runId,
            fieldType: field.fieldType,
            findingState: field.findingState,
            normalizedDateValue: field.normalizedDateValue ?? null,
            normalizedTextValue: field.normalizedTextValue,
            sourceWording: field.sourceWording,
          });
          citations.push({
            ...citationData(
              runId,
              runDocumentId,
              unitId,
              blockIds,
              field.anchor,
              {
                extractedTenderFieldId: fieldId,
              },
            ),
          });
          fieldCount += 1;
        }
        for (const requirement of extractDeterministicRequirements(
          unit.blocks,
          anchorFor,
        )) {
          const block = requireBlock(
            unit.blocks,
            requirement.anchor.blockReadingOrder,
          );
          if (!validateCitation(block, requirement.anchor)) {
            citationFailures += 1;
            continue;
          }
          const requirementId = randomUUID();
          requirements.push({
            id: requirementId,
            category: requirement.category,
            conditionText: requirement.conditionText ?? null,
            confidence: requirement.confidence,
            extractionRunId: runId,
            findingState: requirement.findingState,
            normalizedStatement: requirement.normalizedStatement,
            obligation: requirement.obligation,
            sourceWording: requirement.sourceWording,
            currency: requirement.threshold?.currency ?? null,
            thresholdNumericValue: requirement.threshold?.numericValue ?? null,
            thresholdOperator: requirement.threshold?.operator ?? null,
            thresholdTextValue: requirement.threshold?.textValue ?? null,
            unit: requirement.threshold?.unit ?? null,
            title: requirement.title,
          });
          citations.push({
            ...citationData(
              runId,
              runDocumentId,
              unitId,
              blockIds,
              requirement.anchor,
              {
                structuredRequirementId: requirementId,
              },
            ),
          });
          requirementCount += 1;
        }
        for (const issue of source.parsed.issues.filter(
          (candidate) =>
            candidate.unitIndex === undefined ||
            candidate.unitIndex === unit.unitIndex,
        )) {
          issues.push({
            extractedUnitId: unitId,
            extractionRunId: runId,
            issueType: issue.issueType,
            requiresHumanReview: issue.requiresHumanReview,
            safeMessage: issue.safeMessage,
            severity: issue.severity,
            sourceDocumentId: source.document.id,
          });
          issueCount += 1;
        }
      }
    }
    if (citationFailures > 0)
      throw new ParserFailure("CITATION_VALIDATION_FAILED");

    await this.database.$transaction(
      async (transaction) => {
        // Return a boolean: Prisma cannot deserialize PostgreSQL's void result.
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenderVersionId}::text, 0)) IS NOT NULL AS locked`;
        // Serialize duplicate workers for this run before inserting any rows.
        // A late worker sees COMPLETE after the first transaction commits.
        const claim = await transaction.extractionRun.updateMany({
          data: { currentStage: "STRUCTURING" },
          where: {
            id: runId,
            status: "STRUCTURING",
            cancellationRequestedAt: null,
          },
        });
        if (claim.count !== 1) throw new ParserFailure("STALE_EXTRACTION_RUN");
        const latest = await transaction.extractionRun.findFirst({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
          where: { tenderVersionId },
        });
        if (latest?.id !== runId)
          throw new ParserFailure("STALE_EXTRACTION_RUN");
        for (const batch of batches(documents))
          await transaction.extractionRunDocument.createMany({ data: batch });
        for (const batch of batches(units))
          await transaction.extractedUnit.createMany({ data: batch });
        for (const batch of batches(blocks))
          await transaction.extractedBlock.createMany({ data: batch });
        for (const batch of batches(tables))
          await transaction.extractedTable.createMany({ data: batch });
        for (const batch of batches(cells))
          await transaction.extractedTableCell.createMany({ data: batch });
        for (const batch of batches(sections))
          await transaction.classifiedSection.createMany({ data: batch });
        for (const batch of batches(fields))
          await transaction.extractedTenderField.createMany({ data: batch });
        for (const batch of batches(requirements))
          await transaction.structuredRequirement.createMany({ data: batch });
        for (const batch of batches(citations))
          await transaction.extractionCitation.createMany({ data: batch });
        for (const batch of batches(issues))
          await transaction.extractionIssue.createMany({ data: batch });
        const activation = await transaction.extractionRun.updateMany({
          data: {
            completedAt: new Date(),
            currentStage: "COMPLETE",
            eventSequence: { increment: 1 },
            progressPercentage: 100,
            publicMessage:
              "Extraction complete; review source-grounded results",
            qualitySummary: {
              citation_failures: citationFailures,
              documents_processed: documentsProcessed,
              fields_extracted: fieldCount,
              low_confidence_items: lowConfidenceItems,
              ocr_pages_unavailable: ocrUnavailable,
              ocr_pages_attempted: parsedSources.reduce(
                (total, source) =>
                  total +
                  source.parsed.units.filter((unit) =>
                    [
                      "OCR_FAILED",
                      "OCR_PERFORMED",
                      "HUMAN_REVIEW_REQUIRED",
                    ].includes(unit.ocrStatus),
                  ).length,
                0,
              ),
              ocr_pages_succeeded: parsedSources.reduce(
                (total, source) =>
                  total +
                  source.parsed.units.filter(
                    (unit) =>
                      unit.ocrStatus === "OCR_PERFORMED" ||
                      unit.ocrStatus === "HUMAN_REVIEW_REQUIRED",
                  ).length,
                0,
              ),
              requirements_extracted: requirementCount,
              unresolved_issues: issueCount,
              units_processed: unitsProcessed,
            },
            status: "COMPLETE",
          },
          where: {
            id: runId,
            status: "STRUCTURING",
            cancellationRequestedAt: null,
          },
        });
        if (activation.count !== 1)
          throw new ParserFailure("CANCELLED_DURING_COMMIT");
        const staleRuns = await transaction.riskAnalysisRun.findMany({
          select: { id: true },
          where: {
            extractionRunId: { not: runId },
            gateType: "EARLY",
            status: { in: ["QUEUED", "ANALYSING", "VALIDATING", "COMPLETE"] },
            tenderVersionId,
          },
        });
        if (staleRuns.length > 0) {
          const staleIds = staleRuns.map((run) => run.id);
          await transaction.riskAnalysisRun.updateMany({
            data: {
              currentStage: "INVALIDATED",
              invalidatedAt: new Date(),
              publicMessage:
                "A newer extraction requires a fresh early risk analysis",
              status: "INVALIDATED",
            },
            where: { id: { in: staleIds } },
          });
          await transaction.riskFinding.updateMany({
            data: { findingStatus: "INVALIDATED", invalidatedAt: new Date() },
            where: { riskAnalysisRunId: { in: staleIds } },
          });
          await transaction.earlyPursuitDecision.updateMany({
            data: { supersededAt: new Date() },
            where: { riskAnalysisRunId: { in: staleIds }, supersededAt: null },
          });
        }
        await transaction.tenderVersion.update({
          data: {
            activeEarlyRiskRunId: null,
            activeEligibilityAssessmentRunId: null,
            activeExtractionRunId: runId,
          },
          where: { id: tenderVersionId },
        });
        const assessmentInvalidatedAt = new Date();
        await transaction.eligibilityAssessmentRun.updateMany({
          data: {
            currentStage: "INVALIDATED",
            invalidatedAt: assessmentInvalidatedAt,
            publicMessage:
              "A newer extraction requires fresh evidence comparison",
            status: "INVALIDATED",
          },
          where: {
            extractionRunId: { not: runId },
            status: {
              in: [
                "QUEUED",
                "SNAPSHOTTING",
                "MATCHING",
                "VALIDATING",
                "COMPLETE",
              ],
            },
            tenderVersionId,
          },
        });
        await transaction.eligibilityAssessment.updateMany({
          data: { invalidatedAt: assessmentInvalidatedAt },
          where: {
            assessmentRun: { extractionRunId: { not: runId }, tenderVersionId },
            invalidatedAt: null,
          },
        });
        await transaction.checklistGenerationRun.updateMany({
          data: {
            activatedAt: null,
            currentStage: "INVALIDATED",
            invalidatedAt: assessmentInvalidatedAt,
            publicMessage: "A newer extraction requires a fresh checklist",
            status: "INVALIDATED",
          },
          where: { invalidatedAt: null, tenderVersionId },
        });
        await transaction.checklistItem.updateMany({
          data: {
            invalidatedAt: assessmentInvalidatedAt,
            status: "INVALIDATED",
          },
          where: { invalidatedAt: null, tenderVersionId },
        });
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  private async stage(
    runId: string,
    status: "PARSING" | "STRUCTURING",
    progressPercentage: number,
    publicMessage: string,
  ): Promise<void> {
    const stage = await this.database.extractionRun.updateMany({
      data: {
        ...(status === "PARSING"
          ? {
              completedAt: null,
              failureCategory: null,
              internalFailureReference: null,
              safeFailureMessage: null,
            }
          : {}),
        currentStage: status,
        eventSequence: { increment: 1 },
        progressPercentage,
        publicMessage,
        startedAt: new Date(),
        status,
      },
      where: {
        id: runId,
        status: { in: ["QUEUED", "PARSING", "STRUCTURING", "FAILED"] },
        cancellationRequestedAt: null,
      },
    });
    if (stage.count !== 1) throw new ParserFailure("STALE_EXTRACTION_RUN");
  }

  private async cancelled(runId: string): Promise<boolean> {
    const run = await this.database.extractionRun.findUnique({
      select: { cancellationRequestedAt: true, status: true },
      where: { id: runId },
    });
    return (
      run?.status === "CANCELLED" ||
      (run?.cancellationRequestedAt ?? null) !== null
    );
  }

  private async fail(
    runId: string,
    failureCategory: string,
    safeFailureMessage: string,
  ): Promise<void> {
    await this.database.extractionRun.updateMany({
      data: {
        completedAt: new Date(),
        currentStage: "FAILED",
        eventSequence: { increment: 1 },
        failureCategory,
        internalFailureReference: randomUUID(),
        publicMessage: safeFailureMessage,
        safeFailureMessage,
        status: "FAILED",
      },
      where: {
        id: runId,
        status: { in: ["QUEUED", "PARSING", "STRUCTURING", "FAILED"] },
      },
    });
  }
}

function requireBlock(
  blocks: readonly ParsedBlock[],
  readingOrder: number,
): ParsedBlock {
  const block = blocks.find(
    (candidate) => candidate.readingOrder === readingOrder,
  );
  if (block === undefined) throw new ParserFailure("CITATION_BLOCK_MISSING");
  return block;
}

function citationData(
  runId: string,
  runDocumentId: string,
  unitId: string,
  blockIds: ReadonlyMap<number, string>,
  anchor: SourceAnchor,
  target:
    | { readonly extractedTenderFieldId: string }
    | { readonly structuredRequirementId: string },
): {
  readonly archiveMemberPath: string | null;
  readonly boundedExcerpt: string;
  readonly documentName: string;
  readonly endOffset: number;
  readonly extractedBlockId: string;
  readonly extractedTenderFieldId?: string;
  readonly extractedUnitId: string;
  readonly extractionRunDocumentId: string;
  readonly extractionRunId: string;
  readonly pageNumber: number | null;
  readonly sheetName: string | null;
  readonly sourceChecksum: string;
  readonly startOffset: number;
  readonly structuredRequirementId?: string;
  readonly tenderDocumentId: string;
  readonly validationStatus: string;
} {
  const extractedBlockId = blockIds.get(anchor.blockReadingOrder);
  if (extractedBlockId === undefined)
    throw new ParserFailure("CITATION_BLOCK_MISSING");
  return {
    archiveMemberPath: anchor.archiveMemberPath ?? null,
    boundedExcerpt: anchor.excerpt,
    documentName: anchor.documentName,
    endOffset: anchor.endOffset,
    extractedBlockId,
    extractedUnitId: unitId,
    extractionRunDocumentId: runDocumentId,
    extractionRunId: runId,
    pageNumber: anchor.pageNumber ?? null,
    sheetName: anchor.sheetName ?? null,
    sourceChecksum: anchor.sourceChecksum,
    startOffset: anchor.startOffset,
    tenderDocumentId: anchor.documentId,
    ...target,
    validationStatus: "VALID",
  };
}

function parserOcrConfiguration(
  units: readonly ParsedDocument["units"][number][],
): Prisma.InputJsonValue {
  const ocrUnits = units.filter(
    (unit) =>
      unit.ocrStatus === "OCR_PERFORMED" ||
      unit.ocrStatus === "HUMAN_REVIEW_REQUIRED" ||
      unit.ocrStatus === "OCR_FAILED",
  );
  if (ocrUnits.length === 0) return { status: "not_required" };
  const firstConfigured = ocrUnits.find((unit) => unit.ocrEngine !== undefined);
  return {
    attempted_pages: ocrUnits.length,
    configuration: firstConfigured?.ocrConfiguration ?? null,
    engine: firstConfigured?.ocrEngine ?? null,
    engine_version: firstConfigured?.ocrEngineVersion ?? null,
    status: "performed_when_embedded_text_insufficient",
  };
}

function publicFailure(error: unknown): string {
  if (error instanceof ParserFailure) {
    if (error.code === "PASSWORD_PROTECTED")
      return "A source document is password protected";
    if (error.code.includes("LIMIT"))
      return "A source document exceeds a supported extraction limit";
    if (error.code.includes("MALFORMED"))
      return "A source document is malformed";
  }
  return "Extraction failed safely";
}
