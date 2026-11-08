import {
  BadRequestException,
  ConflictException,
  HttpStatus,
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
import { Prisma, type PrismaClient } from "@tender/database";
import {
  canDownloadDocument,
  extensionFor,
  isAllowedMimeExtension,
  MAX_DOCUMENTS_PER_ORGANISATION,
} from "@tender/domain";
import type { Queue } from "bullmq";
import { createHash, randomUUID } from "node:crypto";

import {
  API_ENVIRONMENT,
  JOB_QUEUE,
  PRISMA_CLIENT,
  S3_CLIENT,
} from "../infrastructure.tokens.js";
import { DocumentUploadError } from "./document-upload.error.js";
import {
  assertCurrentRequirement,
  type RequirementScope,
} from "../eligibility/requirement-evidence-scope.js";

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
        tenderScopeId: null,
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
      where: {
        deletedAt: null,
        id: documentId,
        organisationId,
        tenderScopeId: null,
      },
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
    scope?: RequirementScope & { readonly idempotencyKey: string },
  ): Promise<unknown> {
    if (
      scope &&
      (scope.organisationId !== organisationId ||
        input.document_id !== undefined)
    )
      throw new BadRequestException("Invalid requirement upload scope");
    const fingerprint = scope
      ? createHash("sha256")
          .update(JSON.stringify({ userId, scope, input }))
          .digest("hex")
      : null;
    if (scope && fingerprint) {
      await this.database.$transaction((tx) =>
        assertCurrentRequirement(tx, scope),
      );
      const existing =
        await this.database.requirementEvidenceAttachment.findFirst({
          include: { documentVersion: { include: { uploadSession: true } } },
          where: {
            idempotencyKey: scope.idempotencyKey,
            organisationId,
            tenderId: scope.tenderId,
          },
        });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint || existing.detachedAt)
          throw new ConflictException("Idempotency key was already used");
        const session = existing.documentVersion.uploadSession;
        const uploadUrl =
          session?.status === "PENDING" && session.expiresAt > new Date()
            ? await this.signUpload(
                existing.documentVersion.quarantineObjectKey,
                Number(existing.documentVersion.sizeBytes),
                existing.documentVersion.declaredMimeType,
                existing.documentVersion.sha256,
              )
            : null;
        return {
          attachment_id: existing.id,
          document_id: existing.documentId,
          version_id: existing.documentVersionId,
          upload_session_id: session?.id ?? null,
          expires_at: session?.expiresAt ?? null,
          upload_url: uploadUrl,
          upload_status: session?.status ?? null,
        };
      }
    }
    const extension = extensionFor(input.filename);
    if (!isAllowedMimeExtension(input.mime_type, extension))
      throw new BadRequestException("File type is not allowed");
    const count = await this.database.document.count({
      where: { deletedAt: null, organisationId },
    });
    if (count >= MAX_DOCUMENTS_PER_ORGANISATION)
      throw new DocumentUploadError(
        "DOCUMENT_LIMIT_REACHED",
        "The organisation document limit has been reached.",
        HttpStatus.CONFLICT,
      );
    const duplicate = await this.database.documentVersion.findFirst({
      where: {
        document: {
          deletedAt: null,
          organisationId,
          OR: scope
            ? [{ tenderScopeId: null }, { tenderScopeId: scope.tenderId }]
            : [{ tenderScopeId: null }],
        },
        sha256: input.checksum_sha256,
      },
    });
    if (duplicate !== null)
      throw new DocumentUploadError(
        "DOCUMENT_DUPLICATE",
        "This exact document has already been uploaded.",
        HttpStatus.CONFLICT,
      );
    if (input.document_id !== undefined) {
      const existing = await this.database.document.findFirst({
        where: {
          deletedAt: null,
          id: input.document_id,
          organisationId,
          tenderScopeId: null,
        },
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
    // Signing has no database side effect. Fail before creating upload records.
    const uploadUrl = await this.signUpload(
      key,
      input.size_bytes,
      input.mime_type,
      input.checksum_sha256,
    );
    const created = await this.database
      .$transaction(async (tx) => {
        const extractionRunId = scope
          ? await assertCurrentRequirement(tx, scope)
          : null;
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
                  ...(scope ? { tenderScopeId: scope.tenderId } : {}),
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
        const attachment =
          scope && fingerprint && extractionRunId
            ? await tx.requirementEvidenceAttachment.create({
                data: {
                  attachedByUserId: userId,
                  documentId: document.id,
                  documentVersionId: version.id,
                  extractionRunId,
                  idempotencyKey: scope.idempotencyKey,
                  organisationId,
                  requestFingerprint: fingerprint,
                  structuredRequirementId: scope.requirementId,
                  tenderId: scope.tenderId,
                  tenderVersionId: scope.tenderVersionId,
                },
              })
            : null;
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            eventType: "DOCUMENT_UPLOAD_REQUESTED",
            organisationId,
            outcome: "SUCCESS",
            requestId,
            subjectId: document.id,
            subjectType: "document",
            metadata: {
              category: input.category,
              size_bytes: input.size_bytes,
            },
          },
        });
        return { attachment, document, session, version };
      })
      .catch(async (error: unknown) => {
        if (
          scope &&
          fingerprint &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const winner =
            await this.database.requirementEvidenceAttachment.findFirst({
              select: { id: true, requestFingerprint: true },
              where: {
                idempotencyKey: scope.idempotencyKey,
                organisationId,
                tenderId: scope.tenderId,
              },
            });
          if (winner?.requestFingerprint === fingerprint) return null;
          throw new ConflictException(
            "An active attachment or idempotency key already exists",
          );
        }
        throw error;
      });
    if (created === null)
      return this.createUploadSession(
        organisationId,
        userId,
        input,
        requestId,
        scope,
      );
    return {
      document_id: created.document.id,
      expires_at: expiresAt,
      upload_session_id: created.session.id,
      upload_url: uploadUrl,
      version_id: created.version.id,
      ...(created.attachment
        ? { attachment_id: created.attachment.id, upload_status: "PENDING" }
        : {}),
    };
  }

  private signUpload(
    key: string,
    sizeBytes: number,
    mimeType: string,
    sha256: string,
  ): Promise<string> {
    return getSignedUrl(
      this.storage,
      new PutObjectCommand({
        Bucket: this.environment.S3_BUCKET,
        ContentLength: sizeBytes,
        ContentType: mimeType,
        Key: key,
        Metadata: { sha256 },
      }),
      {
        expiresIn: this.environment.DOCUMENT_UPLOAD_TTL_SECONDS,
        unhoistableHeaders: new Set(["x-amz-meta-sha256"]),
      },
    );
  }

  public async completeUpload(
    organisationId: string,
    uploadSessionId: string,
    userId: string,
    input: CompleteUploadRequest,
    requestId: string,
    scope?: RequirementScope,
  ): Promise<unknown> {
    const session = await this.database.uploadSession.findFirst({
      include: {
        documentVersion: { include: { document: true, extraction: true } },
      },
      where: {
        id: uploadSessionId,
        organisationId,
        status: { in: ["PENDING", "COMPLETED"] },
      },
    });
    if (
      session === null ||
      (session.status === "PENDING" && session.expiresAt <= new Date())
    )
      throw new NotFoundException();
    if (
      (scope &&
        session.documentVersion.document?.tenderScopeId !== scope.tenderId) ||
      (!scope && session.documentVersion.document?.tenderScopeId != null)
    )
      throw new NotFoundException();
    if (session.documentVersion.sha256 !== input.checksum_sha256)
      throw new BadRequestException("Upload checksum does not match");
    const newerApprovedVersion = await this.database.documentVersion.findFirst({
      select: { id: true },
      where: {
        approvedObjectKey: { not: null },
        documentId: session.documentVersion.documentId,
        versionNumber: { gt: session.documentVersion.versionNumber },
      },
    });
    if (newerApprovedVersion)
      throw new ConflictException("A newer document version is ready");
    if (session.status === "COMPLETED") {
      if (scope) {
        await this.database.$transaction(async (tx) => {
          await assertCurrentRequirement(tx, scope);
          const attachment = await tx.requirementEvidenceAttachment.findFirst({
            select: { id: true },
            where: {
              detachedAt: null,
              documentVersionId: session.documentVersionId,
              organisationId,
              structuredRequirementId: scope.requirementId,
              tenderId: scope.tenderId,
              tenderVersionId: scope.tenderVersionId,
            },
          });
          if (!attachment) throw new NotFoundException();
        });
      }
      const status = session.documentVersion.document.status;
      if (!session.documentVersion.approvedObjectKey) {
        if (
          ["REJECTED", "FAILED"].includes(
            session.documentVersion.extraction?.status ?? "",
          )
        )
          throw new ConflictException(
            "Document scan has reached a terminal state",
          );
        await this.enqueueDocumentScan(
          session.documentVersion.id,
          organisationId,
          requestId,
        );
        return {
          document_id: session.documentVersion.documentId,
          status: "UPLOADED",
        };
      }
      return { document_id: session.documentVersion.documentId, status };
    }
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
    await this.database.$transaction(async (tx) => {
      if (scope) {
        await assertCurrentRequirement(tx, scope);
        const activeAttachment =
          await tx.requirementEvidenceAttachment.findFirst({
            select: { id: true },
            where: {
              detachedAt: null,
              documentVersionId: session.documentVersionId,
              organisationId,
              structuredRequirementId: scope.requirementId,
              tenderId: scope.tenderId,
              tenderVersionId: scope.tenderVersionId,
            },
          });
        if (!activeAttachment) throw new NotFoundException();
      }
      const claimed = await tx.uploadSession.updateMany({
        data: { completedAt: new Date(), status: "COMPLETED" },
        where: {
          id: session.id,
          organisationId,
          status: "PENDING",
          expiresAt: { gt: new Date() },
          completedAt: null,
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException("Upload is no longer pending");
      await tx.document.update({
        data: { status: "UPLOADED" },
        where: { id: session.documentVersion.documentId },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "DOCUMENT_UPLOAD_COMPLETED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: session.documentVersion.documentId,
          subjectType: "document",
        },
      });
    });
    await this.enqueueDocumentScan(
      session.documentVersion.id,
      organisationId,
      requestId,
    );
    return {
      document_id: session.documentVersion.documentId,
      status: "UPLOADED",
    };
  }

  private async enqueueDocumentScan(
    documentVersionId: string,
    organisationId: string,
    requestId: string,
  ): Promise<void> {
    await this.jobs.add(
      "process-company-document",
      { documentVersionId, organisationId, requestId },
      { attempts: 3, jobId: documentVersionId, removeOnComplete: 100 },
    );
  }

  public async abandonUploadSession(
    organisationId: string,
    uploadSessionId: string,
    userId: string,
    requestId: string,
    scope?: RequirementScope,
  ): Promise<unknown> {
    const session = await this.database.uploadSession.findFirst({
      include: {
        documentVersion: {
          include: {
            document: {
              select: {
                currentVersionId: true,
                id: true,
                tenderScopeId: true,
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
    if (
      (scope &&
        session.documentVersion.document?.tenderScopeId !== scope.tenderId) ||
      (!scope && session.documentVersion.document?.tenderScopeId != null)
    )
      throw new NotFoundException();

    const retained = await this.database.$transaction(async (tx) => {
      const status = session.expiresAt <= new Date() ? "EXPIRED" : "CANCELLED";
      const claimed = await tx.uploadSession.updateMany({
        data: { status },
        where: { completedAt: null, id: session.id, status: "PENDING" },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          "Only an incomplete upload session can be abandoned safely.",
        );
      const versionReference = { documentVersionId: session.documentVersionId };
      const referenced =
        (await tx.requirementEvidenceAttachment.count({
          where: versionReference,
        })) +
        (await tx.companyEvidenceFactVersion.count({
          where: versionReference,
        })) +
        (await tx.companyEvidenceCitation.count({ where: versionReference })) +
        (await tx.eligibilitySnapshotDocument.count({
          where: versionReference,
        }));
      if (referenced > 0) {
        await tx.document.updateMany({
          data: { status: "FAILED" },
          where: {
            currentVersionId: null,
            id: session.documentVersion.documentId,
            status: "UPLOADING",
          },
        });
      } else {
        const versionCount = await tx.documentVersion.count({
          where: { documentId: session.documentVersion.documentId },
        });
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
            retained_for_evidence: referenced > 0,
          },
        },
      });
      return referenced > 0;
    });

    if (!retained)
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
      where: {
        deletedAt: null,
        id: documentId,
        organisationId,
        tenderScopeId: null,
      },
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

  public async downloadRequirementAttachment(
    scope: RequirementScope,
    attachmentId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const attachment =
      await this.database.requirementEvidenceAttachment.findFirst({
        include: { document: true, documentVersion: true },
        where: {
          id: attachmentId,
          organisationId: scope.organisationId,
          tenderId: scope.tenderId,
          tenderVersionId: scope.tenderVersionId,
          structuredRequirementId: scope.requirementId,
          document: {
            deletedAt: null,
            organisationId: scope.organisationId,
            OR: [{ tenderScopeId: null }, { tenderScopeId: scope.tenderId }],
          },
          documentVersion: { approvedObjectKey: { not: null } },
        },
      });
    const version = attachment?.documentVersion;
    if (!attachment || !version?.approvedObjectKey)
      throw new NotFoundException();
    const downloadUrl = await getSignedUrl(
      this.storage,
      new GetObjectCommand({
        Bucket: this.environment.S3_BUCKET,
        Key: version.approvedObjectKey,
        ResponseContentDisposition: `attachment; filename="document-${attachment.documentId}-v${version.versionNumber}${version.extension}"`,
      }),
      { expiresIn: this.environment.DOCUMENT_DOWNLOAD_TTL_SECONDS },
    );
    await this.database.documentAccessEvent.create({
      data: {
        action: "DOWNLOAD_URL_REQUESTED",
        documentId: attachment.documentId,
        organisationId: scope.organisationId,
        outcome: "SUCCESS",
        requestId,
        userId,
      },
    });
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "DOCUMENT_DOWNLOADED",
        organisationId: scope.organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: attachment.documentId,
        subjectType: "document",
        metadata: {
          attachment_id: attachmentId,
          document_version_id: version.id,
        },
      },
    });
    return {
      download_url: downloadUrl,
      expires_in_seconds: this.environment.DOCUMENT_DOWNLOAD_TTL_SECONDS,
      document_version_id: version.id,
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
      where: {
        deletedAt: null,
        id: documentId,
        organisationId,
        tenderScopeId: null,
      },
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
