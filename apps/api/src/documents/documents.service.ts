import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  CompleteUploadRequest,
  CreateUploadSessionRequest,
} from "@tender/contracts";
import type { ApiEnvironment } from "@tender/config";
import type { PrismaClient } from "@tender/database";
import {
  canDownloadDocument,
  extensionFor,
  isAllowedMimeExtension,
  MAX_DOCUMENTS_PER_ORGANISATION,
} from "@tender/domain";
import type { Queue } from "bullmq";
import { randomUUID } from "node:crypto";

import {
  API_ENVIRONMENT,
  JOB_QUEUE,
  PRISMA_CLIENT,
  S3_CLIENT,
} from "../infrastructure.tokens.js";

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(S3_CLIENT) private readonly storage: S3Client,
    @Inject(JOB_QUEUE) private readonly jobs: Queue,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  public list(
    organisationId: string,
    filter: {
      category?: string | undefined;
      expiring_before?: string | undefined;
      status?: string | undefined;
    },
  ): Promise<unknown> {
    return this.database.document.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        category: true,
        displayName: true,
        expiryDate: true,
        id: true,
        status: true,
        updatedAt: true,
        verificationStatus: true,
      },
      where: {
        deletedAt: null,
        organisationId,
        ...(filter.category === undefined
          ? {}
          : { category: filter.category as never }),
        ...(filter.status === undefined
          ? {}
          : { status: filter.status as never }),
        ...(filter.expiring_before === undefined
          ? {}
          : {
              expiryDate: { lte: new Date(filter.expiring_before) },
            }),
      },
    });
  }

  public async details(
    organisationId: string,
    documentId: string,
  ): Promise<unknown> {
    const document = await this.database.document.findFirst({
      include: {
        verifications: { orderBy: { createdAt: "desc" } },
        versions: {
          orderBy: { versionNumber: "desc" },
          select: {
            createdAt: true,
            detectedMimeType: true,
            id: true,
            originalFilename: true,
            sizeBytes: true,
            versionNumber: true,
          },
        },
      },
      where: { deletedAt: null, id: documentId, organisationId },
    });
    if (document === null) throw new NotFoundException();
    return {
      ...document,
      versions: document.versions.map((version) => ({
        ...version,
        sizeBytes: version.sizeBytes.toString(),
      })),
    };
  }

  public async createUploadSession(
    organisationId: string,
    userId: string,
    input: CreateUploadSessionRequest,
    requestId: string,
  ): Promise<unknown> {
    const extension = extensionFor(input.filename);
    if (!isAllowedMimeExtension(input.mime_type, extension))
      throw new BadRequestException("File type is not allowed");
    const count = await this.database.document.count({
      where: { deletedAt: null, organisationId },
    });
    if (count >= MAX_DOCUMENTS_PER_ORGANISATION)
      throw new ConflictException("Document limit reached");
    const duplicate = await this.database.documentVersion.findFirst({
      where: {
        document: { deletedAt: null, organisationId },
        sha256: input.checksum_sha256,
      },
    });
    if (duplicate !== null) throw new ConflictException("Duplicate document");
    if (input.document_id !== undefined) {
      const existing = await this.database.document.findFirst({
        where: { deletedAt: null, id: input.document_id, organisationId },
      });
      if (existing === null) throw new NotFoundException();
    }

    const ids = {
      document: input.document_id ?? randomUUID(),
      version: randomUUID(),
    };
    const key = `quarantine/${organisationId}/${ids.version}`;
    const expiresAt = new Date(
      Date.now() + this.environment.DOCUMENT_UPLOAD_TTL_SECONDS * 1000,
    );
    const created = await this.database.$transaction(async (tx) => {
      const document =
        input.document_id === undefined
          ? await tx.document.create({
              data: {
                category: input.category,
                displayName: input.filename,
                expiryDate:
                  input.expiry_date === undefined
                    ? null
                    : new Date(input.expiry_date),
                id: ids.document,
                organisationId,
                ownerUserId: userId,
              },
            })
          : await tx.document.findUniqueOrThrow({
              where: { id: ids.document },
            });
      const versionNumber =
        (await tx.documentVersion.count({
          where: { documentId: document.id },
        })) + 1;
      const version = await tx.documentVersion.create({
        data: {
          declaredMimeType: input.mime_type,
          documentId: document.id,
          extension,
          id: ids.version,
          originalFilename: input.filename,
          quarantineObjectKey: key,
          sha256: input.checksum_sha256,
          sizeBytes: BigInt(input.size_bytes),
          uploadedByUserId: userId,
          versionNumber,
        },
      });
      const session = await tx.uploadSession.create({
        data: {
          documentVersionId: version.id,
          expiresAt,
          organisationId,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "DOCUMENT_UPLOAD_REQUESTED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: document.id,
          subjectType: "document",
          metadata: { category: input.category, size_bytes: input.size_bytes },
        },
      });
      return { document, session, version };
    });
    const uploadUrl = await getSignedUrl(
      this.storage,
      new PutObjectCommand({
        Bucket: this.environment.S3_BUCKET,
        ContentLength: input.size_bytes,
        ContentType: input.mime_type,
        Key: key,
        Metadata: { sha256: input.checksum_sha256 },
      }),
      { expiresIn: this.environment.DOCUMENT_UPLOAD_TTL_SECONDS },
    );
    return {
      document_id: created.document.id,
      expires_at: expiresAt,
      upload_session_id: created.session.id,
      upload_url: uploadUrl,
      version_id: created.version.id,
    };
  }

  public async completeUpload(
    organisationId: string,
    uploadSessionId: string,
    userId: string,
    input: CompleteUploadRequest,
    requestId: string,
  ): Promise<unknown> {
    const session = await this.database.uploadSession.findFirst({
      include: { documentVersion: { include: { document: true } } },
      where: { id: uploadSessionId, organisationId, status: "PENDING" },
    });
    if (session === null || session.expiresAt <= new Date())
      throw new NotFoundException();
    if (session.documentVersion.sha256 !== input.checksum_sha256)
      throw new BadRequestException("Upload checksum does not match");
    let object;
    try {
      object = await this.storage.send(
        new HeadObjectCommand({
          Bucket: this.environment.S3_BUCKET,
          Key: session.documentVersion.quarantineObjectKey,
        }),
      );
    } catch {
      throw new BadRequestException("Upload is not available");
    }
    if (
      object.ContentLength !== Number(session.documentVersion.sizeBytes) ||
      object.ContentType !== session.documentVersion.declaredMimeType ||
      object.Metadata?.sha256 !== session.documentVersion.sha256
    )
      throw new BadRequestException("Uploaded object metadata does not match");
    await this.database.$transaction([
      this.database.uploadSession.update({
        data: { completedAt: new Date(), status: "COMPLETED" },
        where: { id: session.id },
      }),
      this.database.document.update({
        data: { status: "UPLOADED" },
        where: { id: session.documentVersion.documentId },
      }),
      this.database.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "DOCUMENT_UPLOAD_COMPLETED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: session.documentVersion.documentId,
          subjectType: "document",
        },
      }),
    ]);
    await this.jobs.add(
      "process-company-document",
      {
        documentVersionId: session.documentVersion.id,
        organisationId,
        requestId,
      },
      { attempts: 3, jobId: session.documentVersion.id, removeOnComplete: 100 },
    );
    return {
      document_id: session.documentVersion.documentId,
      status: "UPLOADED",
    };
  }

  public async abandonUploadSession(
    organisationId: string,
    uploadSessionId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const session = await this.database.uploadSession.findFirst({
      include: {
        documentVersion: {
          include: {
            document: {
              select: {
                currentVersionId: true,
                id: true,
              },
            },
          },
        },
      },
      where: { id: uploadSessionId, organisationId },
    });
    if (session === null) throw new NotFoundException();
    if (session.status !== "PENDING" || session.completedAt !== null)
      throw new ConflictException(
        "Only an incomplete upload session can be abandoned safely.",
      );

    const versionCount = await this.database.documentVersion.count({
      where: { documentId: session.documentVersion.documentId },
    });

    await this.database.$transaction(async (tx) => {
      await tx.uploadSession.delete({ where: { id: session.id } });
      await tx.documentVersion.delete({
        where: { id: session.documentVersionId },
      });
      if (
        versionCount === 1 &&
        session.documentVersion.document.currentVersionId === null
      ) {
        await tx.document.delete({
          where: { id: session.documentVersion.documentId },
        });
      }
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "DOCUMENT_UPLOAD_ABANDONED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: session.documentVersion.documentId,
          subjectType: "document",
          metadata: {
            document_version_id: session.documentVersionId,
            upload_session_id: session.id,
          },
        },
      });
    });

    await this.cleanupAbandonedUploadObject({
      documentVersionId: session.documentVersionId,
      key: session.documentVersion.quarantineObjectKey,
      organisationId,
      requestId,
    });
    return { removed: true };
  }

  public async download(
    organisationId: string,
    documentId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const document = await this.database.document.findFirst({
      include: { currentVersion: true },
      where: { deletedAt: null, id: documentId, organisationId },
    });
    const allowed =
      document !== null &&
      document.currentVersion !== null &&
      canDownloadDocument(document.status) &&
      document.currentVersion.approvedObjectKey !== null;
    await this.database.documentAccessEvent
      .create({
        data: {
          action: "DOWNLOAD_URL_REQUESTED",
          documentId,
          organisationId,
          outcome: allowed ? "SUCCESS" : "DENIED",
          requestId,
          userId,
        },
      })
      .catch(() => undefined);
    if (!allowed || document?.currentVersion?.approvedObjectKey == null)
      throw new NotFoundException();
    const currentVersion = document.currentVersion;
    const approvedObjectKey = currentVersion.approvedObjectKey;
    if (approvedObjectKey === null) throw new NotFoundException();
    const downloadUrl = await getSignedUrl(
      this.storage,
      new GetObjectCommand({
        Bucket: this.environment.S3_BUCKET,
        Key: approvedObjectKey,
        ResponseContentDisposition: `attachment; filename="document-${document.id}${currentVersion.extension}"`,
      }),
      { expiresIn: this.environment.DOCUMENT_DOWNLOAD_TTL_SECONDS },
    );
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "DOCUMENT_DOWNLOADED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: document.id,
        subjectType: "document",
      },
    });
    return {
      download_url: downloadUrl,
      expires_in_seconds: this.environment.DOCUMENT_DOWNLOAD_TTL_SECONDS,
    };
  }

  public async requestDeletion(
    organisationId: string,
    documentId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const result = await this.database.document.updateMany({
      data: { deletionRequestedAt: new Date() },
      where: { deletedAt: null, id: documentId, organisationId },
    });
    if (result.count !== 1) throw new NotFoundException();
    const invalidatedAt = new Date();
    await this.database.$transaction([
      this.database.eligibilityAssessmentRun.updateMany({
        data: {
          currentStage: "INVALIDATED",
          invalidatedAt,
          publicMessage: "Company document deletion was requested",
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
    ]);
    await this.jobs.add(
      "delete-company-document",
      {
        documentVersionId: documentId,
        organisationId,
        requestId,
      },
      {
        jobId: `delete-${documentId}`,
        removeOnComplete: 100,
      },
    );
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "DOCUMENT_DELETED",
        organisationId,
        outcome: "REQUESTED",
        requestId,
        subjectId: documentId,
        subjectType: "document",
      },
    });
    return { status: "DELETION_REQUESTED" };
  }

  private async cleanupAbandonedUploadObject(input: {
    readonly documentVersionId: string;
    readonly key: string;
    readonly organisationId: string;
    readonly requestId: string;
  }): Promise<void> {
    try {
      await this.deleteDocumentObjectsNow([input.key]);
      return;
    } catch (error: unknown) {
      try {
        await this.jobs.add(
          "cleanup-company-upload-storage",
          {
            documentVersionId: input.documentVersionId,
            keys: [input.key],
            organisationId: input.organisationId,
            requestId: input.requestId,
          },
          {
            attempts: 10,
            backoff: { delay: 1_000, type: "exponential" },
            jobId: `cleanup-company-upload-${input.documentVersionId}`,
            removeOnComplete: 100,
          },
        );
      } catch (queueError: unknown) {
        this.logger.error(
          {
            documentVersionId: input.documentVersionId,
            key: input.key,
            organisationId: input.organisationId,
            queueError:
              queueError instanceof Error
                ? queueError.message
                : String(queueError),
            storageError:
              error instanceof Error ? error.message : String(error),
          },
          "Company upload cleanup could not be queued after an immediate cleanup failure",
        );
      }
    }
  }

  private async deleteDocumentObjectsNow(
    keys: readonly string[],
  ): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.send(
          new DeleteObjectCommand({
            Bucket: this.environment.S3_BUCKET,
            Key: key,
          }),
        );
      } catch (error: unknown) {
        if (!isMissingObjectError(error)) throw error;
      }
    }
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
