import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@tender/database";
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

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$extends" | "$on" | "$transaction" | "$use"
>;

export class ExtractionProcessor {
  public constructor(
    private readonly database: PrismaClient,
    private readonly storage: S3Client,
    private readonly bucket: string,
    private readonly parsers = new ParserRegistry(),
  ) {}

  public async process(
    data: ExtractionJob,
    signal?: AbortSignal,
  ): Promise<void> {
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
      return;
    if (
      run.tenderVersion.tender.organisationId !== data.organisationId ||
      run.tenderVersion.tenderId !== run.tenderId ||
      run.tenderVersion.documents.length === 0 ||
      run.tenderVersion.documents.some(
        (document) =>
          document.status !== "READY" || document.approvedObjectKey === null,
      )
    )
      return this.fail(run.id, "SOURCE_CHANGED", "Approved source changed");
    try {
      await this.stage(
        run.id,
        "PARSING",
        10,
        "Loading approved source documents",
      );
      const parsedSources: ParsedSource[] = [];
      for (const [index, document] of run.tenderVersion.documents.entries()) {
        signal?.throwIfAborted();
        if (await this.cancelled(run.id)) return;
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
        await this.stage(
          run.id,
          "PARSING",
          10 +
            Math.round(((index + 1) / run.tenderVersion.documents.length) * 45),
          `Parsed source document ${index + 1} of ${run.tenderVersion.documents.length}`,
        );
      }
      signal?.throwIfAborted();
      if (await this.cancelled(run.id)) return;
      await this.stage(
        run.id,
        "STRUCTURING",
        65,
        "Structuring source-grounded requirements",
      );
      await this.persist(run.id, run.tenderVersionId, parsedSources, signal);
    } catch (error: unknown) {
      if (signal?.aborted === true)
        await this.fail(
          run.id,
          "PARSER_TIMEOUT",
          "Extraction exceeded its processing deadline",
        );
      else
        await this.fail(
          run.id,
          error instanceof ParserFailure ? error.code : "PARSER_FAILURE",
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
    await this.database.$transaction(async (transaction) => {
      for (const source of parsedSources) {
        signal?.throwIfAborted();
        const runDocument = await transaction.extractionRunDocument.create({
          data: {
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
          },
        });
        documentsProcessed += 1;
        for (const unit of source.parsed.units) {
          const storedUnit = await transaction.extractedUnit.create({
            data: {
              archiveMemberPath: unit.archiveMemberPath ?? null,
              characterCount: unit.characterCount,
              extractionRunDocumentId: runDocument.id,
              extractionRunId: runId,
              label: unit.label ?? null,
              language: unit.language ?? null,
              ocrConfidence: unit.ocrConfidence ?? null,
              ocrStatus: unit.ocrStatus,
              parserConfidence: unit.confidence,
              unitIndex: unit.unitIndex,
              unitType: unit.unitType,
            },
          });
          unitsProcessed += 1;
          if (
            unit.ocrStatus === "OCR_UNAVAILABLE" ||
            unit.ocrStatus === "OCR_FAILED"
          )
            ocrUnavailable += 1;
          const blockIds = new Map<number, string>();
          for (const block of unit.blocks) {
            const storedBlock = await transaction.extractedBlock.create({
              data: {
                blockType: block.type,
                confidence: block.confidence,
                ...(block.coordinates === undefined
                  ? {}
                  : { coordinates: { ...block.coordinates } }),
                extractedUnitId: storedUnit.id,
                extractionRunDocumentId: runDocument.id,
                extractionRunId: runId,
                headingLevel: block.headingLevel ?? null,
                language: unit.language ?? null,
                normalizedText: block.text,
                readingOrder: block.readingOrder,
                sourceEndOffset: block.sourceEndOffset,
                sourceStartOffset: block.sourceStartOffset,
                warnings: [...block.warnings],
              },
            });
            blockIds.set(block.readingOrder, storedBlock.id);
            if (
              block.confidence === "LOW" ||
              block.confidence === "HUMAN_REVIEW_REQUIRED"
            )
              lowConfidenceItems += 1;
            if (block.table !== undefined) {
              const table = await transaction.extractedTable.create({
                data: {
                  columnCount: block.table.columnCount,
                  confidence: block.confidence,
                  extractedBlockId: storedBlock.id,
                  extractionRunId: runId,
                  rowCount: block.table.rowCount,
                },
              });
              if (block.table.cells.length > 0)
                await transaction.extractedTableCell.createMany({
                  data: block.table.cells.map((cell) => ({
                    cellReference: cell.cellReference ?? null,
                    columnIndex: cell.columnIndex,
                    columnSpan: cell.columnSpan ?? 1,
                    displayedValue: cell.displayedValue,
                    extractedTableId: table.id,
                    formulaText: cell.formulaText ?? null,
                    rowIndex: cell.rowIndex,
                    rowSpan: cell.rowSpan ?? 1,
                  })),
                });
            }
          }
          for (const section of classifySections(unit.blocks))
            await transaction.classifiedSection.create({
              data: {
                category: section.category,
                classificationState: section.state,
                confidence: section.confidence,
                endReadingOrder: section.endReadingOrder,
                extractionRunId: runId,
                startReadingOrder: section.startReadingOrder,
                title: section.title,
              },
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
          await this.storeFields(
            transaction,
            runId,
            runDocument.id,
            storedUnit.id,
            blockIds,
            unit.blocks,
            anchorFor,
            () => {
              fieldCount += 1;
            },
            () => {
              citationFailures += 1;
            },
          );
          await this.storeRequirements(
            transaction,
            runId,
            runDocument.id,
            storedUnit.id,
            blockIds,
            unit.blocks,
            anchorFor,
            () => {
              requirementCount += 1;
            },
            () => {
              citationFailures += 1;
            },
          );
          for (const issue of source.parsed.issues.filter(
            (candidate) =>
              candidate.unitIndex === undefined ||
              candidate.unitIndex === unit.unitIndex,
          )) {
            await transaction.extractionIssue.create({
              data: {
                extractedUnitId: storedUnit.id,
                extractionRunId: runId,
                issueType: issue.issueType,
                requiresHumanReview: issue.requiresHumanReview,
                safeMessage: issue.safeMessage,
                severity: issue.severity,
                sourceDocumentId: source.document.id,
              },
            });
            issueCount += 1;
          }
        }
      }
      if (citationFailures > 0)
        throw new ParserFailure("CITATION_VALIDATION_FAILED");
      if (await this.cancelled(runId))
        throw new ParserFailure("CANCELLED_DURING_COMMIT");
      await transaction.extractionRun.update({
        data: {
          completedAt: new Date(),
          currentStage: "COMPLETE",
          eventSequence: { increment: 1 },
          progressPercentage: 100,
          publicMessage: "Extraction complete; review source-grounded results",
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
        where: { id: runId },
      });
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
    });
  }

  private async storeFields(
    transaction: TransactionClient,
    runId: string,
    runDocumentId: string,
    unitId: string,
    blockIds: ReadonlyMap<number, string>,
    blocks: readonly ParsedBlock[],
    anchorFor: (block: ParsedBlock) => SourceAnchor,
    stored: () => void,
    failed: () => void,
  ): Promise<void> {
    for (const field of extractDeterministicFields(blocks, anchorFor)) {
      const block = requireBlock(blocks, field.anchor.blockReadingOrder);
      if (!validateCitation(block, field.anchor)) {
        failed();
        continue;
      }
      const record = await transaction.extractedTenderField.create({
        data: {
          confidence: field.confidence,
          extractionRunId: runId,
          fieldType: field.fieldType,
          findingState: field.findingState,
          normalizedDateValue: field.normalizedDateValue ?? null,
          normalizedTextValue: field.normalizedTextValue,
          sourceWording: field.sourceWording,
        },
      });
      await transaction.extractionCitation.create({
        data: citationData(
          runId,
          runDocumentId,
          unitId,
          blockIds,
          field.anchor,
          { extractedTenderFieldId: record.id },
        ),
      });
      stored();
    }
  }

  private async storeRequirements(
    transaction: TransactionClient,
    runId: string,
    runDocumentId: string,
    unitId: string,
    blockIds: ReadonlyMap<number, string>,
    blocks: readonly ParsedBlock[],
    anchorFor: (block: ParsedBlock) => SourceAnchor,
    stored: () => void,
    failed: () => void,
  ): Promise<void> {
    for (const requirement of extractDeterministicRequirements(
      blocks,
      anchorFor,
    )) {
      const block = requireBlock(blocks, requirement.anchor.blockReadingOrder);
      if (!validateCitation(block, requirement.anchor)) {
        failed();
        continue;
      }
      const record = await transaction.structuredRequirement.create({
        data: {
          category: requirement.category,
          confidence: requirement.confidence,
          extractionRunId: runId,
          findingState: requirement.findingState,
          normalizedStatement: requirement.normalizedStatement,
          obligation: requirement.obligation,
          sourceWording: requirement.sourceWording,
          title: requirement.title,
        },
      });
      await transaction.extractionCitation.create({
        data: citationData(
          runId,
          runDocumentId,
          unitId,
          blockIds,
          requirement.anchor,
          { structuredRequirementId: record.id },
        ),
      });
      stored();
    }
  }

  private async stage(
    runId: string,
    status: "PARSING" | "STRUCTURING",
    progressPercentage: number,
    publicMessage: string,
  ): Promise<void> {
    await this.database.extractionRun.update({
      data: {
        currentStage: status,
        eventSequence: { increment: 1 },
        progressPercentage,
        publicMessage,
        startedAt: new Date(),
        status,
      },
      where: { id: runId },
    });
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
      where: { id: runId, status: { not: "CANCELLED" } },
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
): object {
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
