import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@tender/database";
import { isAllowedMimeExtension, MAX_UPLOAD_BYTES } from "@tender/domain";
import { fileTypeFromBuffer } from "file-type";
import { createHash } from "node:crypto";
import type { MalwareScanner } from "./malware-scanner.js";

export interface DocumentJob {
  readonly documentVersionId: string;
  readonly organisationId: string;
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
    await this.database.$transaction([
      this.database.documentVersion.update({
        data: {
          approvedObjectKey: approvedKey,
          detectedMimeType: detected.mime,
        },
        where: { id: version.id },
      }),
      this.database.documentExtraction.upsert({
        create: {
          completedAt: new Date(),
          documentVersionId: version.id,
          metadata: {
            detected_mime_type: detected.mime,
            size_bytes: content.byteLength,
          },
          startedAt: new Date(),
          status: "READY",
        },
        update: {
          completedAt: new Date(),
          metadata: {
            detected_mime_type: detected.mime,
            size_bytes: content.byteLength,
          },
          status: "READY",
        },
        where: { documentVersionId: version.id },
      }),
      this.database.document.update({
        data: { currentVersionId: version.id, status: "READY" },
        where: { id: version.documentId },
      }),
    ]);
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
  }
}
