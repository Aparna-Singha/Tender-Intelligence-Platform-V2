/* eslint-disable @typescript-eslint/explicit-function-return-type -- Prisma query helpers preserve generated payload inference. */
import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ApiEnvironment } from "@tender/config";
import type { OrganisationRole } from "@tender/contracts";
import { Prisma, type PrismaClient, type Role } from "@tender/database";
import {
  canonicalControlledPackageInput,
  canCancelControlledPackage,
  canRegenerateControlledPackage,
  canRetryControlledPackage,
  canReviewControlledPackage,
  controlledPackageApprovalDenials,
  CONTROLLED_REVIEW_PACKAGE_CONTENT_POLICY_VERSION,
  CONTROLLED_REVIEW_PACKAGE_POLICY_VERSION,
  CONTROLLED_REVIEW_PACKAGE_RENDERER_COMPATIBILITY_VERSION,
  evaluateControlledPackagePrerequisites,
  hasPermission,
  isControlledPackageDownloadEligible,
} from "@tender/domain";
import type { Queue } from "bullmq";
import { createHash } from "node:crypto";
import {
  API_ENVIRONMENT,
  JOB_QUEUE,
  PRISMA_CLIENT,
  S3_CLIENT,
} from "../infrastructure.tokens.js";
import { ControlledReviewPackageError } from "./controlled-review-package.error.js";
import { ControlledReviewPackageFreshnessService } from "./controlled-review-package-freshness.service.js";

type Database = PrismaClient | Prisma.TransactionClient;
interface Pagination {
  readonly cursor?: string | undefined;
  readonly limit: number;
}
type ControlledPackageReviewOutcome = "COMMENTED" | "REVIEW_COMPLETE";
type ControlledPackageApprovalOutcome =
  "APPROVED_FOR_CONTROLLED_DOWNLOAD" | "REJECTED";
type ControlledPackageRevocationReason =
  | "AUTHORITATIVE_INPUT_CHANGED"
  | "APPROVAL_WITHDRAWN"
  | "ARTIFACT_INTEGRITY_FAILURE"
  | "SECURITY_CONCERN"
  | "SUPERSEDED";
interface ReviewInput {
  readonly comment: string;
  readonly expected_review_version: number;
  readonly outcome: ControlledPackageReviewOutcome;
}
interface DecisionInput {
  readonly expected_fingerprint: string;
  readonly expected_review_version: number;
  readonly outcome: ControlledPackageApprovalOutcome;
  readonly rationale: string;
}
interface RevocationInput {
  readonly rationale: string;
  readonly reason: ControlledPackageRevocationReason;
}

@Injectable()
export class ControlledReviewPackageService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(JOB_QUEUE) private readonly jobs: Queue,
    private readonly freshness: ControlledReviewPackageFreshnessService,
    @Optional() @Inject(S3_CLIENT) private readonly storage?: S3Client,
    @Optional()
    @Inject(API_ENVIRONMENT)
    private readonly environment?: ApiEnvironment,
  ) {}

  public async preflight(
    organisationId: string,
    tenderId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const authority = await this.loadAuthority(
      this.database,
      organisationId,
      tenderId,
      userId,
    );
    const prerequisites = this.prerequisites(authority);
    const independent =
      authority.draft === undefined
        ? null
        : await this.database.organisationMembership.findFirst({
            select: { id: true },
            where: {
              organisationId,
              revokedAt: null,
              role: { in: ["OWNER", "ADMIN", "REVIEWER"] },
              userId: {
                notIn: [userId, authority.draft.draftCreatorUserId],
              },
            },
          });
    const active = authority.activeRun;
    const activeFreshness =
      active === null
        ? null
        : await this.freshness.evaluate(organisationId, tenderId, active.id);
    await this.database.auditEvent.create({
      data: audit(
        "CONTROLLED_PACKAGE_PREFLIGHT_EVALUATED",
        organisationId,
        userId,
        tenderId,
        requestId,
        prerequisites.hardGenerationBlockers.length === 0
          ? "SUCCESS"
          : "DENIED",
        { issueCount: totalIssues(prerequisites) },
      ),
    });
    return {
      active_run:
        active === null
          ? null
          : {
              details_path: packagePath(organisationId, tenderId, active.id),
              freshness: activeFreshness!.freshness,
              generation_status: active.generationStatus,
              id: active.id,
              progress_path: `${packagePath(organisationId, tenderId, active.id)}/progress`,
              review_status: active.reviewStatus,
            },
      eligible_independent_approver_exists: independent !== null,
      evaluated_at: new Date().toISOString(),
      hard_prerequisites_pass:
        prerequisites.hardGenerationBlockers.length === 0,
      informational_only: true,
      issues: [
        ...prerequisites.hardGenerationBlockers.map(
          issue("HARD_GENERATION_BLOCKER"),
        ),
        ...prerequisites.packageWarnings.map(issue("PACKAGE_WARNING")),
        ...prerequisites.reviewBlockers.map(issue("REVIEW_BLOCKER")),
        ...prerequisites.downloadBlockers.map(issue("DOWNLOAD_BLOCKER")),
      ],
      policy_version: CONTROLLED_REVIEW_PACKAGE_POLICY_VERSION,
      qualifying_export_template_version_id: authority.template?.id ?? null,
      tender_version_id:
        authority.version?.id ?? authority.tender?.currentVersionId,
      transactional_revalidation_required: true,
    };
  }

  public async start(
    organisationId: string,
    tenderId: string,
    userId: string,
    idempotencyKey: string,
    requestId: string,
    retryOfRunId?: string,
  ): Promise<unknown> {
    const existing = await this.database.controlledReviewPackageRun.findFirst({
      where: { idempotencyKey, organisationId, tenderId },
    });
    if (existing !== null)
      return this.replay(organisationId, tenderId, existing);
    let run: Awaited<
      ReturnType<ControlledReviewPackageService["createRun"]>
    > | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        run = await this.database.$transaction(
          (transaction) =>
            this.createRun(
              transaction,
              organisationId,
              tenderId,
              userId,
              idempotencyKey,
              requestId,
              retryOfRunId,
            ),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (error: unknown) {
        if (isSerializationConflict(error) && attempt < 2) continue;
        if (isUniqueConflict(error)) {
          const replay =
            await this.database.controlledReviewPackageRun.findFirst({
              where: { idempotencyKey, organisationId, tenderId },
            });
          if (replay !== null)
            return this.replay(organisationId, tenderId, replay);
          throw packageError(
            "CONTROLLED_PACKAGE_ALREADY_ACTIVE",
            "A controlled package is already active.",
          );
        }
        throw error;
      }
    }
    if (run === null)
      throw packageError(
        "CONTROLLED_PACKAGE_CONCURRENCY_CONFLICT",
        "The package request could not be serialized.",
      );
    try {
      await this.jobs.add(
        "generate-controlled-review-package",
        { controlledReviewPackageRunId: run.id, organisationId, requestId },
        {
          attempts: 2,
          backoff: { delay: 2_000, type: "exponential" },
          jobId: run.id,
          removeOnComplete: 100,
        },
      );
    } catch {
      await this.database.controlledReviewPackageRun.update({
        data: {
          failedAt: new Date(),
          generationStatus: "FAILED",
          safeFailureCode: "QUEUE_DELIVERY_FAILED",
        },
        where: { id: run.id },
      });
      throw new ControlledReviewPackageError(
        "CONTROLLED_PACKAGE_NOT_RETRYABLE",
        "The controlled package could not be queued safely.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return startResponse(run);
  }

  private async createRun(
    transaction: Prisma.TransactionClient,
    organisationId: string,
    tenderId: string,
    userId: string,
    idempotencyKey: string,
    requestId: string,
    retryOfRunId?: string,
  ) {
    const authority = await this.loadAuthority(
      transaction,
      organisationId,
      tenderId,
      userId,
    );
    const prerequisites = this.prerequisites(authority);
    if (prerequisites.hardGenerationBlockers.length > 0)
      throw packageError(
        prerequisites.hardGenerationBlockers.includes(
          "PROCEED_DECISION_NOT_CURRENT",
        )
          ? "CONTROLLED_PACKAGE_PROCEED_DECISION_REQUIRED"
          : "CONTROLLED_PACKAGE_PREREQUISITES_NOT_CURRENT",
        "Controlled-package prerequisites are not current.",
      );
    const readiness = authority.readiness!;
    const snapshot = readiness.inputSnapshot!;
    const draft = authority.draft!;
    const template = authority.template!;
    const membership = authority.membership;
    if (
      membership.role === "PLATFORM_ADMIN" ||
      !hasPermission(membership.role, "TENDER_CONTROLLED_PACKAGE_START")
    )
      throw new NotFoundException();
    const canonical = canonicalControlledPackageInput({
      contentPolicyVersion: CONTROLLED_REVIEW_PACKAGE_CONTENT_POLICY_VERSION,
      documents: snapshot.documents.map(({ checksum, tenderDocumentId }) => ({
        checksum,
        id: tenderDocumentId,
      })),
      draftApprovalReviewEventId: draft.qualifyingReviewEventId,
      draftVersionId: draft.draftVersionId,
      finalReadinessDecisionId: authority.decision!.id,
      finalReadinessFingerprint: readiness.inputFingerprint,
      finalReadinessRunId: readiness.id,
      organisationId,
      policyVersion: CONTROLLED_REVIEW_PACKAGE_POLICY_VERSION,
      rendererCompatibilityVersion:
        CONTROLLED_REVIEW_PACKAGE_RENDERER_COMPATIBILITY_VERSION,
      templateFingerprint: template.sourceFingerprint,
      templateVersionId: template.id,
      tenderId,
      tenderVersionId: authority.version!.id,
    });
    const inputFingerprint = createHash("sha256")
      .update(canonical)
      .digest("hex");
    const now = new Date();
    const run = await transaction.controlledReviewPackageRun.create({
      data: {
        contentPolicyVersion: CONTROLLED_REVIEW_PACKAGE_CONTENT_POLICY_VERSION,
        generationPolicyVersion: CONTROLLED_REVIEW_PACKAGE_POLICY_VERSION,
        idempotencyKey,
        inputFingerprint,
        organisationId,
        rendererCompatibilityVersion:
          CONTROLLED_REVIEW_PACKAGE_RENDERER_COMPATIBILITY_VERSION,
        requestedByUserId: userId,
        requesterRoleAtAction: membership.role,
        ...(retryOfRunId === undefined ? {} : { retryOfRunId }),
        templateVersionId: template.id,
        tenderId,
        tenderVersionId: authority.version!.id,
      },
    });
    await transaction.controlledReviewPackageInputSnapshot.create({
      data: {
        canonicalRenderTimestamp: now,
        checklistGenerationRunId: snapshot.checklistGenerationRunId,
        contentPolicyVersion: CONTROLLED_REVIEW_PACKAGE_CONTENT_POLICY_VERSION,
        draftApproverRoleAtAction:
          draft.qualifyingReviewEvent.actorRoleAtAction!,
        draftApprovalReviewEventId: draft.qualifyingReviewEventId,
        draftCreatorUserId: draft.draftCreatorUserId,
        draftVersionId: draft.draftVersionId,
        earlyRiskRunId: snapshot.earlyRiskRunId,
        eligibilityAssessmentRunId: snapshot.eligibilityAssessmentRunId,
        eligibilityInputSnapshotId: snapshot.eligibilityInputSnapshotId,
        extractionRunId: snapshot.extractionRunId,
        finalReadinessDecisionId: authority.decision!.id,
        finalReadinessRunId: readiness.id,
        finalReadinessSnapshotId: snapshot.id,
        finalRiskRunId: readiness.finalRiskRun!.id,
        generationPolicyVersion: CONTROLLED_REVIEW_PACKAGE_POLICY_VERSION,
        inputFingerprint,
        organisationId,
        pursuitDecisionId: snapshot.pursuitDecisionId,
        runId: run.id,
        templateVersionId: template.id,
        tenderId,
        tenderVersionId: authority.version!.id,
        documents: {
          create: snapshot.documents.map((document) => ({
            checksum: document.checksum,
            organisationId,
            sourceIdentifier: document.sourceIdentifier,
            tenderDocumentId: document.tenderDocumentId,
            tenderId,
          })),
        },
        provenance: {
          create: this.snapshotProvenance(
            readiness.findings,
            draft.draftVersionId,
            organisationId,
            tenderId,
          ),
        },
      },
    });
    await transaction.auditEvent.create({
      data: audit(
        retryOfRunId === undefined
          ? "CONTROLLED_PACKAGE_GENERATION_REQUESTED"
          : "CONTROLLED_PACKAGE_REGENERATED",
        organisationId,
        userId,
        run.id,
        requestId,
        "SUCCESS",
        { generationStatus: "QUEUED", roleAtAction: membership.role },
      ),
    });
    return run;
  }

  public async current(
    organisationId: string,
    tenderId: string,
    versionId: string,
  ): Promise<unknown> {
    const version = await this.database.tenderVersion.findFirst({
      select: { currentControlledPackageRunId: true },
      where: { id: versionId, tender: { id: tenderId, organisationId } },
    });
    if (version === null) throw new NotFoundException();
    return {
      package:
        version.currentControlledPackageRunId === null
          ? null
          : await this.detail(
              organisationId,
              tenderId,
              version.currentControlledPackageRunId,
            ),
    };
  }

  public async history(
    organisationId: string,
    tenderId: string,
    versionId: string,
    pagination: Pagination,
  ): Promise<unknown> {
    const rows = await this.database.controlledReviewPackageRun.findMany({
      orderBy: { createdAt: "desc" },
      skip: pagination.cursor === undefined ? 0 : 1,
      take: pagination.limit + 1,
      ...(pagination.cursor === undefined
        ? {}
        : { cursor: { id: pagination.cursor } }),
      where: { organisationId, tenderId, tenderVersionId: versionId },
    });
    return {
      items: await Promise.all(
        rows
          .slice(0, pagination.limit)
          .map(({ id }) => this.summary(organisationId, tenderId, id)),
      ),
      next_cursor:
        rows.length > pagination.limit
          ? (rows[pagination.limit - 1]?.id ?? null)
          : null,
    };
  }

  public async detail(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    const run = await this.run(organisationId, tenderId, runId);
    const summary = await this.summary(organisationId, tenderId, runId);
    const artifact = await this.database.packageArtifact.findFirst({
      select: { id: true },
      where: { organisationId, runId, tenderId },
    });
    return {
      ...summary,
      artifact_id: artifact?.id ?? null,
      failure_code: run.safeFailureCode,
      input_fingerprint: run.inputFingerprint,
      logical_content_fingerprint: run.logicalContentFingerprint,
      retry_of_run_id: run.retryOfRunId,
      template_version_id: run.templateVersionId,
    };
  }

  public async progress(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    const run = await this.run(organisationId, tenderId, runId);
    const events = [
      ["GENERATION_REQUESTED", run.queuedAt],
      ["GENERATION_STARTED", run.startedAt],
      ["GENERATION_COMPLETED", run.generatedAt],
      ["GENERATION_FAILED", run.failedAt],
      ["CANCELLED", run.cancelledAt],
      ["INVALIDATED", run.invalidatedAt],
    ] as const;
    return {
      events: events
        .filter((entry) => entry[1] !== null)
        .map(([event, date]) => ({ event, occurred_at: date!.toISOString() })),
    };
  }

  public async manifest(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    const run = await this.database.controlledReviewPackageRun.findFirst({
      include: {
        inputSnapshot: true,
        manifest: { include: { members: true } },
      },
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    if (run.manifest === null || run.inputSnapshot === null)
      throw packageError(
        "CONTROLLED_PACKAGE_NOT_GENERATED",
        "The package manifest is not available.",
      );
    return {
      approved_draft_version_id: run.inputSnapshot.draftVersionId,
      generated_at: run.manifest.generatedAt.toISOString(),
      generation_policy_version: run.generationPolicyVersion,
      logical_content_fingerprint: run.manifest.logicalContentFingerprint,
      members: run.manifest.members.map((member) => ({
        byte_size: Number(member.byteSize),
        kind: member.kind,
        logical_path: member.logicalPath,
        mime_type: member.mimeType,
        sha256: member.sha256,
      })),
      organisation_id: organisationId,
      package_id: run.id,
      phase_11_decision_id: run.inputSnapshot.finalReadinessDecisionId,
      phase_11_readiness_run_id: run.inputSnapshot.finalReadinessRunId,
      schema_version: run.manifest.schemaVersion,
      template_version_id: run.templateVersionId,
      tender_id: tenderId,
      tender_version_id: run.tenderVersionId,
      warnings: [],
    };
  }

  public async provenance(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    const run = await this.database.controlledReviewPackageRun.findFirst({
      include: {
        inputSnapshot: { include: { provenance: true } },
        manifest: true,
      },
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    if (run.manifest === null || run.inputSnapshot === null)
      throw packageError(
        "CONTROLLED_PACKAGE_NOT_GENERATED",
        "Package provenance is not available.",
      );
    return {
      items: run.inputSnapshot.provenance.map((item) => ({
        handle: item.safeHandle,
        record_id: provenanceRecordId(item),
        type: item.kind,
      })),
      package_id: run.id,
    };
  }

  public async cancel(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    rationale: string,
    requestId: string,
  ): Promise<unknown> {
    return this.database.$transaction(async (transaction) => {
      const run = await transaction.controlledReviewPackageRun.findFirst({
        where: { id: runId, organisationId, tenderId },
      });
      if (run === null) throw new NotFoundException();
      if (run.generationStatus === "CANCELLED") return startResponse(run);
      if (!canCancelControlledPackage(run.generationStatus))
        throw packageError(
          "CONTROLLED_PACKAGE_NOT_RETRYABLE",
          "The package cannot be cancelled in its current state.",
        );
      const now = new Date();
      const updated = await transaction.controlledReviewPackageRun.update({
        data:
          run.generationStatus === "QUEUED"
            ? {
                cancelledAt: now,
                cancellationRequestedAt: now,
                generationStatus: "CANCELLED",
              }
            : { cancellationRequestedAt: now },
        where: { id: run.id },
      });
      await transaction.auditEvent.create({
        data: audit(
          "CONTROLLED_PACKAGE_CANCELLED",
          organisationId,
          userId,
          run.id,
          requestId,
          "SUCCESS",
          { rationale: rationale.slice(0, 2000) },
        ),
      });
      return startResponse(updated);
    });
  }

  public async retry(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    idempotencyKey: string,
    rationale: string,
    requestId: string,
  ): Promise<unknown> {
    const prior = await this.run(organisationId, tenderId, runId);
    if (
      !canRetryControlledPackage(prior.generationStatus) &&
      !canRegenerateControlledPackage(
        prior.generationStatus,
        prior.reviewStatus,
      )
    )
      throw packageError(
        "CONTROLLED_PACKAGE_NOT_RETRYABLE",
        "The package cannot be regenerated in its current state.",
      );
    void rationale;
    return this.start(
      organisationId,
      tenderId,
      userId,
      idempotencyKey,
      requestId,
      prior.id,
    );
  }

  public async review(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    role: OrganisationRole,
    input: ReviewInput,
    requestId: string,
  ): Promise<unknown> {
    const current = await this.freshness.evaluate(
      organisationId,
      tenderId,
      runId,
    );
    if (!current.fresh)
      throw packageError(
        "CONTROLLED_PACKAGE_STALE",
        "The package is no longer current.",
      );
    return this.database.$transaction(
      async (transaction) => {
        const run = await transaction.controlledReviewPackageRun.findFirst({
          where: { id: runId, organisationId, tenderId },
        });
        if (run === null) throw new NotFoundException();
        if (
          !canReviewControlledPackage(
            run.generationStatus,
            current.freshness,
            run.reviewStatus,
          )
        )
          throw packageError(
            "CONTROLLED_PACKAGE_REVIEW_REQUIRED",
            "The package is not reviewable.",
          );
        if (run.reviewVersion !== input.expected_review_version)
          throw packageError(
            "CONTROLLED_PACKAGE_CONCURRENCY_CONFLICT",
            "The package review version changed.",
          );
        const nextVersion = run.reviewVersion + 1;
        const [review, reviewer] = await Promise.all([
          transaction.packageReview.create({
            data: {
              comment: input.comment,
              organisationId,
              outcome: input.outcome,
              reviewerRoleAtAction: role as Role,
              reviewerUserId: userId,
              reviewVersion: nextVersion,
              runId,
              tenderId,
            },
          }),
          transaction.user.findFirst({
            select: { displayName: true, id: true },
            where: { id: userId },
          }),
        ]);
        if (reviewer === null) throw new NotFoundException();
        await transaction.controlledReviewPackageRun.update({
          data: { reviewStatus: "IN_REVIEW", reviewVersion: nextVersion },
          where: { id: runId },
        });
        await transaction.auditEvent.create({
          data: audit(
            "CONTROLLED_PACKAGE_REVIEWED",
            organisationId,
            userId,
            runId,
            requestId,
            "SUCCESS",
            {
              outcome: input.outcome,
              reviewVersion: nextVersion,
              roleAtAction: role,
            },
          ),
        });
        return this.reviewResponse(review, reviewer);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async reviews(
    organisationId: string,
    tenderId: string,
    runId: string,
    pagination: Pagination,
  ): Promise<unknown> {
    await this.run(organisationId, tenderId, runId);
    const rows = await this.database.packageReview.findMany({
      orderBy: { reviewVersion: "asc" },
      skip: pagination.cursor === undefined ? 0 : 1,
      take: pagination.limit + 1,
      ...(pagination.cursor === undefined
        ? {}
        : { cursor: { id: pagination.cursor } }),
      where: { organisationId, runId, tenderId },
    });
    const users = await this.users(rows.map((row) => row.reviewerUserId));
    return {
      items: rows
        .slice(0, pagination.limit)
        .map((row) => this.reviewResponse(row, users.get(row.reviewerUserId)!)),
      next_cursor:
        rows.length > pagination.limit
          ? (rows[pagination.limit - 1]?.id ?? null)
          : null,
    };
  }

  public async decide(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    role: OrganisationRole,
    input: DecisionInput,
    requestId: string,
  ): Promise<unknown> {
    const freshness = await this.freshness.evaluate(
      organisationId,
      tenderId,
      runId,
    );
    if (!freshness.fresh)
      throw packageError(
        "CONTROLLED_PACKAGE_STALE",
        "The package is no longer current.",
      );
    return this.database.$transaction(
      async (transaction) => {
        const run = await transaction.controlledReviewPackageRun.findFirst({
          include: { artifacts: true, inputSnapshot: true, manifest: true },
          where: { id: runId, organisationId, tenderId },
        });
        if (run?.inputSnapshot === null || run === null)
          throw new NotFoundException();
        const membership = await activeMembership(
          transaction,
          organisationId,
          userId,
        );
        const artifact = run.artifacts[0];
        const packageReviewable =
          run.generationStatus === "GENERATED" &&
          run.manifest !== null &&
          artifact !== undefined &&
          artifact.integrityVerifiedAt !== null &&
          artifact.malwareStatus === "CLEAN" &&
          artifact.promotionStatus === "PROMOTED";
        const actorRoleAtAction =
          membership?.role === "PLATFORM_ADMIN"
            ? null
            : (membership?.role ?? null);
        const denials = controlledPackageApprovalDenials({
          actorRoleAtAction,
          actorUserId: userId,
          activeMembership: membership !== null,
          draftCreatorUserId: run.inputSnapshot.draftCreatorUserId,
          fingerprintCurrent:
            input.expected_fingerprint === run.inputFingerprint,
          packageReviewable,
          requesterUserId: run.requestedByUserId,
          reviewVersionCurrent:
            input.expected_review_version === run.reviewVersion,
        });
        if (denials.length > 0)
          throw packageError(
            denials.some((denial) => denial.endsWith("CANNOT_APPROVE"))
              ? "CONTROLLED_PACKAGE_SEPARATION_OF_DUTIES_REQUIRED"
              : "CONTROLLED_PACKAGE_APPROVAL_BLOCKED",
            "Controlled-download approval is blocked.",
          );
        const existing = await transaction.packageApproval.findFirst({
          where: {
            outcome: "APPROVED_FOR_CONTROLLED_DOWNLOAD",
            revokedAt: null,
            runId,
            supersededAt: null,
          },
        });
        if (existing !== null)
          throw packageError(
            "CONTROLLED_PACKAGE_APPROVAL_BLOCKED",
            "An effective approval already exists.",
          );
        const [approval, approver] = await Promise.all([
          transaction.packageApproval.create({
            data: {
              actorRoleAtAction: role as Role,
              actorUserId: userId,
              organisationId,
              outcome: input.outcome,
              rationale: input.rationale,
              reviewVersion: run.reviewVersion,
              runFingerprint: run.inputFingerprint,
              runId,
              tenderId,
            },
          }),
          transaction.user.findFirst({
            select: { displayName: true, id: true },
            where: { id: userId },
          }),
        ]);
        if (approver === null) throw new NotFoundException();
        if (input.outcome === "APPROVED_FOR_CONTROLLED_DOWNLOAD") {
          const version = await transaction.tenderVersion.findFirst({
            select: { currentControlledPackageRunId: true },
            where: {
              id: run.tenderVersionId,
              tender: { id: tenderId, organisationId },
            },
          });
          if (version === null) throw new NotFoundException();
          const priorRunId = version.currentControlledPackageRunId;
          if (priorRunId !== null && priorRunId !== runId) {
            const supersededAt = new Date();
            await transaction.controlledReviewPackageRun.updateMany({
              data: { reviewStatus: "SUPERSEDED", supersededAt },
              where: { id: priorRunId, organisationId, tenderId },
            });
            await transaction.packageApproval.updateMany({
              data: { supersededAt },
              where: {
                outcome: "APPROVED_FOR_CONTROLLED_DOWNLOAD",
                revokedAt: null,
                runId: priorRunId,
                supersededAt: null,
              },
            });
            await transaction.packageDownloadGrant.updateMany({
              data: { invalidatedAt: supersededAt },
              where: { invalidatedAt: null, runId: priorRunId },
            });
          }
          await transaction.tenderVersion.update({
            data: { currentControlledPackageRunId: runId },
            where: { id: run.tenderVersionId },
          });
        }
        await transaction.controlledReviewPackageRun.update({
          data: {
            reviewStatus:
              input.outcome === "APPROVED_FOR_CONTROLLED_DOWNLOAD"
                ? "APPROVED"
                : "REJECTED",
          },
          where: { id: runId },
        });
        await transaction.auditEvent.create({
          data: audit(
            input.outcome === "APPROVED_FOR_CONTROLLED_DOWNLOAD"
              ? "CONTROLLED_PACKAGE_APPROVED"
              : "CONTROLLED_PACKAGE_REJECTED",
            organisationId,
            userId,
            runId,
            requestId,
            "SUCCESS",
            { outcome: input.outcome, roleAtAction: role },
          ),
        });
        return approvalResponse(approval, approver);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async decisions(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    await this.run(organisationId, tenderId, runId);
    const rows = await this.database.packageApproval.findMany({
      orderBy: { createdAt: "asc" },
      take: 100,
      where: { organisationId, runId, tenderId },
    });
    const users = await this.users(rows.map((row) => row.actorUserId));
    return {
      items: rows.map((row) =>
        approvalResponse(row, users.get(row.actorUserId)!),
      ),
    };
  }

  public async revoke(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    role: OrganisationRole,
    input: RevocationInput,
    requestId: string,
  ): Promise<unknown> {
    if (!hasPermission(role, "TENDER_CONTROLLED_PACKAGE_REVOKE"))
      throw new NotFoundException();
    return this.database.$transaction(async (transaction) => {
      const approval = await transaction.packageApproval.findFirst({
        where: {
          organisationId,
          outcome: "APPROVED_FOR_CONTROLLED_DOWNLOAD",
          revokedAt: null,
          runId,
          supersededAt: null,
          tenderId,
        },
      });
      if (approval === null)
        throw packageError(
          "CONTROLLED_PACKAGE_REVOKED",
          "No effective package approval exists.",
        );
      const now = new Date();
      const updated = await transaction.packageApproval.update({
        data: { revocationReason: input.reason, revokedAt: now },
        where: { id: approval.id },
      });
      await transaction.controlledReviewPackageRun.update({
        data: { reviewStatus: "REVOKED" },
        where: { id: runId },
      });
      await transaction.packageDownloadGrant.updateMany({
        data: { revokedAt: now },
        where: { revokedAt: null, runId },
      });
      await transaction.tenderVersion.updateMany({
        data: { currentControlledPackageRunId: null },
        where: { currentControlledPackageRunId: runId },
      });
      await transaction.auditEvent.create({
        data: audit(
          "CONTROLLED_PACKAGE_REVOKED",
          organisationId,
          userId,
          runId,
          requestId,
          "SUCCESS",
          {
            rationale: input.rationale,
            reason: input.reason,
            roleAtAction: role,
          },
        ),
      });
      return approvalResponse(updated, {
        displayName: "Approver",
        id: updated.actorUserId,
      });
    });
  }

  public async grant(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    role: OrganisationRole,
    input: { readonly artifact_id: string },
    requestId: string,
  ): Promise<unknown> {
    const freshness = await this.freshness.evaluate(
      organisationId,
      tenderId,
      runId,
    );
    if (!freshness.fresh)
      throw packageError(
        "CONTROLLED_PACKAGE_STALE",
        "The package is no longer current.",
      );
    return this.database.$transaction(
      async (transaction) => {
        const run = await transaction.controlledReviewPackageRun.findFirst({
          include: {
            artifacts: { where: { id: input.artifact_id } },
            approvals: {
              where: {
                outcome: "APPROVED_FOR_CONTROLLED_DOWNLOAD",
                revokedAt: null,
                supersededAt: null,
              },
            },
            tenderVersion: { select: { currentControlledPackageRunId: true } },
          },
          where: { id: runId, organisationId, tenderId },
        });
        if (run === null) throw new NotFoundException();
        const artifact = run.artifacts[0];
        if (artifact === undefined)
          throw packageError(
            "CONTROLLED_PACKAGE_ARTIFACT_UNAVAILABLE",
            "The package artifact is unavailable.",
          );
        if (
          !isControlledPackageDownloadEligible({
            artifactAvailable: artifact.promotionStatus === "PROMOTED",
            checksumVerified: artifact.integrityVerifiedAt !== null,
            freshness: freshness.freshness,
            generationStatus: run.generationStatus,
            malwareCleared: artifact.malwareStatus === "CLEAN",
            reviewStatus: run.reviewStatus,
          }) ||
          run.approvals.length !== 1 ||
          run.tenderVersion.currentControlledPackageRunId !== runId
        )
          throw packageError(
            "CONTROLLED_PACKAGE_DOWNLOAD_NOT_AUTHORISED",
            "The package is not authorised for controlled download.",
          );
        const issuedAt = new Date();
        const expiresAt = new Date(issuedAt.getTime() + 60_000);
        const grant = await transaction.packageDownloadGrant.create({
          data: {
            artifactChecksum: artifact.sha256,
            artifactId: artifact.id,
            expiresAt,
            issuedAt,
            organisationId,
            requestId,
            requestedByUserId: userId,
            requesterRoleAtAction: role as Role,
            runFingerprint: run.inputFingerprint,
            runId,
            tenderId,
          },
        });
        await transaction.auditEvent.create({
          data: audit(
            "CONTROLLED_PACKAGE_DOWNLOAD_GRANT_ISSUED",
            organisationId,
            userId,
            runId,
            requestId,
            "SUCCESS",
            { artifactId: artifact.id, grantId: grant.id, roleAtAction: role },
          ),
        });
        return {
          artifact_id: artifact.id,
          download_path: `${packagePath(organisationId, tenderId, runId)}/download-grants/${grant.id}`,
          expires_at: expiresAt.toISOString(),
          grant_id: grant.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async redeem(
    organisationId: string,
    tenderId: string,
    runId: string,
    grantId: string,
    userId: string,
  ): Promise<unknown> {
    if (this.storage === undefined || this.environment === undefined)
      throw packageError(
        "CONTROLLED_PACKAGE_ARTIFACT_UNAVAILABLE",
        "The package artifact is unavailable.",
      );
    const now = new Date();
    const grant = await this.database.packageDownloadGrant.findFirst({
      include: {
        artifact: true,
        run: { include: { tenderVersion: true } },
      },
      where: {
        id: grantId,
        organisationId,
        requestedByUserId: userId,
        runId,
        tenderId,
      },
    });
    const valid =
      grant !== null &&
      grant.expiresAt > now &&
      grant.invalidatedAt === null &&
      grant.revokedAt === null &&
      grant.run.generationStatus === "GENERATED" &&
      grant.run.reviewStatus === "APPROVED" &&
      grant.run.invalidatedAt === null &&
      grant.run.staleAt === null &&
      grant.run.supersededAt === null &&
      grant.run.tenderVersion.currentControlledPackageRunId === runId &&
      grant.run.inputFingerprint === grant.runFingerprint &&
      grant.artifact.sha256 === grant.artifactChecksum &&
      grant.artifact.integrityVerifiedAt !== null &&
      grant.artifact.malwareStatus === "CLEAN" &&
      grant.artifact.promotionStatus === "PROMOTED";
    if (!valid || grant === null)
      throw packageError(
        "CONTROLLED_PACKAGE_DOWNLOAD_NOT_AUTHORISED",
        "The controlled download is not authorised.",
      );
    const expiresAt = new Date(now.getTime() + 60_000);
    const downloadUrl = await getSignedUrl(
      this.storage,
      new GetObjectCommand({
        Bucket: this.environment.S3_BUCKET,
        Key: grant.artifact.privateObjectKey,
        ResponseContentDisposition: `attachment; filename="${grant.artifact.safeFilename}"`,
        ResponseContentType: "application/zip",
      }),
      { expiresIn: 60 },
    );
    return {
      download_url: downloadUrl,
      expires_at: expiresAt.toISOString(),
      expires_in_seconds: 60,
    };
  }

  public async audit(
    organisationId: string,
    tenderId: string,
    pagination: Pagination,
  ): Promise<unknown> {
    const packageRuns = await this.database.controlledReviewPackageRun.findMany(
      {
        select: { id: true },
        where: { organisationId, tenderId },
      },
    );
    const rows = await this.database.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      skip: pagination.cursor === undefined ? 0 : 1,
      take: pagination.limit + 1,
      ...(pagination.cursor === undefined
        ? {}
        : { cursor: { id: pagination.cursor } }),
      where: {
        eventType: { in: [...CONTROLLED_AUDIT_EVENTS] },
        organisationId,
        subjectId: { in: [tenderId, ...packageRuns.map(({ id }) => id)] },
      },
    });
    const users = await this.users(
      rows.flatMap((row) =>
        row.actorUserId === null ? [] : [row.actorUserId],
      ),
    );
    return {
      items: rows.slice(0, pagination.limit).map((row) => ({
        actor:
          row.actorUserId === null
            ? null
            : actor(users.get(row.actorUserId)!, undefined),
        created_at: row.createdAt.toISOString(),
        event_type: row.eventType,
        id: row.id,
        request_id: row.requestId ?? "unknown",
        run_id:
          row.subjectType === "ControlledReviewPackageRun"
            ? row.subjectId
            : null,
        safe_code:
          typeof row.metadata === "object" &&
          row.metadata !== null &&
          !Array.isArray(row.metadata) &&
          "safeCode" in row.metadata &&
          typeof row.metadata.safeCode === "string"
            ? row.metadata.safeCode
            : null,
      })),
      next_cursor:
        rows.length > pagination.limit
          ? (rows[pagination.limit - 1]?.id ?? null)
          : null,
    };
  }

  private async replay(
    organisationId: string,
    tenderId: string,
    run: {
      id: string;
      inputFingerprint: string;
      generationStatus: string;
      createdAt: Date;
    },
  ): Promise<unknown> {
    const freshness = await this.freshness.evaluate(
      organisationId,
      tenderId,
      run.id,
    );
    if (!freshness.fresh)
      throw packageError(
        "CONTROLLED_PACKAGE_IDEMPOTENCY_CONFLICT",
        "The idempotency key belongs to changed authoritative inputs.",
      );
    return startResponse(run);
  }

  private async summary(
    organisationId: string,
    tenderId: string,
    runId: string,
  ) {
    const run = await this.database.controlledReviewPackageRun.findFirst({
      include: {
        requestedBy: { select: { displayName: true, id: true } },
        tenderVersion: { select: { currentControlledPackageRunId: true } },
      },
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    const freshness = await this.freshness.evaluate(
      organisationId,
      tenderId,
      runId,
    );
    return {
      created_at: run.createdAt.toISOString(),
      freshness: freshness.freshness,
      generation_status: run.generationStatus,
      id: run.id,
      is_current: run.tenderVersion.currentControlledPackageRunId === run.id,
      policy_version: run.generationPolicyVersion,
      requested_by: actor(run.requestedBy, run.requesterRoleAtAction),
      review_status: run.reviewStatus,
      stale_at: run.staleAt?.toISOString() ?? null,
      tender_version_id: run.tenderVersionId,
      updated_at: run.updatedAt.toISOString(),
    };
  }

  private run(organisationId: string, tenderId: string, runId: string) {
    return this.database.controlledReviewPackageRun
      .findFirst({ where: { id: runId, organisationId, tenderId } })
      .then((run) => {
        if (run === null) throw new NotFoundException();
        return run;
      });
  }

  private async users(userIds: readonly string[]) {
    const rows = await this.database.user.findMany({
      select: { displayName: true, id: true },
      where: { id: { in: [...new Set(userIds)] } },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private reviewResponse(
    review: {
      id: string;
      comment: string;
      createdAt: Date;
      outcome: ControlledPackageReviewOutcome;
      reviewerRoleAtAction: Role;
      reviewVersion: number;
    },
    user: { displayName: string; id: string },
  ) {
    return {
      actor: actor(user, review.reviewerRoleAtAction),
      comment: review.comment,
      created_at: review.createdAt.toISOString(),
      id: review.id,
      outcome: review.outcome,
      review_version: review.reviewVersion,
    };
  }

  private snapshotProvenance(
    findings: readonly {
      id: string;
      provenance: readonly Record<string, unknown>[];
    }[],
    draftVersionId: string,
    organisationId: string,
    tenderId: string,
  ) {
    const rows: Prisma.ControlledPackageSnapshotProvenanceCreateWithoutSnapshotInput[] =
      [
        {
          kind: "DRAFT_VERSION",
          organisationId,
          safeHandle: `DRAFT_VERSION:${draftVersionId}`,
          tenderId,
          draftVersionId,
        },
      ];
    for (const finding of findings)
      rows.push({
        finalReadinessFindingId: finding.id,
        kind: "FINAL_READINESS_FINDING",
        organisationId,
        safeHandle: `FINAL_READINESS_FINDING:${finding.id}`,
        tenderId,
      });
    return rows;
  }

  private prerequisites(
    authority: Awaited<
      ReturnType<ControlledReviewPackageService["loadAuthority"]>
    >,
  ) {
    const readiness = authority.readiness;
    return evaluateControlledPackagePrerequisites({
      activeRunExists: authority.activeRun !== null,
      approvedDraftPinned: authority.draft !== undefined,
      exportTemplateApproved: authority.template !== null,
      facts: [],
      finalRiskRunComplete: readiness?.finalRiskRun?.status === "COMPLETE",
      finalRiskRunCurrent: readiness?.finalRiskRun?.invalidatedAt === null,
      inputFingerprintCurrent:
        readiness?.inputSnapshot?.fingerprint === readiness?.inputFingerprint,
      proceedDecisionCurrent:
        authority.decision?.disposition ===
        "PROCEED_TO_CONTROLLED_EXPORT_REVIEW",
      proceedDecisionUnsuperseded: authority.decision?.supersededAt === null,
      readinessRunComplete: readiness?.status === "COMPLETED",
      readinessRunCurrent:
        authority.version?.activeFinalReadinessRunId === readiness?.id,
      readinessRunInvalidated: readiness?.invalidatedAt !== null,
      sourceHashesAvailable:
        (readiness?.inputSnapshot?.documents.length ?? 0) > 0 &&
        readiness!.inputSnapshot!.documents.every(({ checksum }) =>
          /^[a-f0-9]{64}$/.test(checksum),
        ),
    });
  }

  private async loadAuthority(
    database: Database,
    organisationId: string,
    tenderId: string,
    userId: string,
  ) {
    const [membership, tender] = await Promise.all([
      activeMembership(database, organisationId, userId),
      database.tender.findFirst({
        select: { currentVersionId: true },
        where: { id: tenderId, organisationId },
      }),
    ]);
    if (membership === null || tender === null) throw new NotFoundException();
    const version =
      tender.currentVersionId === null
        ? null
        : await database.tenderVersion.findFirst({
            select: { activeFinalReadinessRunId: true, id: true },
            where: { id: tender.currentVersionId, tenderId },
          });
    const readiness =
      version?.activeFinalReadinessRunId === null ||
      version?.activeFinalReadinessRunId === undefined
        ? null
        : await database.finalReadinessRun.findFirst({
            include: {
              decisions: {
                orderBy: { createdAt: "desc" },
                where: { supersededAt: null },
              },
              finalRiskRun: true,
              findings: { include: { provenance: true } },
              inputSnapshot: {
                include: {
                  documents: true,
                  requiredDrafts: { include: { qualifyingReviewEvent: true } },
                },
              },
            },
            where: {
              id: version.activeFinalReadinessRunId,
              organisationId,
              tenderId,
            },
          });
    const draft = readiness?.inputSnapshot?.requiredDrafts[0];
    const exportTemplate = await database.exportTemplate.findFirst({
      include: { activeVersion: true },
      where: {
        activeVersion: { approvedAt: { not: null }, retiredAt: null },
        retiredAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    const activeRun =
      version === null
        ? null
        : await database.controlledReviewPackageRun.findFirst({
            where: {
              generationStatus: { in: ["QUEUED", "PROCESSING"] },
              organisationId,
              tenderId,
              tenderVersionId: version.id,
            },
          });
    return {
      activeRun,
      decision: readiness?.decisions[0] ?? null,
      draft,
      membership,
      readiness,
      template: exportTemplate?.activeVersion ?? null,
      tender,
      version,
    };
  }
}

const CONTROLLED_AUDIT_EVENTS = [
  "CONTROLLED_PACKAGE_PREFLIGHT_EVALUATED",
  "CONTROLLED_PACKAGE_GENERATION_REQUESTED",
  "CONTROLLED_PACKAGE_GENERATION_STARTED",
  "CONTROLLED_PACKAGE_GENERATION_COMPLETED",
  "CONTROLLED_PACKAGE_GENERATION_FAILED",
  "CONTROLLED_PACKAGE_CANCELLED",
  "CONTROLLED_PACKAGE_REGENERATED",
  "CONTROLLED_PACKAGE_REVIEWED",
  "CONTROLLED_PACKAGE_APPROVED",
  "CONTROLLED_PACKAGE_REJECTED",
  "CONTROLLED_PACKAGE_INVALIDATED",
  "CONTROLLED_PACKAGE_REVOKED",
  "CONTROLLED_PACKAGE_DOWNLOAD_GRANT_ISSUED",
] as const;

function activeMembership(
  database: Database,
  organisationId: string,
  userId: string,
) {
  return database.organisationMembership.findFirst({
    select: { id: true, role: true },
    where: { organisationId, revokedAt: null, userId },
  });
}
function packagePath(
  organisationId: string,
  tenderId: string,
  runId: string,
): string {
  return `/organisations/${organisationId}/tenders/${tenderId}/controlled-review-packages/${runId}`;
}
function issue(
  treatment:
    | "HARD_GENERATION_BLOCKER"
    | "PACKAGE_WARNING"
    | "REVIEW_BLOCKER"
    | "DOWNLOAD_BLOCKER",
) {
  return (code: string) => ({ code, treatment });
}
function totalIssues(result: {
  hardGenerationBlockers: readonly string[];
  packageWarnings: readonly string[];
  reviewBlockers: readonly string[];
  downloadBlockers: readonly string[];
}): number {
  return (
    result.hardGenerationBlockers.length +
    result.packageWarnings.length +
    result.reviewBlockers.length +
    result.downloadBlockers.length
  );
}
function startResponse(run: {
  id: string;
  generationStatus: string;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    created_at: run.createdAt.toISOString(),
    package_id: run.id,
    status: run.generationStatus,
  };
}
function actor(
  user: { displayName: string; id: string },
  role?: Role,
): Record<string, unknown> {
  return role === undefined
    ? { display_name: user.displayName, user_id: user.id }
    : {
        display_name: user.displayName,
        role_at_action: role,
        user_id: user.id,
      };
}
function approvalResponse(
  approval: {
    actorRoleAtAction: Role;
    createdAt: Date;
    id: string;
    outcome: ControlledPackageApprovalOutcome;
    rationale: string;
    revokedAt: Date | null;
    supersededAt: Date | null;
  },
  user: { displayName: string; id: string },
): Record<string, unknown> {
  return {
    actor: actor(user, approval.actorRoleAtAction),
    created_at: approval.createdAt.toISOString(),
    id: approval.id,
    outcome: approval.outcome,
    rationale: approval.rationale,
    revoked_at: approval.revokedAt?.toISOString() ?? null,
    superseded_at: approval.supersededAt?.toISOString() ?? null,
  };
}
function packageError(
  code:
    | "CONTROLLED_PACKAGE_ALREADY_ACTIVE"
    | "CONTROLLED_PACKAGE_APPROVAL_BLOCKED"
    | "CONTROLLED_PACKAGE_ARTIFACT_UNAVAILABLE"
    | "CONTROLLED_PACKAGE_CONCURRENCY_CONFLICT"
    | "CONTROLLED_PACKAGE_DOWNLOAD_NOT_AUTHORISED"
    | "CONTROLLED_PACKAGE_IDEMPOTENCY_CONFLICT"
    | "CONTROLLED_PACKAGE_NOT_GENERATED"
    | "CONTROLLED_PACKAGE_NOT_RETRYABLE"
    | "CONTROLLED_PACKAGE_PREREQUISITES_NOT_CURRENT"
    | "CONTROLLED_PACKAGE_PROCEED_DECISION_REQUIRED"
    | "CONTROLLED_PACKAGE_REVIEW_REQUIRED"
    | "CONTROLLED_PACKAGE_REVOKED"
    | "CONTROLLED_PACKAGE_SEPARATION_OF_DUTIES_REQUIRED"
    | "CONTROLLED_PACKAGE_STALE",
  message: string,
): ControlledReviewPackageError {
  return new ControlledReviewPackageError(code, message, HttpStatus.CONFLICT);
}
function audit(
  eventType: (typeof CONTROLLED_AUDIT_EVENTS)[number],
  organisationId: string,
  actorUserId: string,
  subjectId: string,
  requestId: string,
  outcome: string,
  metadata: Record<string, unknown>,
): Prisma.AuditEventUncheckedCreateInput {
  return {
    actorUserId,
    eventType,
    metadata: { ...metadata, tenderId: subjectId },
    organisationId,
    outcome,
    requestId,
    subjectId,
    subjectType: "ControlledReviewPackageRun",
  };
}
function provenanceRecordId(item: Record<string, unknown>): string {
  for (const key of [
    "tenderDocumentId",
    "extractionCitationId",
    "riskFindingId",
    "eligibilityAssessmentId",
    "evidenceFactVersionId",
    "evidenceCitationId",
    "checklistItemId",
    "draftVersionId",
    "draftClaimId",
    "draftCitationId",
    "finalReadinessFindingId",
  ]) {
    const value = item[key];
    if (typeof value === "string") return value;
  }
  throw packageError(
    "CONTROLLED_PACKAGE_PROVENANCE_LIMIT_EXCEEDED" as never,
    "Package provenance is invalid.",
  );
}
function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}
function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
