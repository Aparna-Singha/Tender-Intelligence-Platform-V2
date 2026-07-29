import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@tender/database";
import {
  isAllowedMimeExtension,
  validateZipEntries,
  type ZipEntry,
} from "@tender/domain";
import { fileTypeFromBuffer } from "file-type";
import { createHash, randomUUID } from "node:crypto";
import type { MalwareScanner } from "./malware-scanner.js";

const MAX_TENDER_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface TenderDocumentJob {
  readonly documentId: string;
  readonly jobId: string;
  readonly organisationId: string;
  readonly requestId: string;
}

export class TenderProcessor {
  public constructor(
    private readonly database: PrismaClient,
    private readonly storage: S3Client,
    private readonly bucket: string,
    private readonly scanner: MalwareScanner,
  ) {}

  public async process(
    data: TenderDocumentJob,
    signal?: AbortSignal,
  ): Promise<void> {
    const job = await this.database.processingJob.findFirst({
      where: { id: data.jobId, organisationId: data.organisationId },
    });
    if (job === null || job.state === "CANCELLED") return;
    const document = await this.database.tenderDocument.findFirst({
      include: { tenderVersion: true },
      where: { id: data.documentId, organisationId: data.organisationId },
    });
    if (document === null) throw new Error("Tender source document not found");
    await this.stage(data.jobId, "SCANNING", 25, "Security scan in progress");
    await this.database.tenderDocument.update({
      data: { status: "SCANNING" },
      where: { id: document.id },
    });
    try {
      const object = await this.storage.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: document.quarantineObjectKey,
        }),
      );
      if (
        object.Body === undefined ||
        object.ContentLength !== Number(document.sizeBytes) ||
        object.ContentLength > MAX_TENDER_UPLOAD_BYTES
      )
        return this.reject(data, "BOUNDED_SIZE_CHECK_FAILED", null);
      const content = await object.Body.transformToByteArray();
      signal?.throwIfAborted();
      const checksum = createHash("sha256").update(content).digest("hex");
      const detected = await fileTypeFromBuffer(content);
      const detectedMime =
        detected?.mime ?? detectCsv(content, document.extension);
      if (
        checksum !== document.sha256 ||
        content.byteLength !== Number(document.sizeBytes) ||
        detectedMime === null ||
        !isTenderMimeAllowed(detectedMime, document.extension) ||
        detectedMime !== document.declaredMimeType
      )
        return this.reject(data, "FILE_TYPE_MISMATCH", detectedMime);
      if (document.extension === ".zip")
        validateZipEntries(readZipDirectory(content));
      signal?.throwIfAborted();
      const scan = await this.scanner.scan(content);
      if (scan.status === "INFECTED")
        return this.reject(data, "MALWARE_DETECTED", detectedMime);
      if (scan.status === "ERROR") {
        await this.database.tenderDocument.update({
          data: { status: "QUARANTINED" },
          where: { id: document.id },
        });
        throw new Error("Malware scanner unavailable");
      }
      signal?.throwIfAborted();
      if (await this.isCancelled(data.jobId)) return;
      await this.stage(data.jobId, "PROCESSING", 75, "Securing tender source");
      const approvedKey = `tender-approved/${data.organisationId}/${document.id}`;
      await this.storage.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${document.quarantineObjectKey}`,
          Key: approvedKey,
          MetadataDirective: "COPY",
        }),
      );
      signal?.throwIfAborted();
      if (await this.isCancelled(data.jobId)) {
        await this.storage.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: approvedKey }),
        );
        return;
      }
      await this.storage.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: document.quarantineObjectKey,
        }),
      );
      await this.database.$transaction([
        this.database.tenderDocument.update({
          data: {
            approvedObjectKey: approvedKey,
            detectedMimeType: detectedMime,
            status: "READY",
          },
          where: { id: document.id },
        }),
        this.database.processingJob.update({
          data: {
            completedAt: new Date(),
            currentStage: "COMPLETE",
            eventSequence: { increment: 1 },
            progressPercentage: 100,
            publicMessage: "Tender source is ready",
            state: "COMPLETE",
          },
          where: { id: data.jobId },
        }),
        this.database.tender.update({
          data: { lifecycleStatus: "SOURCE_READY" },
          where: { id: document.tenderVersion.tenderId },
        }),
        this.database.tenderWorkspace.update({
          data: {
            processingProgress: 100,
            sourceSectionStatus: "READY",
            status: "SOURCE_READY",
          },
          where: { tenderId: document.tenderVersion.tenderId },
        }),
      ]);
    } catch (error: unknown) {
      if (signal?.aborted === true)
        await this.fail(
          data,
          "JOB_TIMEOUT",
          "Tender source processing timed out",
        );
      else
        await this.fail(
          data,
          "PROCESSING_ERROR",
          "Tender source processing failed",
        );
      throw error;
    }
  }

  private async stage(
    jobId: string,
    stage: string,
    progress: number,
    message: string,
  ): Promise<void> {
    await this.database.processingJob.update({
      data: {
        currentStage: stage,
        eventSequence: { increment: 1 },
        progressPercentage: progress,
        publicMessage: message,
        startedAt: new Date(),
        state: stage === "SCANNING" ? "SCANNING" : "PARSING",
      },
      where: { id: jobId },
    });
  }

  private async isCancelled(jobId: string): Promise<boolean> {
    const job = await this.database.processingJob.findUnique({
      select: { cancellationRequestedAt: true, state: true },
      where: { id: jobId },
    });
    return job?.state === "CANCELLED" || job?.cancellationRequestedAt !== null;
  }

  private async reject(
    data: TenderDocumentJob,
    category: string,
    detectedMimeType: string | null,
  ): Promise<void> {
    const document = await this.database.tenderDocument.findUnique({
      include: { tenderVersion: true },
      where: { id: data.documentId },
    });
    if (document === null) return;
    await this.database.$transaction([
      this.database.tenderDocument.update({
        data: { detectedMimeType, status: "REJECTED" },
        where: { id: data.documentId },
      }),
      this.database.processingJob.update({
        data: {
          completedAt: new Date(),
          currentStage: "FAILED",
          eventSequence: { increment: 1 },
          failureCategory: category,
          internalErrorReference: randomUUID(),
          publicMessage: "Tender source failed security validation",
          state: "FAILED",
        },
        where: { id: data.jobId },
      }),
      this.database.tender.update({
        data: { lifecycleStatus: "FAILED" },
        where: { id: document.tenderVersion.tenderId },
      }),
      this.database.tenderWorkspace.update({
        data: {
          sourceSectionStatus: "FAILED",
          status: "FAILED",
        },
        where: { tenderId: document.tenderVersion.tenderId },
      }),
    ]);
  }

  private async fail(
    data: TenderDocumentJob,
    category: string,
    message: string,
  ): Promise<void> {
    await this.database.$transaction([
      this.database.tenderDocument.updateMany({
        data: { status: "FAILED" },
        where: {
          id: data.documentId,
          status: { in: ["UPLOADED", "SCANNING"] },
        },
      }),
      this.database.processingJob.updateMany({
        data: {
          currentStage: "FAILED",
          eventSequence: { increment: 1 },
          failureCategory: category,
          internalErrorReference: randomUUID(),
          publicMessage: message,
          state: "FAILED",
        },
        where: { id: data.jobId, state: { not: "CANCELLED" } },
      }),
    ]);
  }
}

function detectCsv(content: Uint8Array, extension: string): string | null {
  if (
    extension !== ".csv" ||
    content.includes(0) ||
    new TextDecoder("utf-8", { fatal: true }).decode(content).length === 0
  )
    return null;
  return "text/csv";
}

function isTenderMimeAllowed(mime: string, extension: string): boolean {
  return (
    isAllowedMimeExtension(mime, extension) ||
    (mime === "application/zip" && extension === ".zip") ||
    (mime === "text/csv" && extension === ".csv")
  );
}

export function readZipDirectory(content: Uint8Array): readonly ZipEntry[] {
  const view = new DataView(
    content.buffer,
    content.byteOffset,
    content.byteLength,
  );
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let offset = 0; offset + 46 <= content.length;) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > content.length) throw new Error("ZIP_DIRECTORY_TRUNCATED");
    const name = decoder.decode(
      content.subarray(offset + 46, offset + 46 + nameLength),
    );
    entries.push({ compressedSize, name, uncompressedSize });
    offset = end;
  }
  if (entries.length === 0) throw new Error("ZIP_DIRECTORY_MISSING");
  return entries;
}
