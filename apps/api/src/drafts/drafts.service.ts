import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  type MessageEvent,
} from "@nestjs/common";
import type { ApiEnvironment } from "@tender/config";
import type {
  CreateDraftHumanInputRequest,
  CreateDraftTemplateRequest,
  CreateDraftTemplateVersionRequest,
  DraftReviewActionRequest,
  DraftTypeRequest,
  EditDraftVersionRequest,
  ResolveDraftPlaceholderRequest,
  ReviewDraftHumanInputRequest,
  StartDraftGenerationRequest,
} from "@tender/contracts";
import type { Prisma, PrismaClient } from "@tender/database";
import {
  DRAFTING_POLICY_VERSION,
  DRAFT_PROMPT_POLICY_VERSION,
  DRAFT_TEMPLATE_POLICY_VERSION,
  draftApprovalBlockers,
  draftSourceFingerprint,
  evaluateDraftStartGate,
  isUnsafeDraftInstruction,
  validateTemplateSections,
  visiblePlaceholder,
} from "@tender/domain";
import type { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { Observable, concat, from, interval, takeUntil } from "rxjs";
import {
  API_ENVIRONMENT,
  JOB_QUEUE,
  PRISMA_CLIENT,
} from "../infrastructure.tokens.js";

@Injectable()
export class DraftsService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(JOB_QUEUE) private readonly jobs: Queue,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  public templates(
    organisationId: string,
    draftType?: DraftTypeRequest,
  ): Promise<unknown> {
    return this.database.draftTemplate.findMany({
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 10,
        },
      },
      orderBy: { name: "asc" },
      where: {
        ...(draftType === undefined ? {} : { draftType }),
        OR: [{ organisationId: null }, { organisationId }],
        retiredAt: null,
      },
    });
  }

  public async template(
    organisationId: string,
    templateId: string,
  ): Promise<unknown> {
    const template = await this.database.draftTemplate.findFirst({
      include: { versions: { orderBy: { versionNumber: "desc" } } },
      where: {
        id: templateId,
        OR: [{ organisationId: null }, { organisationId }],
      },
    });
    if (template === null) throw new NotFoundException();
    return template;
  }

  public async createTemplate(
    organisationId: string,
    input: CreateDraftTemplateRequest,
    userId: string,
  ): Promise<unknown> {
    return this.database.draftTemplate.create({
      data: {
        createdByUserId: userId,
        draftType: input.draft_type,
        name: input.name,
        organisationId,
      },
    });
  }

  public async createTemplateVersion(
    organisationId: string,
    templateId: string,
    input: CreateDraftTemplateVersionRequest,
    userId: string,
  ): Promise<unknown> {
    const template = await this.database.draftTemplate.findFirst({
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      where: { id: templateId, organisationId, retiredAt: null },
    });
    if (template === null) throw new NotFoundException();
    const sections = input.sections.map((section) => ({
      allowedClaimClasses: section.allowed_claim_classes,
      formattingGuidance: section.formatting_guidance,
      heading: section.heading,
      key: section.key,
      order: section.order,
      requiredSourceClasses: section.required_source_classes,
    }));
    if (!validateTemplateSections(sections))
      throw new UnprocessableEntityException("Template sections are invalid");
    const sourceFingerprint = draftSourceFingerprint({
      policy: DRAFT_TEMPLATE_POLICY_VERSION,
      requiredReviewRole: input.required_review_role,
      sections,
      templateId,
    });
    return this.database.$transaction(async (transaction) => {
      const version = await transaction.draftTemplateVersion.create({
        data: {
          activatedAt: new Date(),
          createdByUserId: userId,
          requiredReviewRole: input.required_review_role,
          sections,
          sourceFingerprint,
          templateId,
          templatePolicyVersion: DRAFT_TEMPLATE_POLICY_VERSION,
          versionNumber: (template.versions[0]?.versionNumber ?? 0) + 1,
        },
      });
      await transaction.draftTemplateVersion.updateMany({
        data: { retiredAt: new Date() },
        where: { id: { not: version.id }, retiredAt: null, templateId },
      });
      await transaction.draftTemplate.update({
        data: { activeVersionId: version.id },
        where: { id: templateId },
      });
      return version;
    });
  }

  public async retireTemplate(
    organisationId: string,
    templateId: string,
  ): Promise<unknown> {
    const result = await this.database.draftTemplate.updateMany({
      data: { activeVersionId: null, retiredAt: new Date() },
      where: { id: templateId, organisationId, retiredAt: null },
    });
    if (result.count !== 1) throw new NotFoundException();
    return { retired: true };
  }

  public async startGeneration(
    organisationId: string,
    tenderId: string,
    input: StartDraftGenerationRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    if (
      input.instructions !== undefined &&
      isUnsafeDraftInstruction(input.instructions)
    )
      throw new UnprocessableEntityException(
        "Drafting instructions cannot expand source scope or invoke actions",
      );
    const tender = await this.database.tender.findFirst({
      include: {
        currentVersion: {
          include: {
            activeEarlyRiskRun: true,
            activeEligibilityAssessmentRun: {
              include: { snapshot: true },
            },
            activeExtractionRun: true,
          },
        },
      },
      where: { deletedAt: null, id: tenderId, organisationId },
    });
    const version = tender?.currentVersion;
    if (version === null || version === undefined)
      throw new NotFoundException();
    const extraction = version.activeExtractionRun;
    const risk = version.activeEarlyRiskRun;
    const assessment = version.activeEligibilityAssessmentRun;
    const decision =
      risk === null
        ? null
        : await this.database.earlyPursuitDecision.findFirst({
            orderBy: { createdAt: "desc" },
            where: {
              decision: "CONTINUE",
              organisationId,
              riskAnalysisRunId: risk.id,
              supersededAt: null,
              tenderId,
              tenderVersionId: version.id,
            },
          });
    const checklist =
      assessment === null
        ? null
        : await this.database.checklistGenerationRun.findFirst({
            orderBy: { activatedAt: "desc" },
            where: {
              activatedAt: { not: null },
              assessmentRunId: assessment.id,
              evidenceSnapshotId: assessment.snapshotId,
              invalidatedAt: null,
              organisationId,
              status: "COMPLETE",
              tenderId,
              tenderVersionId: version.id,
            },
          });
    const rag = await this.database.ragIndexRun.findFirst({
      orderBy: { activatedAt: "desc" },
      where: {
        ...(extraction === null ? {} : { extractionRunId: extraction.id }),
        invalidatedAt: null,
        organisationId,
        sourceMode: input.source_mode,
        status: "COMPLETE",
        tenderId,
        tenderVersionId: version.id,
      },
    });
    const template = await this.database.draftTemplateVersion.findFirst({
      include: { template: true },
      where: {
        activatedAt: { not: null },
        id: input.template_version_id,
        retiredAt: null,
        template: {
          draftType: input.draft_type,
          OR: [{ organisationId: null }, { organisationId }],
          retiredAt: null,
        },
      },
    });
    if (template === null)
      throw new UnprocessableEntityException(
        "An active compatible template version is required",
      );
    const failures = evaluateDraftStartGate({
      assessmentCurrent:
        assessment?.status === "COMPLETE" && assessment.invalidatedAt === null,
      checklistCurrent: checklist !== null,
      evidenceSnapshotCurrent:
        assessment?.snapshot.fingerprint === assessment?.sourceFingerprint,
      extractionCurrent:
        extraction?.status === "COMPLETE" && extraction.invalidatedAt === null,
      providerConfigured:
        this.environment.DRAFT_PROVIDER === "gemini" &&
        this.environment.GEMINI_API_KEY !== undefined,
      pursuitDecision: decision?.decision ?? null,
      ragIndexCurrent: rag !== null,
      riskCurrent:
        risk?.gateType === "EARLY" &&
        risk.status === "COMPLETE" &&
        risk.invalidatedAt === null,
    });
    if (failures.includes("PROVIDER_UNAVAILABLE"))
      throw new ServiceUnavailableException("Draft provider is unavailable");
    if (failures.length > 0)
      throw new ConflictException(
        `Draft prerequisites are not current: ${failures.join(",")}`,
      );
    if (
      extraction === null ||
      risk === null ||
      assessment === null ||
      decision === null ||
      checklist === null ||
      rag === null
    )
      throw new ConflictException("Draft prerequisites are not current");

    const approvedFacts =
      input.source_mode === "TENDER_AND_APPROVED_COMPANY_EVIDENCE" ||
      input.source_mode === "FULL_AUTHORISED_TENDER_CONTEXT"
        ? await this.currentApprovedFacts(organisationId)
        : [];
    const humanInputs = await this.database.draftHumanInput.findMany({
      orderBy: { id: "asc" },
      where: {
        invalidatedAt: null,
        organisationId,
        reviewState: "APPROVED",
        tenderId,
      },
    });
    const fingerprint = draftSourceFingerprint({
      assessment: assessment.sourceFingerprint,
      checklist: checklist.sourceFingerprint,
      decision: decision.id,
      draftPolicy: DRAFTING_POLICY_VERSION,
      extraction: extraction.sourceFingerprint,
      facts: approvedFacts.map(({ id, currentVersionId }) => ({
        id,
        currentVersionId,
      })),
      humanInputs: humanInputs.map(({ id, reviewedAt }) => ({
        id,
        reviewedAt,
      })),
      promptPolicy: DRAFT_PROMPT_POLICY_VERSION,
      rag: rag.sourceFingerprint,
      risk: risk.sourceFingerprint,
      sourceMode: input.source_mode,
      template: template.sourceFingerprint,
      tenderVersion: version.sourceFingerprint,
    });
    const idempotencyKey = `${organisationId}:${tenderId}:${input.idempotency_key}:${fingerprint}`;
    const existing = await this.database.draftGenerationRun.findUnique({
      where: { idempotencyKey },
    });
    if (existing !== null) return existing;

    const run = await this.database.$transaction(async (transaction) => {
      let writingInputId: string | null = null;
      if (input.instructions !== undefined) {
        const writingInput = await transaction.draftHumanInput.create({
          data: {
            createdByUserId: userId,
            inputClass: "WRITING_PREFERENCE",
            organisationId,
            provenanceDescription:
              "Bounded writing preference supplied for this generation request",
            reviewRationale:
              "Writing preferences control presentation and are not factual evidence",
            reviewedAt: new Date(),
            reviewedByUserId: userId,
            reviewState: "APPROVED",
            tenderId,
            value: input.instructions,
          },
        });
        writingInputId = writingInput.id;
      }
      const created = await transaction.draftGenerationRun.create({
        data: {
          assessmentRunId: assessment.id,
          checklistGenerationRunId: checklist.id,
          draftingPolicyVersion: DRAFTING_POLICY_VERSION,
          draftType: input.draft_type,
          evidenceSnapshotId: assessment.snapshotId,
          extractionRunId: extraction.id,
          idempotencyKey,
          model: this.environment.DRAFT_MODEL,
          organisationId,
          promptPolicyVersion: DRAFT_PROMPT_POLICY_VERSION,
          provider: this.environment.DRAFT_PROVIDER,
          pursuitDecisionId: decision.id,
          ragIndexRunId: rag.id,
          requestedByUserId: userId,
          retrievalPolicyVersion: rag.retrievalPolicyVersion,
          riskAnalysisRunId: risk.id,
          sourceFingerprint: fingerprint,
          sourceMode: input.source_mode,
          templatePolicyVersion: template.templatePolicyVersion,
          templateVersionId: template.id,
          tenderId,
          tenderVersionId: version.id,
          title: input.title,
          trigger: "USER",
        },
      });
      const snapshot = await transaction.draftInputSnapshot.create({
        data: {
          assessmentRunId: assessment.id,
          checklistGenerationRunId: checklist.id,
          draftingPolicyVersion: DRAFTING_POLICY_VERSION,
          draftType: input.draft_type,
          evidenceSnapshotId: assessment.snapshotId,
          extractionRunId: extraction.id,
          generationRunId: created.id,
          model: this.environment.DRAFT_MODEL,
          organisationId,
          promptPolicyVersion: DRAFT_PROMPT_POLICY_VERSION,
          provider: this.environment.DRAFT_PROVIDER,
          pursuitDecisionId: decision.id,
          ragIndexRunId: rag.id,
          retrievalPolicyVersion: rag.retrievalPolicyVersion,
          riskAnalysisRunId: risk.id,
          sourceFingerprint: fingerprint,
          sourceMode: input.source_mode,
          templatePolicyVersion: template.templatePolicyVersion,
          templateVersionId: template.id,
          tenderId,
          tenderVersionId: version.id,
        },
      });
      await transaction.draftGenerationRun.update({
        data: { inputSnapshotId: snapshot.id },
        where: { id: created.id },
      });
      await this.captureSnapshotSources(
        transaction,
        snapshot.id,
        organisationId,
        tenderId,
        extraction.id,
        risk.id,
        assessment.id,
        checklist.id,
        rag.id,
        approvedFacts,
        humanInputs,
        writingInputId,
      );
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "DRAFT_GENERATION_STARTED",
          metadata: {
            draftType: input.draft_type,
            sourceMode: input.source_mode,
          },
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: created.id,
          subjectType: "draft_generation_run",
        },
      });
      return created;
    });
    await this.jobs.add(
      "generate-fact-constrained-draft",
      {
        draftGenerationRunId: run.id,
        kind: "DRAFT_GENERATION",
        organisationId,
        requestId,
      },
      {
        attempts: 2,
        backoff: { delay: 2_000, type: "exponential" },
        jobId: `draft-generation-${run.id}`,
        removeOnComplete: 100,
      },
    );
    return run;
  }

  public runs(
    organisationId: string,
    tenderId: string,
    limit: number,
  ): Promise<unknown> {
    return this.database.draftGenerationRun.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      where: { organisationId, tenderId },
    });
  }

  public async run(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    const run = await this.database.draftGenerationRun.findFirst({
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    return run;
  }

  public async activeRun(
    organisationId: string,
    tenderId: string,
  ): Promise<unknown> {
    const run = await this.database.draftGenerationRun.findFirst({
      orderBy: { createdAt: "desc" },
      where: {
        invalidatedAt: null,
        organisationId,
        status: {
          in: [
            "QUEUED",
            "SNAPSHOTTING",
            "PLANNING",
            "RETRIEVING",
            "GENERATING",
            "VALIDATING",
          ],
        },
        tenderId,
      },
    });
    if (run === null) throw new NotFoundException();
    return run;
  }

  public async retryRun(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const prior = await this.database.draftGenerationRun.findFirst({
      include: { inputSnapshot: { include: { sources: true } } },
      where: {
        id: runId,
        organisationId,
        status: { in: ["FAILED", "CANCELLED", "INVALIDATED"] },
        tenderId,
      },
    });
    if (prior === null)
      throw new ConflictException(
        "Retry requires a still-current authoritative input snapshot",
      );
    if (prior.inputSnapshot === null)
      throw new ConflictException(
        "Retry requires a still-current authoritative input snapshot",
      );
    const inputSnapshot = prior.inputSnapshot;
    if (!(await this.sourcesCurrent(inputSnapshot.id)))
      throw new ConflictException(
        "Retry requires a still-current authoritative input snapshot",
      );
    const retried = await this.database.$transaction(async (transaction) => {
      const created = await transaction.draftGenerationRun.create({
        data: {
          assessmentRunId: prior.assessmentRunId,
          checklistGenerationRunId: prior.checklistGenerationRunId,
          draftId: prior.draftId,
          draftingPolicyVersion: prior.draftingPolicyVersion,
          draftType: prior.draftType,
          evidenceSnapshotId: prior.evidenceSnapshotId,
          extractionRunId: prior.extractionRunId,
          idempotencyKey: `${prior.idempotencyKey}:retry:${randomUUID()}`,
          model: prior.model,
          organisationId,
          promptPolicyVersion: prior.promptPolicyVersion,
          provider: prior.provider,
          pursuitDecisionId: prior.pursuitDecisionId,
          ragIndexRunId: prior.ragIndexRunId,
          requestedByUserId: userId,
          retrievalPolicyVersion: prior.retrievalPolicyVersion,
          retryCount: prior.retryCount + 1,
          riskAnalysisRunId: prior.riskAnalysisRunId,
          sourceFingerprint: prior.sourceFingerprint,
          sourceMode: prior.sourceMode,
          templatePolicyVersion: prior.templatePolicyVersion,
          templateVersionId: prior.templateVersionId,
          tenderId,
          tenderVersionId: prior.tenderVersionId,
          title: prior.title,
          trigger: "RETRY",
        },
      });
      const snapshot = await transaction.draftInputSnapshot.create({
        data: {
          assessmentRunId: inputSnapshot.assessmentRunId,
          checklistGenerationRunId: inputSnapshot.checklistGenerationRunId,
          draftingPolicyVersion: inputSnapshot.draftingPolicyVersion,
          draftType: inputSnapshot.draftType,
          evidenceSnapshotId: inputSnapshot.evidenceSnapshotId,
          extractionRunId: inputSnapshot.extractionRunId,
          generationRunId: created.id,
          model: inputSnapshot.model,
          organisationId,
          promptPolicyVersion: inputSnapshot.promptPolicyVersion,
          provider: inputSnapshot.provider,
          pursuitDecisionId: inputSnapshot.pursuitDecisionId,
          ragIndexRunId: inputSnapshot.ragIndexRunId,
          retrievalPolicyVersion: inputSnapshot.retrievalPolicyVersion,
          riskAnalysisRunId: inputSnapshot.riskAnalysisRunId,
          sourceFingerprint: inputSnapshot.sourceFingerprint,
          sourceMode: inputSnapshot.sourceMode,
          templatePolicyVersion: inputSnapshot.templatePolicyVersion,
          templateVersionId: inputSnapshot.templateVersionId,
          tenderId,
          tenderVersionId: inputSnapshot.tenderVersionId,
        },
      });
      await transaction.draftGenerationRun.update({
        data: { inputSnapshotId: snapshot.id },
        where: { id: created.id },
      });
      await transaction.draftInputSnapshotSource.createMany({
        data: inputSnapshot.sources.map((source) => ({
          evidenceCitationId: source.evidenceCitationId,
          evidenceFactVersionId: source.evidenceFactVersionId,
          extractionCitationId: source.extractionCitationId,
          humanInputId: source.humanInputId,
          organisationId,
          snapshotId: snapshot.id,
          sourceChecksum: source.sourceChecksum,
          sourceKind: source.sourceKind,
          sourceRecordId: source.sourceRecordId,
          sourceVersion: source.sourceVersion,
          tenderId,
        })),
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "DRAFT_GENERATION_RETRIED",
          metadata: { priorRunId: prior.id },
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: created.id,
          subjectType: "draft_generation_run",
        },
      });
      return created;
    });
    await this.jobs.add(
      "generate-fact-constrained-draft",
      {
        draftGenerationRunId: retried.id,
        kind: "DRAFT_GENERATION",
        organisationId,
        requestId,
      },
      {
        attempts: 2,
        backoff: { delay: 2_000, type: "exponential" },
        jobId: `draft-generation-${retried.id}`,
        removeOnComplete: 100,
      },
    );
    return retried;
  }

  public async cancelRun(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const result = await this.database.draftGenerationRun.updateMany({
      data: {
        cancellationRequestedAt: new Date(),
        currentStage: "Cancelled",
        status: "CANCELLED",
      },
      where: {
        id: runId,
        organisationId,
        status: {
          in: [
            "QUEUED",
            "SNAPSHOTTING",
            "PLANNING",
            "RETRIEVING",
            "GENERATING",
            "VALIDATING",
          ],
        },
        tenderId,
      },
    });
    if (result.count !== 1)
      throw new ConflictException("Generation cannot be cancelled");
    await this.audit(
      "DRAFT_GENERATION_CANCELLED",
      organisationId,
      userId,
      runId,
      requestId,
    );
    return { cancelled: true };
  }

  public events(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Observable<MessageEvent> {
    const stream = new Observable<MessageEvent>((subscriber) => {
      const timer = setInterval(() => {
        void this.database.draftGenerationRun
          .findFirst({
            select: {
              citationCount: true,
              completedAt: true,
              currentStage: true,
              eventSequence: true,
              placeholderCount: true,
              progressPercentage: true,
              safeFailureCode: true,
              sectionCount: true,
              status: true,
              updatedAt: true,
              validatedClaimCount: true,
            },
            where: { id: runId, organisationId, tenderId },
          })
          .then((run) => {
            if (run === null) {
              subscriber.error(new NotFoundException());
              return;
            }
            subscriber.next({ data: run, type: "progress" });
            if (
              ["COMPLETE", "FAILED", "CANCELLED", "INVALIDATED"].includes(
                run.status,
              )
            ) {
              clearInterval(timer);
              subscriber.complete();
            }
          });
      }, 1_000);
      return () => clearInterval(timer);
    });
    return concat(
      from([{ data: { status: "CONNECTED" }, type: "connected" }]),
      stream.pipe(takeUntil(interval(300_000))),
    );
  }

  public async drafts(
    organisationId: string,
    tenderId: string,
    limit: number,
  ): Promise<unknown> {
    await this.invalidateStaleDraftVersions(organisationId, tenderId);
    return this.database.draft.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      where: { deletedAt: null, organisationId, tenderId },
    });
  }

  public async draft(
    organisationId: string,
    tenderId: string,
    draftId: string,
  ): Promise<unknown> {
    await this.invalidateStaleDraftVersions(organisationId, tenderId);
    const draft = await this.database.draft.findFirst({
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          select: {
            createdAt: true,
            id: true,
            invalidatedAt: true,
            reviewState: true,
            versionNumber: true,
          },
        },
      },
      where: { deletedAt: null, id: draftId, organisationId, tenderId },
    });
    if (draft === null) throw new NotFoundException();
    return draft;
  }

  public async versions(
    organisationId: string,
    tenderId: string,
    draftId: string,
  ): Promise<unknown> {
    await this.invalidateStaleDraftVersions(organisationId, tenderId);
    return this.database.draftVersion.findMany({
      orderBy: { versionNumber: "desc" },
      where: { draftId, organisationId, tenderId },
    });
  }

  public async version(
    organisationId: string,
    tenderId: string,
    draftId: string,
    versionId: string,
  ): Promise<unknown> {
    await this.invalidateStaleDraftVersions(organisationId, tenderId);
    const version = await this.database.draftVersion.findFirst({
      include: {
        reviewEvents: { orderBy: { eventSequence: "asc" } },
        sections: {
          include: {
            claims: { include: { citations: true } },
            placeholders: true,
          },
          orderBy: { sectionOrder: "asc" },
        },
      },
      where: { draftId, id: versionId, organisationId, tenderId },
    });
    if (version === null) throw new NotFoundException();
    return version;
  }

  public async editVersion(
    organisationId: string,
    tenderId: string,
    draftId: string,
    parentVersionId: string,
    input: EditDraftVersionRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const parent = await this.database.draftVersion.findFirst({
      include: {
        draft: true,
        sections: {
          include: {
            claims: { include: { citations: true } },
            placeholders: true,
          },
          orderBy: { sectionOrder: "asc" },
        },
      },
      where: {
        draftId,
        id: parentVersionId,
        invalidatedAt: null,
        organisationId,
        tenderId,
      },
    });
    if (parent === null || parent.draft.currentVersionId !== parent.id)
      throw new ConflictException("Only the current version can be edited");
    const edits = new Map(
      input.sections.map((section) => [section.section_key, section.content]),
    );
    for (const key of edits.keys())
      if (!parent.sections.some(({ sectionKey }) => sectionKey === key))
        throw new UnprocessableEntityException("Unknown draft section");
    return this.database.$transaction(async (transaction) => {
      const version = await transaction.draftVersion.create({
        data: {
          changeSummary: input.change_summary,
          createdByUserId: userId,
          draftId,
          inputSnapshotId: parent.inputSnapshotId,
          model: null,
          organisationId,
          parentVersionId: parent.id,
          provider: null,
          sourceFingerprint: parent.sourceFingerprint,
          templateVersionId: parent.templateVersionId,
          tenderId,
          tenderVersionId: parent.tenderVersionId,
          versionNumber: parent.versionNumber + 1,
        },
      });
      for (const sourceSection of parent.sections) {
        const content =
          edits.get(sourceSection.sectionKey) ?? sourceSection.content;
        const changed = content !== sourceSection.content;
        const section = await transaction.draftSection.create({
          data: {
            content,
            contentOrigin: changed
              ? "HUMAN_EDITED"
              : sourceSection.contentOrigin,
            draftVersionId: version.id,
            heading: sourceSection.heading,
            requirementIds: sourceSection.requirementIds,
            sectionKey: sourceSection.sectionKey,
            sectionOrder: sourceSection.sectionOrder,
          },
        });
        for (const sourceClaim of sourceSection.claims) {
          const claim = await transaction.draftClaim.create({
            data: {
              claimClass: sourceClaim.claimClass,
              claimText: sourceClaim.claimText,
              evidenceFactVersionId: sourceClaim.evidenceFactVersionId,
              humanInputId: sourceClaim.humanInputId,
              material: sourceClaim.material,
              reviewState: "NOT_REVIEWED",
              sectionId: section.id,
              supportState:
                changed && !content.includes(sourceClaim.claimText)
                  ? "HUMAN_REVIEW_REQUIRED"
                  : sourceClaim.supportState,
            },
          });
          for (const citation of sourceClaim.citations)
            await transaction.draftClaimCitation.create({
              data: {
                claimId: claim.id,
                clauseLabel: citation.clauseLabel,
                documentName: citation.documentName,
                evidenceCitationId: citation.evidenceCitationId,
                excerpt: citation.excerpt,
                extractionCitationId: citation.extractionCitationId,
                handle: citation.handle,
                pageNumber: citation.pageNumber,
                ragChunkId: citation.ragChunkId,
                sourceChecksum: citation.sourceChecksum,
              },
            });
        }
        for (const placeholder of sourceSection.placeholders)
          await transaction.draftPlaceholder.create({
            data: {
              approvalBlocking: placeholder.approvalBlocking,
              assessmentId: placeholder.assessmentId,
              checklistItemId: placeholder.checklistItemId,
              draftVersionId: version.id,
              explanation: placeholder.explanation,
              markerText: placeholder.markerText,
              material: placeholder.material,
              organisationId,
              placeholderType: placeholder.placeholderType,
              sectionId: section.id,
              structuredRequirementId: placeholder.structuredRequirementId,
              tenderId,
            },
          });
        if (changed)
          await transaction.draftPlaceholder.create({
            data: {
              approvalBlocking: true,
              draftVersionId: version.id,
              explanation:
                "Human-edited content requires claim classification, source linking, and review",
              markerText: visiblePlaceholder(
                "Validate the human-edited section and link every material claim to an authorised source.",
              ),
              organisationId,
              placeholderType: "HUMAN_REVIEW_REQUIRED",
              sectionId: section.id,
              tenderId,
            },
          });
      }
      await transaction.draftVersion.update({
        data: { reviewState: "SUPERSEDED" },
        where: { id: parent.id },
      });
      await transaction.draft.update({
        data: { currentVersionId: version.id },
        where: { id: draftId },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "DRAFT_SECTION_EDITED",
          metadata: { changedSectionCount: edits.size },
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: version.id,
          subjectType: "draft_version",
        },
      });
      return version;
    });
  }

  public async compareVersions(
    organisationId: string,
    tenderId: string,
    draftId: string,
    leftId: string,
    rightId: string,
  ): Promise<unknown> {
    const versions = await this.database.draftVersion.findMany({
      include: {
        sections: {
          include: {
            claims: { select: { claimText: true, supportState: true } },
            placeholders: {
              select: { markerText: true, resolutionState: true },
            },
          },
          orderBy: { sectionOrder: "asc" },
        },
      },
      where: {
        draftId,
        id: { in: [leftId, rightId] },
        organisationId,
        tenderId,
      },
    });
    if (versions.length !== 2) throw new NotFoundException();
    return {
      left: versions.find(({ id }) => id === leftId),
      right: versions.find(({ id }) => id === rightId),
    };
  }

  public async createHumanInput(
    organisationId: string,
    tenderId: string,
    input: CreateDraftHumanInputRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    await this.requireTender(organisationId, tenderId);
    if (isUnsafeDraftInstruction(input.value))
      throw new UnprocessableEntityException(
        "Human input cannot expand authority or invoke platform actions",
      );
    const created = await this.database.draftHumanInput.create({
      data: {
        createdByUserId: userId,
        inputClass: input.input_class,
        organisationId,
        provenanceDescription: input.provenance_description,
        sectionKey: input.section_key ?? null,
        structuredRequirementId: input.structured_requirement_id ?? null,
        tenderId,
        value: input.value,
      },
    });
    await this.audit(
      "DRAFT_HUMAN_INPUT_CREATED",
      organisationId,
      userId,
      created.id,
      requestId,
    );
    return created;
  }

  public humanInputs(
    organisationId: string,
    tenderId: string,
  ): Promise<unknown> {
    return this.database.draftHumanInput.findMany({
      orderBy: { createdAt: "desc" },
      where: { organisationId, tenderId },
    });
  }

  public async reviewHumanInput(
    organisationId: string,
    tenderId: string,
    inputId: string,
    input: ReviewDraftHumanInputRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const source = await this.database.draftHumanInput.findFirst({
      where: {
        id: inputId,
        invalidatedAt: null,
        organisationId,
        reviewState: "PENDING",
        tenderId,
      },
    });
    if (source === null) throw new NotFoundException();
    if (source.createdByUserId === userId)
      throw new ForbiddenException("A different authorised user must review");
    const updated = await this.database.draftHumanInput.update({
      data: {
        reviewRationale: input.rationale,
        reviewedAt: new Date(),
        reviewedByUserId: userId,
        reviewState: input.state,
      },
      where: { id: inputId },
    });
    await this.audit(
      "DRAFT_HUMAN_INPUT_REVIEWED",
      organisationId,
      userId,
      inputId,
      requestId,
    );
    return updated;
  }

  public async placeholders(
    organisationId: string,
    tenderId: string,
    versionId: string,
  ): Promise<unknown> {
    return this.database.draftPlaceholder.findMany({
      orderBy: { createdAt: "asc" },
      where: { draftVersionId: versionId, organisationId, tenderId },
    });
  }

  public async resolvePlaceholder(
    organisationId: string,
    tenderId: string,
    versionId: string,
    placeholderId: string,
    input: ResolveDraftPlaceholderRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const placeholder = await this.database.draftPlaceholder.findFirst({
      include: {
        section: { include: { draftVersion: { include: { draft: true } } } },
      },
      where: {
        draftVersionId: versionId,
        id: placeholderId,
        organisationId,
        resolutionState: { in: ["OPEN", "REOPENED"] },
        tenderId,
      },
    });
    if (placeholder?.section.draftVersion.draft.currentVersionId !== versionId)
      throw new NotFoundException();
    let permitted = false;
    if (input.evidence_citation_id !== undefined) {
      const citation = await this.database.companyEvidenceCitation.findFirst({
        where: {
          id: input.evidence_citation_id,
          invalidatedAt: null,
          validationStatus: "VALID",
          evidenceFactVersion: {
            evidenceFact: {
              currentVersionId: { not: null },
              invalidatedAt: null,
              organisationId,
            },
            reviewState: "ACCEPTED",
          },
        },
      });
      permitted = citation !== null;
    }
    if (input.human_input_id !== undefined) {
      const humanInput = await this.database.draftHumanInput.findFirst({
        where: {
          id: input.human_input_id,
          invalidatedAt: null,
          organisationId,
          reviewState: "APPROVED",
          tenderId,
        },
      });
      permitted ||= humanInput !== null;
    }
    if (!permitted)
      throw new UnprocessableEntityException(
        "A current reviewed resolution source is required",
      );
    const updated = await this.database.draftPlaceholder.update({
      data: {
        resolutionRationale: input.rationale,
        resolutionState: "RESOLVED",
        resolvedAt: new Date(),
        resolvedByUserId: userId,
      },
      where: { id: placeholderId },
    });
    await this.audit(
      "DRAFT_PLACEHOLDER_RESOLVED",
      organisationId,
      userId,
      placeholderId,
      requestId,
    );
    return updated;
  }

  public async reopenPlaceholder(
    organisationId: string,
    tenderId: string,
    versionId: string,
    placeholderId: string,
    rationale: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const result = await this.database.draftPlaceholder.updateMany({
      data: {
        resolutionRationale: rationale,
        resolutionState: "REOPENED",
        resolvedAt: null,
        resolvedByUserId: null,
      },
      where: {
        draftVersionId: versionId,
        id: placeholderId,
        organisationId,
        resolutionState: "RESOLVED",
        tenderId,
      },
    });
    if (result.count !== 1) throw new NotFoundException();
    await this.audit(
      "DRAFT_PLACEHOLDER_REOPENED",
      organisationId,
      userId,
      placeholderId,
      requestId,
    );
    return { reopened: true };
  }

  public async review(
    organisationId: string,
    tenderId: string,
    draftId: string,
    versionId: string,
    input: DraftReviewActionRequest,
    userId: string,
    requestId: string,
    hasApprovalPermission: boolean,
  ): Promise<unknown> {
    await this.invalidateStaleDraftVersions(organisationId, tenderId);
    const version = await this.database.draftVersion.findFirst({
      include: {
        draft: true,
        sections: {
          include: { claims: true, placeholders: true },
        },
      },
      where: { draftId, id: versionId, organisationId, tenderId },
    });
    if (version === null) throw new NotFoundException();
    if (input.action === "APPROVE_VERSION") {
      const sourcesCurrent = await this.sourcesCurrent(version.inputSnapshotId);
      const blockers = draftApprovalBlockers({
        actorUserId: userId,
        blockingPlaceholders: version.sections.flatMap(({ placeholders }) =>
          placeholders.filter(
            ({ approvalBlocking, resolutionState }) =>
              approvalBlocking && resolutionState !== "RESOLVED",
          ),
        ).length,
        hasApprovalPermission,
        isCurrentVersion: version.draft.currentVersionId === version.id,
        rationale: input.rationale,
        sourcesCurrent,
        unvalidatedHumanEdits: version.sections.filter(
          ({ contentOrigin }) => contentOrigin === "HUMAN_EDITED",
        ).length,
        unreviewedCommitments: version.sections.flatMap(({ claims }) =>
          claims.filter(
            ({ claimClass, reviewState }) =>
              claimClass === "HUMAN_AUTHORED_COMMITMENT" &&
              reviewState !== "APPROVED",
          ),
        ).length,
        unresolvedConflicts: version.sections.flatMap(({ claims }) =>
          claims.filter(({ supportState }) => supportState === "CONFLICTING"),
        ).length,
        unsupportedMaterialClaims: version.sections.flatMap(({ claims }) =>
          claims.filter(
            ({ material, supportState }) =>
              material && supportState !== "SUPPORTED",
          ),
        ).length,
        versionCreatorUserId: version.createdByUserId,
      });
      if (blockers.length > 0)
        throw new ConflictException(
          `Draft approval is blocked: ${blockers.join(",")}`,
        );
    }
    const nextState = reviewStateForAction(input.action);
    return this.database.$transaction(async (transaction) => {
      const sequence = await transaction.draftReviewEvent.count({
        where: { draftVersionId: version.id },
      });
      const event = await transaction.draftReviewEvent.create({
        data: {
          action: input.action,
          actorUserId: userId,
          draftVersionId: version.id,
          eventSequence: sequence + 1,
          newState: nextState,
          organisationId,
          priorState: version.reviewState,
          rationale: input.rationale,
          sectionId: input.section_id ?? null,
          sourceFingerprint: version.sourceFingerprint,
          tenderId,
        },
      });
      await transaction.draftVersion.update({
        data: {
          ...(input.action === "APPROVE_VERSION"
            ? {
                approvalRationale: input.rationale,
                approvedAt: new Date(),
                approvedByUserId: userId,
              }
            : {}),
          reviewState: nextState,
        },
        where: { id: version.id },
      });
      if (input.action === "START_REVIEW")
        await transaction.draftReview.create({
          data: {
            draftVersionId: version.id,
            organisationId,
            startedByUserId: userId,
            tenderId,
          },
        });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: auditTypeForReview(input.action),
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: version.id,
          subjectType: "draft_version",
        },
      });
      return event;
    });
  }

  public async archive(
    organisationId: string,
    tenderId: string,
    draftId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const result = await this.database.draft.updateMany({
      data: { archivedAt: new Date(), lifecycle: "ARCHIVED" },
      where: { deletedAt: null, id: draftId, organisationId, tenderId },
    });
    if (result.count !== 1) throw new NotFoundException();
    await this.audit(
      "DRAFT_ARCHIVED",
      organisationId,
      userId,
      draftId,
      requestId,
    );
    return { archived: true };
  }

  private async currentApprovedFacts(organisationId: string): Promise<
    Prisma.CompanyEvidenceFactGetPayload<{
      include: { currentVersion: { include: { citations: true } } };
    }>[]
  > {
    return this.database.companyEvidenceFact.findMany({
      include: {
        currentVersion: {
          include: {
            citations: {
              where: { invalidatedAt: null, validationStatus: "VALID" },
            },
          },
        },
      },
      orderBy: { id: "asc" },
      where: {
        invalidatedAt: null,
        organisationId,
        currentVersion: {
          citations: {
            some: { invalidatedAt: null, validationStatus: "VALID" },
          },
          reviewState: "ACCEPTED",
        },
      },
    });
  }

  private async captureSnapshotSources(
    transaction: Prisma.TransactionClient,
    snapshotId: string,
    organisationId: string,
    tenderId: string,
    extractionRunId: string,
    riskRunId: string,
    assessmentRunId: string,
    checklistRunId: string,
    ragIndexRunId: string,
    approvedFacts: Awaited<ReturnType<DraftsService["currentApprovedFacts"]>>,
    humanInputs: readonly {
      readonly id: string;
      readonly reviewedAt: Date | null;
    }[],
    writingInputId: string | null,
  ): Promise<void> {
    const [requirements, risks, assessments, checklistItems, ragChunks] =
      await Promise.all([
        transaction.structuredRequirement.findMany({
          select: { id: true },
          where: { extractionRunId },
        }),
        transaction.riskFinding.findMany({
          select: { id: true, sourceInputFingerprint: true },
          where: {
            invalidatedAt: null,
            organisationId,
            riskAnalysisRunId: riskRunId,
          },
        }),
        transaction.eligibilityAssessment.findMany({
          select: { id: true, policyVersion: true },
          where: { assessmentRunId, invalidatedAt: null, organisationId },
        }),
        transaction.checklistItem.findMany({
          select: { id: true, sourceFingerprint: true },
          where: {
            generationRunId: checklistRunId,
            invalidatedAt: null,
            organisationId,
          },
        }),
        transaction.ragChunk.findMany({
          select: { contentChecksum: true, id: true },
          take: 2_000,
          where: { indexRunId: ragIndexRunId, organisationId, tenderId },
        }),
      ]);
    const rows: Prisma.DraftInputSnapshotSourceCreateManyInput[] = [
      ...requirements.map((source) => ({
        organisationId,
        snapshotId,
        sourceKind: "STRUCTURED_REQUIREMENT" as const,
        sourceRecordId: source.id,
        sourceVersion: extractionRunId,
        tenderId,
      })),
      ...risks.map((source) => ({
        organisationId,
        snapshotId,
        sourceChecksum: source.sourceInputFingerprint,
        sourceKind: "RISK_FINDING" as const,
        sourceRecordId: source.id,
        sourceVersion: riskRunId,
        tenderId,
      })),
      ...assessments.map((source) => ({
        organisationId,
        snapshotId,
        sourceKind: "ELIGIBILITY_ASSESSMENT" as const,
        sourceRecordId: source.id,
        sourceVersion: source.policyVersion,
        tenderId,
      })),
      ...checklistItems.map((source) => ({
        organisationId,
        snapshotId,
        sourceChecksum: source.sourceFingerprint,
        sourceKind: "CHECKLIST_ITEM" as const,
        sourceRecordId: source.id,
        sourceVersion: checklistRunId,
        tenderId,
      })),
      ...ragChunks.map((source) => ({
        organisationId,
        snapshotId,
        sourceChecksum: source.contentChecksum,
        sourceKind: "RAG_CHUNK" as const,
        sourceRecordId: source.id,
        sourceVersion: ragIndexRunId,
        tenderId,
      })),
      ...approvedFacts.flatMap((fact) => {
        const version = fact.currentVersion;
        if (version === null) return [];
        return [
          {
            evidenceFactVersionId: version.id,
            organisationId,
            snapshotId,
            sourceKind: "COMPANY_EVIDENCE_FACT_VERSION" as const,
            sourceRecordId: version.id,
            sourceVersion: String(version.versionNumber),
            tenderId,
          },
          ...version.citations.map((citation) => ({
            evidenceCitationId: citation.id,
            evidenceFactVersionId: version.id,
            organisationId,
            snapshotId,
            sourceChecksum: citation.documentChecksum,
            sourceKind: "COMPANY_EVIDENCE_CITATION" as const,
            sourceRecordId: citation.id,
            sourceVersion: String(version.versionNumber),
            tenderId,
          })),
        ];
      }),
      ...humanInputs.map((source) => ({
        humanInputId: source.id,
        organisationId,
        snapshotId,
        sourceKind: "HUMAN_INPUT" as const,
        sourceRecordId: source.id,
        sourceVersion: source.reviewedAt?.toISOString() ?? "unreviewed",
        tenderId,
      })),
      ...(writingInputId === null
        ? []
        : [
            {
              humanInputId: writingInputId,
              organisationId,
              snapshotId,
              sourceKind: "HUMAN_INPUT" as const,
              sourceRecordId: writingInputId,
              sourceVersion: "generation-writing-preference",
              tenderId,
            },
          ]),
    ];
    if (rows.length > 5_000)
      throw new UnprocessableEntityException("Draft source limit exceeded");
    await transaction.draftInputSnapshotSource.createMany({ data: rows });
  }

  private async sourcesCurrent(snapshotId: string): Promise<boolean> {
    const snapshot = await this.database.draftInputSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (snapshot === null) return false;
    const tender = await this.database.tender.findFirst({
      include: { currentVersion: true },
      where: {
        currentVersionId: snapshot.tenderVersionId,
        id: snapshot.tenderId,
        organisationId: snapshot.organisationId,
      },
    });
    const [extraction, risk, assessment, checklist, rag, decision] =
      await Promise.all([
        this.database.extractionRun.findFirst({
          where: {
            id: snapshot.extractionRunId,
            invalidatedAt: null,
            organisationId: snapshot.organisationId,
            status: "COMPLETE",
          },
        }),
        this.database.riskAnalysisRun.findFirst({
          where: {
            id: snapshot.riskAnalysisRunId,
            invalidatedAt: null,
            organisationId: snapshot.organisationId,
            status: "COMPLETE",
          },
        }),
        this.database.eligibilityAssessmentRun.findFirst({
          where: {
            id: snapshot.assessmentRunId,
            invalidatedAt: null,
            organisationId: snapshot.organisationId,
            status: "COMPLETE",
          },
        }),
        this.database.checklistGenerationRun.findFirst({
          where: {
            id: snapshot.checklistGenerationRunId,
            invalidatedAt: null,
            organisationId: snapshot.organisationId,
            status: "COMPLETE",
          },
        }),
        this.database.ragIndexRun.findFirst({
          where: {
            id: snapshot.ragIndexRunId,
            invalidatedAt: null,
            organisationId: snapshot.organisationId,
            status: "COMPLETE",
          },
        }),
        this.database.earlyPursuitDecision.findFirst({
          where: {
            decision: "CONTINUE",
            id: snapshot.pursuitDecisionId,
            organisationId: snapshot.organisationId,
            supersededAt: null,
          },
        }),
      ]);
    return (
      tender !== null &&
      extraction !== null &&
      risk !== null &&
      assessment !== null &&
      checklist !== null &&
      rag !== null &&
      decision !== null
    );
  }

  private async invalidateStaleDraftVersions(
    organisationId: string,
    tenderId: string,
  ): Promise<void> {
    const candidates = await this.database.draftVersion.findMany({
      select: {
        generationRunId: true,
        id: true,
        inputSnapshotId: true,
      },
      where: {
        invalidatedAt: null,
        organisationId,
        tenderId,
      },
    });
    for (const candidate of candidates) {
      if (await this.sourcesCurrent(candidate.inputSnapshotId)) continue;
      const invalidatedAt = new Date();
      await this.database.$transaction([
        this.database.draftVersion.updateMany({
          data: {
            approvedAt: null,
            approvedByUserId: null,
            approvalRationale: null,
            invalidatedAt,
            invalidationReason: "AUTHORITATIVE_SOURCE_CHANGED",
            reviewState: "INVALIDATED",
          },
          where: {
            id: candidate.id,
            invalidatedAt: null,
            organisationId,
            tenderId,
          },
        }),
        ...(candidate.generationRunId === null
          ? []
          : [
              this.database.draftGenerationRun.updateMany({
                data: {
                  invalidatedAt,
                  invalidationReason: "AUTHORITATIVE_SOURCE_CHANGED",
                  status: "INVALIDATED",
                },
                where: {
                  id: candidate.generationRunId,
                  invalidatedAt: null,
                  organisationId,
                  tenderId,
                },
              }),
            ]),
      ]);
    }
  }

  private async requireTender(
    organisationId: string,
    tenderId: string,
  ): Promise<void> {
    const tender = await this.database.tender.findFirst({
      where: { deletedAt: null, id: tenderId, organisationId },
    });
    if (tender === null) throw new NotFoundException();
  }

  private audit(
    eventType:
      | "DRAFT_GENERATION_CANCELLED"
      | "DRAFT_HUMAN_INPUT_CREATED"
      | "DRAFT_HUMAN_INPUT_REVIEWED"
      | "DRAFT_PLACEHOLDER_RESOLVED"
      | "DRAFT_PLACEHOLDER_REOPENED"
      | "DRAFT_ARCHIVED",
    organisationId: string,
    userId: string,
    subjectId: string,
    requestId: string,
  ): Promise<unknown> {
    return this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType,
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId,
        subjectType: "draft",
      },
    });
  }
}

function reviewStateForAction(
  action: DraftReviewActionRequest["action"],
):
  "NOT_REVIEWED" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED" {
  switch (action) {
    case "START_REVIEW":
    case "COMMENT":
    case "ACCEPT_SECTION":
      return "IN_REVIEW";
    case "REQUEST_CHANGES":
    case "REJECT_SECTION":
      return "CHANGES_REQUESTED";
    case "APPROVE_VERSION":
      return "APPROVED";
    case "REJECT_VERSION":
      return "REJECTED";
    case "REOPEN_VERSION":
      return "NOT_REVIEWED";
  }
}

function auditTypeForReview(
  action: DraftReviewActionRequest["action"],
):
  | "DRAFT_REVIEW_STARTED"
  | "DRAFT_CHANGES_REQUESTED"
  | "DRAFT_VERSION_APPROVED"
  | "DRAFT_VERSION_REJECTED"
  | "DRAFT_VERSION_REOPENED" {
  switch (action) {
    case "START_REVIEW":
    case "COMMENT":
    case "ACCEPT_SECTION":
      return "DRAFT_REVIEW_STARTED";
    case "REQUEST_CHANGES":
    case "REJECT_SECTION":
      return "DRAFT_CHANGES_REQUESTED";
    case "APPROVE_VERSION":
      return "DRAFT_VERSION_APPROVED";
    case "REJECT_VERSION":
      return "DRAFT_VERSION_REJECTED";
    case "REOPEN_VERSION":
      return "DRAFT_VERSION_REOPENED";
  }
}
