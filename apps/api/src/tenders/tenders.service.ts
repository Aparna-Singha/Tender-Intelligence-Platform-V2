import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  type MessageEvent,
} from "@nestjs/common";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  CreateTenderRequest,
  CreateTenderUploadRequest,
  CreateCorrigendumRequest,
  ImportTenderRequest,
  UpdateTenderRequest,
} from "@tender/contracts";
import type { ApiEnvironment } from "@tender/config";
import type { PrismaClient } from "@tender/database";
import {
  AdminImportAdapter,
  CuratedDatasetAdapter,
  extensionFor,
  isAllowedMimeExtension,
  ManualUploadAdapter,
  type NormalizedTenderSource,
} from "@tender/domain";
import type { Queue } from "bullmq";
import { createHash, randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import {
  API_ENVIRONMENT,
  JOB_QUEUE,
  PRISMA_CLIENT,
  S3_CLIENT,
} from "../infrastructure.tokens.js";

const demonstrationLabel =
  "Demonstration tender — not live procurement information.";

@Injectable()
export class TendersService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(S3_CLIENT) private readonly storage: S3Client,
    @Inject(JOB_QUEUE) private readonly jobs: Queue,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  public list(organisationId: string, cursor?: string): Promise<unknown> {
    return this.database.tender.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        buyer: true,
        id: true,
        isDemonstration: true,
        lifecycleStatus: true,
        sourceTenderNumber: true,
        submissionDeadline: true,
        title: true,
        workspace: {
          select: { id: true, processingProgress: true, status: true },
        },
      },
      skip: cursor === undefined ? 0 : 1,
      take: 25,
      ...(cursor === undefined ? {} : { cursor: { id: cursor } }),
      where: { deletedAt: null, organisationId },
    });
  }

  public async get(organisationId: string, tenderId: string): Promise<unknown> {
    const tender = await this.database.tender.findFirst({
      include: {
        corrigenda: { orderBy: { ingestedAt: "desc" } },
        processingJobs: {
          orderBy: { createdAt: "desc" },
          select: {
            completedAt: true,
            createdAt: true,
            currentStage: true,
            eventSequence: true,
            failureCategory: true,
            id: true,
            progressPercentage: true,
            publicMessage: true,
            state: true,
            updatedAt: true,
          },
          take: 20,
        },
        sources: true,
        versions: {
          include: {
            documents: {
              orderBy: { createdAt: "asc" },
              select: {
                createdAt: true,
                declaredMimeType: true,
                detectedMimeType: true,
                displayFilename: true,
                id: true,
                role: true,
                sha256: true,
                sizeBytes: true,
                status: true,
              },
            },
          },
          orderBy: { versionNumber: "desc" },
        },
        workspace: true,
      },
      where: { deletedAt: null, id: tenderId, organisationId },
    });
    if (tender === null) throw new NotFoundException();
    return {
      ...tender,
      demonstration_label: tender.isDemonstration
        ? demonstrationLabel
        : undefined,
      versions: tender.versions.map((version) => ({
        ...version,
        documents: version.documents.map((document) => ({
          ...document,
          sizeBytes: document.sizeBytes.toString(),
        })),
      })),
    };
  }

  public async listVersions(
    organisationId: string,
    tenderId: string,
    cursor?: string,
  ): Promise<unknown> {
    await this.requireTender(organisationId, tenderId);
    return this.database.tenderVersion.findMany({
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        ingestedAt: true,
        previousVersionId: true,
        reason: true,
        sourceFingerprint: true,
        versionNumber: true,
      },
      skip: cursor === undefined ? 0 : 1,
      take: 25,
      ...(cursor === undefined ? {} : { cursor: { id: cursor } }),
      where: { tenderId },
    });
  }

  public async getVersion(
    organisationId: string,
    tenderId: string,
    versionId: string,
  ): Promise<unknown> {
    const version = await this.database.tenderVersion.findFirst({
      include: {
        documents: {
          orderBy: { createdAt: "asc" },
          select: {
            createdAt: true,
            declaredMimeType: true,
            detectedMimeType: true,
            displayFilename: true,
            id: true,
            provenance: true,
            role: true,
            sha256: true,
            sizeBytes: true,
            status: true,
          },
        },
      },
      where: { id: versionId, tender: { id: tenderId, organisationId } },
    });
    if (version === null) throw new NotFoundException();
    return {
      ...version,
      documents: version.documents.map((document) => ({
        ...document,
        sizeBytes: document.sizeBytes.toString(),
      })),
    };
  }

  public async listDocuments(
    organisationId: string,
    tenderId: string,
    cursor?: string,
  ): Promise<unknown> {
    await this.requireTender(organisationId, tenderId);
    const documents = await this.database.tenderDocument.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        declaredMimeType: true,
        detectedMimeType: true,
        displayFilename: true,
        id: true,
        provenance: true,
        role: true,
        sha256: true,
        sizeBytes: true,
        status: true,
        tenderVersionId: true,
      },
      skip: cursor === undefined ? 0 : 1,
      take: 25,
      ...(cursor === undefined ? {} : { cursor: { id: cursor } }),
      where: { organisationId, tenderVersion: { tenderId } },
    });
    return documents.map((document) => ({
      ...document,
      sizeBytes: document.sizeBytes.toString(),
    }));
  }

  public async create(
    organisationId: string,
    userId: string,
    input: CreateTenderRequest,
    requestId: string,
  ): Promise<unknown> {
    return this.createFromAdapter(
      organisationId,
      userId,
      input,
      new ManualUploadAdapter().normalize({
        provenance:
          "Metadata manually supplied by an authorised organisation member.",
        sourceName: "Manual upload",
        ...(input.official_source_url === undefined
          ? {}
          : { sourceUrl: input.official_source_url }),
        ...(input.source_tender_number === undefined
          ? {}
          : { sourceTenderId: input.source_tender_number }),
      }),
      requestId,
    );
  }

  public async import(
    organisationId: string,
    userId: string,
    input: ImportTenderRequest,
    requestId: string,
  ): Promise<unknown> {
    const Adapter =
      input.adapter_type === "CURATED_DATASET"
        ? CuratedDatasetAdapter
        : AdminImportAdapter;
    const source = new Adapter().normalize({
      ...(input.external_metadata === undefined
        ? {}
        : { externalMetadata: input.external_metadata }),
      provenance: input.provenance,
      sourceName: input.source_name,
      ...(input.metadata.official_source_url === undefined
        ? {}
        : { sourceUrl: input.metadata.official_source_url }),
      ...(input.metadata.source_tender_number === undefined
        ? {}
        : { sourceTenderId: input.metadata.source_tender_number }),
    });
    return this.createFromAdapter(
      organisationId,
      userId,
      input.metadata,
      source,
      requestId,
    );
  }

  private async createFromAdapter(
    organisationId: string,
    userId: string,
    input: CreateTenderRequest,
    source: NormalizedTenderSource,
    requestId: string,
  ): Promise<unknown> {
    const snapshot = {
      buyer: input.buyer,
      deadline: input.submission_deadline,
      source_tender_number: input.source_tender_number ?? null,
      title: input.title,
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex");
    return this.database.$transaction(async (tx) => {
      const workspace = await tx.tenderWorkspace.create({
        data: { createdByUserId: userId, organisationId },
      });
      const tender = await tx.tender.create({
        data: {
          buyer: input.buyer,
          category: input.category ?? null,
          createdByUserId: userId,
          description: input.description ?? null,
          isDemonstration: source.adapterType === "CURATED_DATASET",
          officialSourceUrl: input.official_source_url ?? null,
          openingDate: input.opening_date ?? null,
          organisationId,
          preBidMeetingDate: input.pre_bid_meeting_date ?? null,
          procurementType: input.procurement_type ?? null,
          publicationDate: input.publication_date ?? null,
          sourceTenderNumber: input.source_tender_number ?? null,
          sourceType: source.adapterType,
          submissionDeadline: input.submission_deadline,
          title: input.title,
        },
      });
      const version = await tx.tenderVersion.create({
        data: {
          createdByUserId: userId,
          reason: "Original tender source",
          sourceFingerprint: fingerprint,
          sourceProvenance: source.provenance,
          sourceSnapshot: snapshot,
          tenderId: tender.id,
          versionNumber: 1,
        },
      });
      await tx.tender.update({
        data: { currentVersionId: version.id },
        where: { id: tender.id },
      });
      await tx.tenderWorkspace.update({
        data: { tenderId: tender.id },
        where: { id: workspace.id },
      });
      await tx.tenderSource.create({
        data: {
          adapterType: source.adapterType,
          externalMetadata: source.externalMetadata ?? {},
          importMethod: source.importMethod,
          importedByUserId: userId,
          organisationId,
          provenance: source.provenance,
          sourceName: source.sourceName,
          sourceTenderId: source.sourceTenderId ?? null,
          sourceUrl: source.sourceUrl ?? null,
          tenderId: tender.id,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType:
            source.adapterType === "MANUAL_UPLOAD"
              ? "TENDER_CREATED"
              : "TENDER_IMPORTED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: tender.id,
          subjectType: "tender",
          metadata: { adapter_type: source.adapterType },
        },
      });
      return {
        demonstration_label:
          source.adapterType === "CURATED_DATASET"
            ? demonstrationLabel
            : undefined,
        tender_id: tender.id,
        version_id: version.id,
        workspace_id: workspace.id,
      };
    });
  }

  public async update(
    organisationId: string,
    tenderId: string,
    userId: string,
    input: UpdateTenderRequest,
    requestId: string,
  ): Promise<unknown> {
    const updated = await this.database.tender.updateMany({
      data: {
        ...(input.buyer === undefined ? {} : { buyer: input.buyer }),
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.official_source_url === undefined
          ? {}
          : { officialSourceUrl: input.official_source_url }),
        ...(input.opening_date === undefined
          ? {}
          : { openingDate: input.opening_date }),
        ...(input.pre_bid_meeting_date === undefined
          ? {}
          : { preBidMeetingDate: input.pre_bid_meeting_date }),
        ...(input.procurement_type === undefined
          ? {}
          : { procurementType: input.procurement_type }),
        ...(input.publication_date === undefined
          ? {}
          : { publicationDate: input.publication_date }),
        ...(input.source_tender_number === undefined
          ? {}
          : { sourceTenderNumber: input.source_tender_number }),
        ...(input.submission_deadline === undefined
          ? {}
          : { submissionDeadline: input.submission_deadline }),
        ...(input.title === undefined ? {} : { title: input.title }),
      },
      where: { deletedAt: null, id: tenderId, organisationId },
    });
    if (updated.count !== 1) throw new NotFoundException();
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "TENDER_UPDATED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: tenderId,
        subjectType: "tender",
      },
    });
    return this.get(organisationId, tenderId);
  }

  public async createUpload(
    organisationId: string,
    tenderId: string,
    versionId: string,
    userId: string,
    input: CreateTenderUploadRequest,
    requestId: string,
  ): Promise<unknown> {
    const version = await this.database.tenderVersion.findFirst({
      where: { id: versionId, tender: { id: tenderId, organisationId } },
    });
    if (version === null) throw new NotFoundException();
    const extension = extensionFor(input.filename);
    const additionalAllowed =
      (input.mime_type === "application/zip" && extension === ".zip") ||
      (input.mime_type === "text/csv" && extension === ".csv");
    if (
      !additionalAllowed &&
      !isAllowedMimeExtension(input.mime_type, extension)
    )
      throw new BadRequestException("File type is not allowed");
    const duplicate = await this.database.tenderDocument.findFirst({
      where: {
        organisationId,
        role: input.role,
        sha256: input.checksum_sha256,
        tenderVersion: { tenderId },
      },
    });
    if (duplicate !== null) {
      await this.auditDuplicate(organisationId, tenderId, userId, requestId);
      throw new ConflictException(
        "This file is already attached to the tender",
      );
    }
    const documentId = randomUUID();
    const key = `tender-quarantine/${organisationId}/${documentId}`;
    const expiresAt = new Date(
      Date.now() + this.environment.DOCUMENT_UPLOAD_TTL_SECONDS * 1000,
    );
    const document = await this.database.tenderDocument.create({
      data: {
        declaredMimeType: input.mime_type,
        displayFilename: input.filename,
        extension,
        id: documentId,
        organisationId,
        originalFilename: input.filename,
        quarantineObjectKey: key,
        provenance: "Direct upload by an authorised organisation member.",
        role: input.role,
        sha256: input.checksum_sha256,
        sizeBytes: BigInt(input.size_bytes),
        tenderVersionId: versionId,
        uploadSessionExpiresAt: expiresAt,
        uploadedByUserId: userId,
      },
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
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "TENDER_UPLOAD_REQUESTED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: tenderId,
        subjectType: "tender",
        metadata: { document_id: document.id, role: input.role },
      },
    });
    return {
      document_id: document.id,
      expires_at: expiresAt,
      upload_url: uploadUrl,
    };
  }

  public async completeUpload(
    organisationId: string,
    tenderId: string,
    documentId: string,
    userId: string,
    checksum: string,
    requestId: string,
  ): Promise<unknown> {
    const document = await this.database.tenderDocument.findFirst({
      include: { tenderVersion: true },
      where: {
        id: documentId,
        organisationId,
        tenderVersion: { tenderId },
      },
    });
    if (document === null) throw new NotFoundException();
    const existingJob = await this.database.processingJob.findUnique({
      where: { idempotencyKey: `tender-document:${document.id}` },
    });
    if (existingJob !== null)
      return { job_id: existingJob.id, state: existingJob.state };
    if (document.uploadSessionExpiresAt <= new Date())
      throw new GoneException();
    if (document.sha256 !== checksum)
      throw new BadRequestException("Upload checksum does not match");
    const object = await this.storage.send(
      new HeadObjectCommand({
        Bucket: this.environment.S3_BUCKET,
        Key: document.quarantineObjectKey,
      }),
    );
    if (
      object.ContentLength !== Number(document.sizeBytes) ||
      object.ContentType !== document.declaredMimeType ||
      object.Metadata?.sha256 !== document.sha256
    )
      throw new BadRequestException("Uploaded object metadata does not match");
    const job = await this.database.$transaction(async (tx) => {
      await tx.tenderDocument.update({
        data: { status: "UPLOADED", uploadCompletedAt: new Date() },
        where: { id: document.id },
      });
      await tx.tender.update({
        data: { lifecycleStatus: "INGESTING" },
        where: { id: tenderId },
      });
      await tx.tenderWorkspace.update({
        data: {
          processingProgress: 10,
          sourceSectionStatus: "QUEUED",
          status: "INGESTING",
        },
        where: { tenderId },
      });
      const created = await tx.processingJob.create({
        data: {
          idempotencyKey: `tender-document:${document.id}`,
          jobType: "SOURCE_INGESTION",
          organisationId,
          tenderId,
          tenderVersionId: document.tenderVersionId,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "TENDER_UPLOAD_COMPLETED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: tenderId,
          subjectType: "tender",
          metadata: { document_id: document.id, job_id: created.id },
        },
      });
      return created;
    });
    await this.jobs.add(
      "process-tender-document",
      {
        documentId: document.id,
        jobId: job.id,
        organisationId,
        requestId,
      },
      { attempts: 3, jobId: job.id, removeOnComplete: 100 },
    );
    return { job_id: job.id, state: job.state };
  }

  public async addCorrigendum(
    organisationId: string,
    tenderId: string,
    userId: string,
    input: CreateCorrigendumRequest,
    requestId: string,
  ): Promise<unknown> {
    try {
      return await this.database.$transaction(async (tx) => {
        const tender = await tx.tender.findFirst({
          include: { currentVersion: true },
          where: { id: tenderId, organisationId },
        });
        if (tender?.currentVersion === null || tender === null)
          throw new NotFoundException();
        const existing = await tx.tenderCorrigendum.findFirst({
          where: {
            tenderId,
            OR: [
              { identifier: input.identifier },
              {
                resultingVersion: { sourceFingerprint: input.checksum_sha256 },
              },
            ],
          },
        });
        if (existing !== null)
          return { duplicate: true, version_id: existing.resultingVersionId };
        const next = await tx.tenderVersion.create({
          data: {
            createdByUserId: userId,
            previousVersionId: tender.currentVersion.id,
            reason: `Corrigendum ${input.identifier}`,
            sourceFingerprint: input.checksum_sha256,
            sourceProvenance:
              "Corrigendum manually supplied by an authorised organisation member.",
            sourceSnapshot: {
              corrigendum_identifier: input.identifier,
              description: input.description,
            },
            tenderId,
            versionNumber: tender.currentVersion.versionNumber + 1,
          },
        });
        await tx.tenderCorrigendum.create({
          data: {
            affectedVersionId: tender.currentVersion.id,
            description: input.description,
            identifier: input.identifier,
            publicationDate: input.publication_date ?? null,
            resultingVersionId: next.id,
            sourceUrl: input.source_url ?? null,
            tenderId,
          },
        });
        await tx.tender.update({
          data: { currentVersionId: next.id, lifecycleStatus: "DRAFT" },
          where: { id: tenderId },
        });
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            eventType: "TENDER_CORRIGENDUM_CREATED",
            organisationId,
            outcome: "SUCCESS",
            requestId,
            subjectId: tenderId,
            subjectType: "tender",
            metadata: {
              affected_version_id: tender.currentVersion.id,
              resulting_version_id: next.id,
            },
          },
        });
        return { duplicate: false, version_id: next.id };
      });
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "The tender version changed; refresh and try again",
        );
      throw error;
    }
  }

  public async job(
    organisationId: string,
    tenderId: string,
    jobId: string,
  ): Promise<unknown> {
    const job = await this.database.processingJob.findFirst({
      select: {
        completedAt: true,
        createdAt: true,
        currentStage: true,
        eventSequence: true,
        failureCategory: true,
        id: true,
        progressPercentage: true,
        publicMessage: true,
        state: true,
        updatedAt: true,
      },
      where: { id: jobId, organisationId, tenderId },
    });
    if (job === null) throw new NotFoundException();
    return job;
  }

  public jobEvents(
    organisationId: string,
    tenderId: string,
    jobId: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let active = true;
      let timer: NodeJS.Timeout | undefined;
      const expiresAt = Date.now() + 15 * 60 * 1000;
      let lastSequence: number | undefined;
      const poll = async (): Promise<void> => {
        try {
          if (Date.now() >= expiresAt) {
            subscriber.complete();
            return;
          }
          const job = await this.database.processingJob.findFirst({
            select: {
              currentStage: true,
              eventSequence: true,
              progressPercentage: true,
              publicMessage: true,
              state: true,
              updatedAt: true,
            },
            where: { id: jobId, organisationId, tenderId },
          });
          if (job === null) {
            subscriber.error(new NotFoundException());
            return;
          }
          subscriber.next({
            data:
              lastSequence === job.eventSequence
                ? { timestamp: new Date().toISOString(), type: "heartbeat" }
                : { ...job, job_id: jobId, tender_id: tenderId },
            id: String(job.eventSequence),
            type: lastSequence === job.eventSequence ? "heartbeat" : "progress",
          });
          lastSequence = job.eventSequence;
          if (["CANCELLED", "COMPLETE", "FAILED"].includes(job.state)) {
            subscriber.complete();
            return;
          }
          if (active) timer = setTimeout(() => void poll(), 2000);
        } catch (error: unknown) {
          subscriber.error(error);
        }
      };
      void poll();
      return () => {
        active = false;
        if (timer !== undefined) clearTimeout(timer);
      };
    });
  }

  public async cancelJob(
    organisationId: string,
    tenderId: string,
    jobId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const current = await this.database.processingJob.findFirst({
      select: { state: true },
      where: { id: jobId, organisationId, tenderId },
    });
    if (current === null || !["QUEUED", "SCANNING"].includes(current.state))
      throw new ConflictException("Job cannot be cancelled");
    const updated = await this.database.processingJob.updateMany({
      data: {
        cancellationRequestedAt: new Date(),
        cancelledByUserId: userId,
        currentStage: "CANCELLED",
        eventSequence: { increment: 1 },
        publicMessage: "Source ingestion cancelled",
        state: "CANCELLED",
      },
      where: {
        id: jobId,
        organisationId,
        state: { in: ["QUEUED", "SCANNING"] },
        tenderId,
      },
    });
    if (updated.count !== 1)
      throw new ConflictException("Job cannot be cancelled");
    if (current.state === "QUEUED") {
      const queuedJob = await this.jobs.getJob(jobId);
      if (queuedJob !== undefined) await queuedJob.remove();
    }
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "TENDER_JOB_CANCELLED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: tenderId,
        subjectType: "tender",
        metadata: { job_id: jobId },
      },
    });
    return { state: "CANCELLED" };
  }

  public async download(
    organisationId: string,
    tenderId: string,
    documentId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const document = await this.database.tenderDocument.findFirst({
      where: {
        approvedObjectKey: { not: null },
        id: documentId,
        organisationId,
        status: "READY",
        tenderVersion: { tenderId },
      },
    });
    if (document?.approvedObjectKey === null || document === null)
      throw new NotFoundException();
    const url = await getSignedUrl(
      this.storage,
      new GetObjectCommand({
        Bucket: this.environment.S3_BUCKET,
        Key: document.approvedObjectKey,
        ResponseContentDisposition: `attachment; filename="tender-source-${document.id}${document.extension}"`,
      }),
      { expiresIn: this.environment.DOCUMENT_DOWNLOAD_TTL_SECONDS },
    );
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "TENDER_DOCUMENT_DOWNLOADED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: tenderId,
        subjectType: "tender",
        metadata: { document_id: documentId },
      },
    });
    return {
      download_url: url,
      expires_in_seconds: this.environment.DOCUMENT_DOWNLOAD_TTL_SECONDS,
    };
  }

  private async auditDuplicate(
    organisationId: string,
    tenderId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "TENDER_DUPLICATE_DETECTED",
        organisationId,
        outcome: "REJECTED",
        requestId,
        subjectId: tenderId,
        subjectType: "tender",
      },
    });
  }

  private async requireTender(
    organisationId: string,
    tenderId: string,
  ): Promise<void> {
    const count = await this.database.tender.count({
      where: { deletedAt: null, id: tenderId, organisationId },
    });
    if (count !== 1) throw new NotFoundException();
  }
}
