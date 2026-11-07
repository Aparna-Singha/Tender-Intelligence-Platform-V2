import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AttachRequirementEvidenceRequest,
  CreateRequirementUploadRequest,
  EvidenceCandidateFilter,
  CompleteUploadRequest,
} from "@tender/contracts";
import { Prisma, type PrismaClient } from "@tender/database";
import { createHash } from "node:crypto";
import { PRISMA_CLIENT } from "../infrastructure.tokens.js";
import { DocumentsService } from "../documents/documents.service.js";
import {
  assertCurrentRequirement,
  type RequirementScope,
} from "./requirement-evidence-scope.js";

@Injectable()
export class RequirementEvidenceService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    private readonly documents: DocumentsService,
  ) {}

  public createUpload(
    scope: RequirementScope,
    userId: string,
    input: CreateRequirementUploadRequest,
    requestId: string,
  ): Promise<unknown> {
    return this.documents.createUploadSession(
      scope.organisationId,
      userId,
      { ...input, category: input.category ?? "OTHER" },
      requestId,
      { ...scope, idempotencyKey: input.idempotency_key },
    );
  }

  public async completeUpload(
    scope: RequirementScope,
    uploadSessionId: string,
    userId: string,
    input: CompleteUploadRequest,
    requestId: string,
  ): Promise<unknown> {
    const attachment =
      await this.database.requirementEvidenceAttachment.findFirst({
        select: { id: true },
        where: {
          documentVersion: { uploadSession: { id: uploadSessionId } },
          detachedAt: null,
          organisationId: scope.organisationId,
          structuredRequirementId: scope.requirementId,
          tenderId: scope.tenderId,
          tenderVersionId: scope.tenderVersionId,
        },
      });
    if (!attachment) throw new NotFoundException();
    const result = await this.documents.completeUpload(
      scope.organisationId,
      uploadSessionId,
      userId,
      input,
      requestId,
      scope,
    );
    return { attachment_id: attachment.id, ...(result as object) };
  }

  public async abandonUpload(
    scope: RequirementScope,
    uploadSessionId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const attachment =
      await this.database.requirementEvidenceAttachment.findFirst({
        select: { id: true },
        where: {
          documentVersion: { uploadSession: { id: uploadSessionId } },
          organisationId: scope.organisationId,
          structuredRequirementId: scope.requirementId,
          tenderId: scope.tenderId,
          tenderVersionId: scope.tenderVersionId,
        },
      });
    if (!attachment) throw new NotFoundException();
    return this.documents.abandonUploadSession(
      scope.organisationId,
      uploadSessionId,
      userId,
      requestId,
      scope,
    );
  }

  public async candidates(
    scope: RequirementScope,
    filter: EvidenceCandidateFilter,
  ): Promise<unknown> {
    if (!(await this.readableScope(scope))) throw new NotFoundException();
    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      organisationId: scope.organisationId,
      status: { in: ["READY", "EXPIRED"] },
      currentVersion: { approvedObjectKey: { not: null } },
      ...(filter.search
        ? { displayName: { contains: filter.search, mode: "insensitive" } }
        : {}),
    };
    // Nullable tender scope is the reusable organisation library.
    where.OR = [{ tenderScopeId: null }, { tenderScopeId: scope.tenderId }];
    const [items, total] = await Promise.all([
      this.database.document.findMany({
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: filter.offset,
        take: filter.limit,
        select: {
          category: true,
          currentVersion: {
            select: {
              createdAt: true,
              detectedMimeType: true,
              id: true,
              originalFilename: true,
              sizeBytes: true,
              versionNumber: true,
            },
          },
          displayName: true,
          expiryDate: true,
          id: true,
          status: true,
          tenderScopeId: true,
          verificationStatus: true,
        },
        where,
      }),
      this.database.document.count({ where }),
    ]);
    return {
      items: items.map((document) => ({
        ...document,
        currentVersion: document.currentVersion
          ? {
              ...document.currentVersion,
              sizeBytes: document.currentVersion.sizeBytes.toString(),
            }
          : null,
      })),
      limit: filter.limit,
      offset: filter.offset,
      total,
    };
  }

  public async list(scope: RequirementScope): Promise<unknown> {
    const current = await this.readableScope(scope);
    const items = await this.database.requirementEvidenceAttachment.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        document: {
          select: {
            category: true,
            displayName: true,
            expiryDate: true,
            status: true,
            tenderScopeId: true,
            verificationStatus: true,
          },
        },
        documentVersion: {
          select: {
            createdAt: true,
            detectedMimeType: true,
            originalFilename: true,
            sizeBytes: true,
            uploadSession: {
              select: { completedAt: true, expiresAt: true, status: true },
            },
            versionNumber: true,
          },
        },
      },
      where: {
        organisationId: scope.organisationId,
        structuredRequirementId: scope.requirementId,
        tenderId: scope.tenderId,
        tenderVersionId: scope.tenderVersionId,
      },
    });
    return items.map((item) => ({
      attached_at: item.createdAt,
      attached_by_user_id: item.attachedByUserId,
      attachment_id: item.id,
      context_only: true,
      detached_at: item.detachedAt,
      detached_by_user_id: item.detachedByUserId,
      document_id: item.documentId,
      document: item.document,
      document_version_id: item.documentVersionId,
      version: {
        ...item.documentVersion,
        sizeBytes: item.documentVersion.sizeBytes.toString(),
      },
      stale_requirement: !current,
    }));
  }

  public async get(
    scope: RequirementScope,
    attachmentId: string,
  ): Promise<unknown> {
    const items = (await this.list(scope)) as { attachment_id: string }[];
    const item = items.find(
      (candidate) => candidate.attachment_id === attachmentId,
    );
    if (!item) throw new NotFoundException();
    return item;
  }

  public async attachExisting(
    scope: RequirementScope,
    input: AttachRequirementEvidenceRequest,
    userId: string,
  ): Promise<unknown> {
    if (!(await this.readableScope(scope))) throw new NotFoundException();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ scope, input, userId }))
      .digest("hex");
    const existing = async (): Promise<{
      id: string;
      requestFingerprint: string;
      detachedAt: Date | null;
    } | null> =>
      this.database.requirementEvidenceAttachment.findFirst({
        select: { id: true, requestFingerprint: true, detachedAt: true },
        where: {
          organisationId: scope.organisationId,
          tenderId: scope.tenderId,
          idempotencyKey: input.idempotency_key,
        },
      });
    const previous = await existing();
    if (previous) return this.idempotentResult(previous, fingerprint);
    try {
      const attachment = await this.database.$transaction(async (tx) => {
        const extractionRunId = await assertCurrentRequirement(tx, scope);
        const version = await tx.documentVersion.findFirst({
          select: { id: true },
          where: {
            approvedObjectKey: { not: null },
            documentId: input.document_id,
            id: input.document_version_id,
            document: {
              deletedAt: null,
              organisationId: scope.organisationId,
              OR: [{ tenderScopeId: null }, { tenderScopeId: scope.tenderId }],
              status: { in: ["READY", "EXPIRED"] },
            },
          },
        });
        if (!version) throw new NotFoundException();
        return tx.requirementEvidenceAttachment.create({
          data: {
            attachedByUserId: userId,
            documentId: input.document_id,
            documentVersionId: version.id,
            extractionRunId,
            idempotencyKey: input.idempotency_key,
            organisationId: scope.organisationId,
            requestFingerprint: fingerprint,
            structuredRequirementId: scope.requirementId,
            tenderId: scope.tenderId,
            tenderVersionId: scope.tenderVersionId,
          },
          select: { id: true },
        });
      });
      return { attachment_id: attachment.id, context_only: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const winner = await existing();
        if (winner) return this.idempotentResult(winner, fingerprint);
        throw new ConflictException("An active attachment already exists");
      }
      throw error;
    }
  }

  public async detach(
    scope: RequirementScope,
    attachmentId: string,
    userId: string,
  ): Promise<unknown> {
    await this.readableScope(scope);
    const updated =
      await this.database.requirementEvidenceAttachment.updateMany({
        data: { detachedAt: new Date(), detachedByUserId: userId },
        where: {
          id: attachmentId,
          organisationId: scope.organisationId,
          tenderId: scope.tenderId,
          tenderVersionId: scope.tenderVersionId,
          structuredRequirementId: scope.requirementId,
          detachedAt: null,
        },
      });
    if (updated.count !== 1) {
      const existing =
        await this.database.requirementEvidenceAttachment.findFirst({
          select: { id: true },
          where: {
            id: attachmentId,
            organisationId: scope.organisationId,
            tenderId: scope.tenderId,
            tenderVersionId: scope.tenderVersionId,
            structuredRequirementId: scope.requirementId,
            detachedAt: { not: null },
          },
        });
      if (!existing) throw new NotFoundException();
    }
    return { attachment_id: attachmentId, detached: true };
  }

  private idempotentResult(
    previous: {
      id: string;
      requestFingerprint: string;
      detachedAt: Date | null;
    },
    fingerprint: string,
  ): { attachment_id: string; context_only: true } {
    if (previous.requestFingerprint !== fingerprint || previous.detachedAt)
      throw new ConflictException("Idempotency key was already used");
    return { attachment_id: previous.id, context_only: true };
  }

  private async readableScope(scope: RequirementScope): Promise<boolean> {
    const requirement = await this.database.structuredRequirement.findFirst({
      select: { extractionRunId: true },
      where: {
        id: scope.requirementId,
        extractionRun: {
          tenderVersionId: scope.tenderVersionId,
          tenderId: scope.tenderId,
          organisationId: scope.organisationId,
        },
      },
    });
    if (!requirement) throw new NotFoundException();
    const version = await this.database.tenderVersion.findFirst({
      select: {
        activeExtractionRunId: true,
        tender: {
          select: { currentVersionId: true, deletedAt: true },
        },
      },
      where: {
        id: scope.tenderVersionId,
        tenderId: scope.tenderId,
        tender: { organisationId: scope.organisationId },
      },
    });
    if (!version || version.tender.deletedAt) throw new NotFoundException();
    return (
      version.tender.currentVersionId === scope.tenderVersionId &&
      version.activeExtractionRunId === requirement.extractionRunId
    );
  }
}
