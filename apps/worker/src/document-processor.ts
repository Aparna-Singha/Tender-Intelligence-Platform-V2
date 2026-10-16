import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Prisma, PrismaClient } from "@tender/database";
import { isAllowedMimeExtension, MAX_UPLOAD_BYTES } from "@tender/domain";
import { fileTypeFromBuffer } from "file-type";
import { createHash } from "node:crypto";
import type { MalwareScanner } from "./malware-scanner.js";
import { ParserFailure, PdfParser } from "./tender-document-parsers.js";
import {
  addressesMateriallyDiffer,
  extractCompanyEvidenceFacts,
  normalizeAddress,
  scopeValue,
  type ExtractedCompanyEvidenceFact,
} from "./company-evidence-extraction.js";

export interface DocumentJob {
  readonly documentVersionId: string;
  readonly organisationId: string;
  readonly requestId: string;
}

export interface CompanyUploadCleanupJob {
  readonly documentVersionId: string;
  readonly keys: readonly string[];
  readonly organisationId: string;
  readonly requestId: string;
}

export class DocumentProcessor {
  public constructor(
    private readonly database: PrismaClient,
    private readonly storage: S3Client,
    private readonly bucket: string,
    private readonly scanner: MalwareScanner,
  ) {}

  public async process(
    jobName: string,
    data: DocumentJob,
    signal?: AbortSignal,
  ): Promise<void> {
    if (jobName === "delete-company-document") {
      await this.deleteDocument(data);
      return;
    }
    if (jobName !== "process-company-document")
      throw new Error("Unsupported job");
    const version = await this.database.documentVersion.findFirst({
      include: { document: true },
      where: {
        id: data.documentVersionId,
        document: { organisationId: data.organisationId },
      },
    });
    if (version === null) throw new Error("Document version not found");
    await this.database.document.update({
      data: { status: "SCANNING" },
      where: { id: version.documentId },
    });
    const object = await this.storage.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: version.quarantineObjectKey,
      }),
    );
    if (
      object.Body === undefined ||
      object.ContentLength !== Number(version.sizeBytes) ||
      object.ContentLength > MAX_UPLOAD_BYTES
    )
      throw new Error("Uploaded object exceeds its bounded size");
    const content = await object.Body.transformToByteArray();
    signal?.throwIfAborted();
    const checksum = createHash("sha256").update(content).digest("hex");
    const detected = await fileTypeFromBuffer(content);
    signal?.throwIfAborted();
    if (
      checksum !== version.sha256 ||
      content.byteLength !== Number(version.sizeBytes) ||
      detected === undefined ||
      !isAllowedMimeExtension(detected.mime, version.extension) ||
      detected.mime !== version.declaredMimeType
    ) {
      await this.reject(
        version.documentId,
        version.id,
        detected?.mime,
        "FILE_TYPE_MISMATCH",
      );
      return;
    }
    const scan = await this.scanner.scan(content);
    signal?.throwIfAborted();
    if (scan.status === "INFECTED") {
      await this.reject(
        version.documentId,
        version.id,
        detected.mime,
        "MALWARE_DETECTED",
      );
      return;
    }
    if (scan.status === "ERROR") {
      await this.database.document.update({
        data: { status: "QUARANTINED" },
        where: { id: version.documentId },
      });
      throw new Error("Malware scanner unavailable");
    }
    let extractionMetadata: Prisma.InputJsonObject = {
      detected_mime_type: detected.mime,
      size_bytes: content.byteLength,
    };
    let extractedFacts: readonly ExtractedCompanyEvidenceFact[] = [];
    if (detected.mime === "application/pdf") {
      try {
        const parsed = await new PdfParser().parse(content, signal);
        extractedFacts = extractCompanyEvidenceFacts(parsed);
        const ocrAttempted = parsed.units.filter((unit) =>
          ["OCR_PERFORMED", "HUMAN_REVIEW_REQUIRED", "OCR_FAILED"].includes(
            unit.ocrStatus,
          ),
        );
        extractionMetadata = {
          ...extractionMetadata,
          issue_count: parsed.issues.length,
          ocr_pages_attempted: ocrAttempted.length,
          ocr_pages_succeeded: ocrAttempted.filter(
            (unit) => unit.ocrStatus === "OCR_PERFORMED",
          ).length,
          page_count: parsed.units.length,
          parser_name: parsed.parserName,
          parser_version: parsed.parserVersion,
          extracted_fact_count: extractedFacts.length,
        };
      } catch (error: unknown) {
        if (error instanceof ParserFailure) {
          await this.reject(
            version.documentId,
            version.id,
            detected.mime,
            error.code,
          );
          return;
        }
        throw error;
      }
    }
    await this.database.document.update({
      data: { status: "PROCESSING" },
      where: { id: version.documentId },
    });
    signal?.throwIfAborted();
    const approvedKey = `approved/${data.organisationId}/${version.id}`;
    await this.storage.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${version.quarantineObjectKey}`,
        Key: approvedKey,
        MetadataDirective: "COPY",
      }),
    );
    signal?.throwIfAborted();
    await this.storage.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: version.quarantineObjectKey,
      }),
    );
    signal?.throwIfAborted();
    await this.database.$transaction(async (transaction) => {
      await transaction.documentVersion.update({
        data: {
          approvedObjectKey: approvedKey,
          detectedMimeType: detected.mime,
        },
        where: { id: version.id },
      });
      await transaction.documentExtraction.upsert({
        create: {
          completedAt: new Date(),
          documentVersionId: version.id,
          metadata: extractionMetadata,
          startedAt: new Date(),
          status: "READY",
        },
        update: {
          completedAt: new Date(),
          metadata: extractionMetadata,
          status: "READY",
        },
        where: { documentVersionId: version.id },
      });
      await transaction.document.update({
        data: { currentVersionId: version.id, status: "READY" },
        where: { id: version.documentId },
      });
      for (const fact of extractedFacts)
        await this.persistExtractedFact(
          transaction,
          data.organisationId,
          version,
          fact,
          data.requestId,
        );
      await this.reconcileExperienceEvidence(
        transaction,
        data.organisationId,
        version.uploadedByUserId,
        data.requestId,
      );
      await this.reconcileGstAddressConflict(
        transaction,
        data.organisationId,
        version.uploadedByUserId,
        data.requestId,
      );
    });
    await this.invalidateAssessments(data.organisationId);
    if (signal?.aborted === true) {
      await this.database.$transaction([
        this.database.document.update({
          data: { currentVersionId: null, status: "FAILED" },
          where: { id: version.documentId },
        }),
        this.database.documentExtraction.update({
          data: {
            completedAt: new Date(),
            failureCode: "JOB_TIMEOUT",
            status: "FAILED",
          },
          where: { documentVersionId: version.id },
        }),
      ]);
      signal.throwIfAborted();
    }
  }

  public async cleanupUploadObjects(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
          }),
        );
      } catch (error: unknown) {
        if (!isMissingObjectError(error)) throw error;
      }
    }
  }

  private async persistExtractedFact(
    transaction: Prisma.TransactionClient,
    organisationId: string,
    version: Prisma.DocumentVersionGetPayload<{ include: { document: true } }>,
    extracted: ExtractedCompanyEvidenceFact,
    requestId: string,
  ): Promise<void> {
    const existing = await transaction.companyEvidenceFact.findFirst({
      where: {
        documentId: version.documentId,
        factType: extracted.factType,
        invalidatedAt: null,
        organisationId,
        currentVersion: { documentVersionId: version.id },
      },
    });
    if (existing !== null) return;
    const fact = await transaction.companyEvidenceFact.create({
      data: {
        createdByUserId: version.uploadedByUserId,
        documentId: version.documentId,
        factType: extracted.factType,
        organisationId,
      },
    });
    const factVersion = await transaction.companyEvidenceFactVersion.create({
      data: {
        booleanValue: null,
        confidence: extracted.confidence,
        createdByUserId: version.uploadedByUserId,
        currency: extracted.currency ?? null,
        dateValue: extracted.dateValue ?? null,
        documentVersionId: version.id,
        evidenceFactId: fact.id,
        financialYear: null,
        numberValue: extracted.numberValue ?? null,
        scope: extracted.scope ?? null,
        textListValue: [],
        textValue: extracted.textValue ?? null,
        unit: null,
        validFrom: extracted.validFrom ?? null,
        validUntil: extracted.validUntil ?? null,
        valueType: extracted.valueType,
        versionNumber: 1,
      },
    });
    await transaction.companyEvidenceCitation.create({
      data: {
        boundedExcerpt: extracted.boundedExcerpt,
        createdByUserId: version.uploadedByUserId,
        documentCategory: version.document.category,
        documentChecksum: version.sha256,
        documentId: version.documentId,
        documentName: version.document.displayName,
        documentVersionId: version.id,
        evidenceFactVersionId: factVersion.id,
        locatorType: extracted.locatorType,
        organisationId,
        pageNumber: extracted.pageNumber,
      },
    });
    await transaction.companyEvidenceFact.update({
      data: { currentVersionId: factVersion.id },
      where: { id: fact.id },
    });
    await transaction.auditEvent.create({
      data: {
        actorUserId: version.uploadedByUserId,
        eventType: "COMPANY_EVIDENCE_FACT_CREATED",
        metadata: { extraction: "DETERMINISTIC", factType: extracted.factType },
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: fact.id,
        subjectType: "company_evidence_fact",
      },
    });
  }

  private async reconcileExperienceEvidence(
    transaction: Prisma.TransactionClient,
    organisationId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<void> {
    const facts = await transaction.companyEvidenceFact.findMany({
      include: {
        currentVersion: { include: { citations: true } },
        document: true,
      },
      where: {
        factType: {
          in: [
            "PURCHASE_ORDER_VALUE",
            "INVOICE_REFERENCE",
            "COMPLETION_REFERENCE",
          ],
        },
        invalidatedAt: null,
        organisationId,
      },
    });
    const purchaseOrders = facts.filter(
      (fact) => fact.factType === "PURCHASE_ORDER_VALUE",
    );
    const invoices = facts.filter(
      (fact) => fact.factType === "INVOICE_REFERENCE",
    );
    const completions = facts.filter(
      (fact) => fact.factType === "COMPLETION_REFERENCE",
    );
    for (const completion of completions) {
      const reference = completion.currentVersion?.textValue
        ?.trim()
        .toUpperCase();
      if (reference === undefined) continue;
      const purchaseOrder = purchaseOrders.find(
        (fact) =>
          scopeValue(fact.currentVersion?.scope ?? null, "PO number")
            ?.trim()
            .toUpperCase() === reference,
      );
      const invoice = invoices.find(
        (fact) =>
          scopeValue(fact.currentVersion?.scope ?? null, "Related PO")
            ?.trim()
            .toUpperCase() === reference,
      );
      const poVersion = purchaseOrder?.currentVersion;
      const invoiceVersion = invoice?.currentVersion;
      const completionVersion = completion.currentVersion;
      if (
        purchaseOrder === undefined ||
        invoice === undefined ||
        poVersion?.numberValue === null ||
        poVersion?.numberValue === undefined ||
        invoiceVersion?.id === undefined ||
        completionVersion?.id === undefined
      )
        continue;
      const poCustomer = scopeValue(poVersion.scope, "Customer");
      const invoiceCustomer = scopeValue(invoiceVersion.scope, "Customer");
      const completionCustomer = scopeValue(
        completionVersion.scope,
        "Customer",
      );
      const poSupplier = scopeValue(poVersion.scope, "Supplier");
      const invoiceSupplier = scopeValue(invoiceVersion.scope, "Supplier");
      const completionSupplier = scopeValue(
        completionVersion.scope,
        "Supplier",
      );
      if (
        !sameIdentity([poCustomer, invoiceCustomer, completionCustomer]) ||
        !sameIdentity([poSupplier, invoiceSupplier, completionSupplier])
      )
        continue;
      const bundleKey = [poVersion.id, invoiceVersion.id, completionVersion.id]
        .sort()
        .join(":");
      const existing = await transaction.companyEvidenceFact.findFirst({
        where: {
          factType: "COMPLETED_EXPERIENCE_ORDER_VALUE",
          invalidatedAt: null,
          organisationId,
          currentVersion: { scope: { contains: `Bundle key: ${bundleKey}` } },
        },
      });
      if (existing !== null) continue;
      const sourceCitations = [poVersion, invoiceVersion, completionVersion]
        .flatMap((item) => item.citations)
        .filter((citation) => citation.invalidatedAt === null);
      if (sourceCitations.length < 3) continue;
      const fact = await transaction.companyEvidenceFact.create({
        data: {
          createdByUserId: actorUserId,
          documentId: completion.documentId,
          factType: "COMPLETED_EXPERIENCE_ORDER_VALUE",
          organisationId,
        },
      });
      const factVersion = await transaction.companyEvidenceFactVersion.create({
        data: {
          confidence: Math.min(
            poVersion.confidence.toNumber(),
            invoiceVersion.confidence.toNumber(),
            completionVersion.confidence.toNumber(),
          ),
          createdByUserId: actorUserId,
          currency: "INR",
          documentVersionId: completionVersion.documentVersionId,
          evidenceFactId: fact.id,
          numberValue: poVersion.numberValue,
          scope: [
            `Bundle key: ${bundleKey}`,
            `PO number: ${reference}`,
            `Invoice number: ${invoiceVersion.textValue ?? "Not extracted"}`,
            `Customer: ${poCustomer ?? "Not extracted"}`,
            `Supplier: ${poSupplier ?? "Not extracted"}`,
            `Supply description: ${scopeValue(poVersion.scope, "Supply description") ?? "Not extracted"}`,
            `Completion: ${scopeValue(completionVersion.scope, "Performance") ?? "Not extracted"}`,
          ]
            .join("; ")
            .slice(0, 1_000),
          valueType: "NUMBER",
          versionNumber: 1,
        },
      });
      await transaction.companyEvidenceCitation.createMany({
        data: sourceCitations.map((citation) => ({
          boundedExcerpt: citation.boundedExcerpt,
          cellRange: citation.cellRange,
          createdByUserId: actorUserId,
          documentCategory: citation.documentCategory,
          documentChecksum: citation.documentChecksum,
          documentId: citation.documentId,
          documentName: citation.documentName,
          documentVersionId: citation.documentVersionId,
          evidenceFactVersionId: factVersion.id,
          locatorType: "AUTOMATED_RELATIONAL_MATCH",
          organisationId,
          pageNumber: citation.pageNumber,
          sectionLabel: citation.sectionLabel,
          sheetName: citation.sheetName,
        })),
      });
      await transaction.companyEvidenceFact.update({
        data: { currentVersionId: factVersion.id },
        where: { id: fact.id },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId,
          eventType: "COMPANY_EVIDENCE_FACT_CREATED",
          metadata: { extraction: "DETERMINISTIC_RELATIONAL_MATCH" },
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: fact.id,
          subjectType: "company_evidence_fact",
        },
      });
    }
  }

  private async reconcileGstAddressConflict(
    transaction: Prisma.TransactionClient,
    organisationId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<void> {
    const registrations = await transaction.companyEvidenceFact.findMany({
      include: {
        currentVersion: { include: { citations: true } },
        document: true,
      },
      orderBy: { createdAt: "asc" },
      where: {
        factType: "GST_REGISTRATION",
        invalidatedAt: null,
        organisationId,
      },
    });
    for (let leftIndex = 0; leftIndex < registrations.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < registrations.length;
        rightIndex += 1
      ) {
        const left = registrations[leftIndex];
        const right = registrations[rightIndex];
        const leftVersion = left?.currentVersion;
        const rightVersion = right?.currentVersion;
        if (
          left === undefined ||
          right === undefined ||
          leftVersion === null ||
          rightVersion === null ||
          leftVersion === undefined ||
          rightVersion === undefined ||
          leftVersion.textValue?.toUpperCase() !==
            rightVersion.textValue?.toUpperCase()
        )
          continue;
        const leftName = scopeValue(leftVersion.scope, "Legal name");
        const rightName = scopeValue(rightVersion.scope, "Legal name");
        const leftAddress = scopeValue(leftVersion.scope, "Principal address");
        const rightAddress = scopeValue(
          rightVersion.scope,
          "Principal address",
        );
        if (
          leftName === null ||
          rightName === null ||
          leftAddress === null ||
          rightAddress === null ||
          normalizeAddress(leftName) !== normalizeAddress(rightName) ||
          !addressesMateriallyDiffer(leftAddress, rightAddress)
        )
          continue;
        const conflictKey = [leftVersion.id, rightVersion.id].sort().join(":");
        const existing = await transaction.companyEvidenceFact.findFirst({
          where: {
            factType: "GST_ADDRESS_CONFLICT",
            invalidatedAt: null,
            organisationId,
            currentVersion: {
              scope: { contains: `Conflict key: ${conflictKey}` },
            },
          },
        });
        if (existing !== null) continue;
        const fact = await transaction.companyEvidenceFact.create({
          data: {
            createdByUserId: actorUserId,
            documentId: right.documentId,
            factType: "GST_ADDRESS_CONFLICT",
            organisationId,
          },
        });
        const factVersion = await transaction.companyEvidenceFactVersion.create(
          {
            data: {
              confidence: Math.min(
                leftVersion.confidence.toNumber(),
                rightVersion.confidence.toNumber(),
              ),
              createdByUserId: actorUserId,
              documentVersionId: rightVersion.documentVersionId,
              evidenceFactId: fact.id,
              reviewState: "HUMAN_REVIEW_REQUIRED",
              scope: [
                `Conflict key: ${conflictKey}`,
                `GSTIN: ${leftVersion.textValue ?? "Not extracted"}`,
                `Legal name: ${leftName}`,
                `Source document A: ${left.document.displayName}`,
                `Address A: ${leftAddress}`,
                `Source document B: ${right.document.displayName}`,
                `Address B: ${rightAddress}`,
              ]
                .join("; ")
                .slice(0, 1_000),
              textValue:
                "Address differs across submitted company documents. Review required.",
              valueType: "TEXT",
              versionNumber: 1,
            },
          },
        );
        const citations = [leftVersion, rightVersion]
          .flatMap((item) => item.citations)
          .filter((citation) => citation.invalidatedAt === null);
        await transaction.companyEvidenceCitation.createMany({
          data: citations.map((citation) => ({
            boundedExcerpt: citation.boundedExcerpt,
            cellRange: citation.cellRange,
            createdByUserId: actorUserId,
            documentCategory: citation.documentCategory,
            documentChecksum: citation.documentChecksum,
            documentId: citation.documentId,
            documentName: citation.documentName,
            documentVersionId: citation.documentVersionId,
            evidenceFactVersionId: factVersion.id,
            locatorType: "AUTOMATED_CONFLICT_COMPARISON",
            organisationId,
            pageNumber: citation.pageNumber,
            sectionLabel: citation.sectionLabel,
            sheetName: citation.sheetName,
          })),
        });
        await transaction.companyEvidenceFact.update({
          data: { currentVersionId: factVersion.id },
          where: { id: fact.id },
        });
        await transaction.document.updateMany({
          data: { verificationStatus: "HUMAN_REVIEW_REQUIRED" },
          where: {
            id: { in: [left.documentId, right.documentId] },
            organisationId,
          },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId,
            eventType: "COMPANY_EVIDENCE_FACT_CREATED",
            metadata: { finding: "GST_ADDRESS_CONFLICT" },
            organisationId,
            outcome: "SUCCESS",
            requestId,
            subjectId: fact.id,
            subjectType: "company_evidence_fact",
          },
        });
      }
    }
  }

  private async reject(
    documentId: string,
    versionId: string,
    detectedMimeType: string | undefined,
    failureCode: string,
  ): Promise<void> {
    await this.database.$transaction([
      this.database.documentVersion.update({
        data: { detectedMimeType: detectedMimeType ?? null },
        where: { id: versionId },
      }),
      this.database.documentExtraction.upsert({
        create: {
          documentVersionId: versionId,
          failureCode,
          status: "REJECTED",
        },
        update: { failureCode, status: "REJECTED" },
        where: { documentVersionId: versionId },
      }),
      this.database.document.update({
        data: { status: "REJECTED" },
        where: { id: documentId },
      }),
    ]);
    const document = await this.database.document.findUnique({
      select: { organisationId: true },
      where: { id: documentId },
    });
    if (document !== null)
      await this.invalidateAssessments(document.organisationId);
  }

  private async deleteDocument(data: DocumentJob): Promise<void> {
    const document = await this.database.document.findFirst({
      include: { versions: true },
      where: {
        deletionRequestedAt: { not: null },
        deletedAt: null,
        id: data.documentVersionId,
        organisationId: data.organisationId,
      },
    });
    if (document === null) return;
    if (
      document.retentionUntil !== null &&
      document.retentionUntil > new Date()
    )
      throw new Error("Document is under retention");
    for (const version of document.versions) {
      for (const key of [
        version.quarantineObjectKey,
        version.approvedObjectKey,
      ]) {
        if (key !== null)
          await this.storage.send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
          );
      }
    }
    await this.database.document.update({
      data: { deletedAt: new Date() },
      where: { id: document.id },
    });
    await this.invalidateAssessments(data.organisationId);
  }

  private async invalidateAssessments(organisationId: string): Promise<void> {
    const invalidatedAt = new Date();
    await this.database.$transaction([
      this.database.eligibilityAssessmentRun.updateMany({
        data: {
          currentStage: "INVALIDATED",
          invalidatedAt,
          publicMessage: "Company document evidence changed",
          status: "INVALIDATED",
        },
        where: {
          organisationId,
          status: {
            in: [
              "QUEUED",
              "SNAPSHOTTING",
              "MATCHING",
              "VALIDATING",
              "COMPLETE",
            ],
          },
        },
      }),
      this.database.eligibilityAssessment.updateMany({
        data: { invalidatedAt },
        where: { invalidatedAt: null, organisationId },
      }),
      this.database.tenderVersion.updateMany({
        data: { activeEligibilityAssessmentRunId: null },
        where: { activeEligibilityAssessmentRun: { organisationId } },
      }),
      this.database.checklistGenerationRun.updateMany({
        data: {
          activatedAt: null,
          currentStage: "INVALIDATED",
          invalidatedAt,
          publicMessage: "Authoritative company document evidence changed",
          status: "INVALIDATED",
        },
        where: { invalidatedAt: null, organisationId },
      }),
      this.database.checklistItem.updateMany({
        data: { invalidatedAt, status: "INVALIDATED" },
        where: { invalidatedAt: null, organisationId },
      }),
    ]);
  }
}

function isMissingObjectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    readonly $metadata?: { readonly httpStatusCode?: number };
    readonly Code?: string;
    readonly code?: string;
    readonly name?: string;
  };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.code === "NoSuchKey" ||
    candidate.code === "NotFound" ||
    candidate.Code === "NoSuchKey" ||
    candidate.Code === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function sameIdentity(values: readonly (string | null)[]): boolean {
  const normalized = values
    .filter((value): value is string => value !== null)
    .map((value) => normalizeAddress(value));
  return normalized.length === values.length && new Set(normalized).size === 1;
}
