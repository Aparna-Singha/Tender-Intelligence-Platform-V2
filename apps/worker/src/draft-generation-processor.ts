import {
  Prisma,
  type DraftType as DatabaseDraftType,
  type PrismaClient,
} from "@tender/database";
import {
  claimSupportState,
  DRAFT_MAX_CONTEXTS_PER_SECTION,
  isUnsafeDraftInstruction,
  sourceClassesForMode,
  validateTemplateSections,
  verifyCitationHandles,
  type ControlledTemplateSection,
  type DraftClaimClass,
  type RagSourceMode,
} from "@tender/domain";
import type {
  DraftGenerationGateway,
  EmbeddingGateway,
  GeneratedDraftSection,
} from "./ai-provider.js";
import { ProviderResponseError } from "./ai-provider.js";

export interface DraftGenerationJob {
  readonly draftGenerationRunId: string;
  readonly kind: "DRAFT_GENERATION";
  readonly organisationId: string;
  readonly requestId: string;
}

export function isDraftGenerationJob(
  value: unknown,
): value is DraftGenerationJob {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    item.kind === "DRAFT_GENERATION" &&
    typeof item.draftGenerationRunId === "string" &&
    typeof item.organisationId === "string" &&
    typeof item.requestId === "string"
  );
}

interface RetrievedDraftChunk {
  readonly chunk_id: string;
  readonly clause_label: string | null;
  readonly content: string;
  readonly content_checksum: string;
  readonly document_name: string;
  readonly extraction_citation_id: string | null;
  readonly page_number: number | null;
  readonly source_class: string;
  readonly source_record_id: string;
}

export class DraftGenerationProcessor {
  public constructor(
    private readonly database: PrismaClient,
    private readonly embeddings: EmbeddingGateway,
    private readonly generator: DraftGenerationGateway,
  ) {}

  public async process(
    job: DraftGenerationJob,
    signal: AbortSignal,
  ): Promise<void> {
    const started = Date.now();
    const run = await this.database.draftGenerationRun.findFirst({
      include: { inputSnapshot: { include: { sources: true } } },
      where: {
        id: job.draftGenerationRunId,
        organisationId: job.organisationId,
      },
    });
    if (run === null) throw new Error("DRAFT_RUN_NOT_FOUND");
    if (["COMPLETE", "CANCELLED", "INVALIDATED"].includes(run.status)) return;
    if (run.inputSnapshot === null)
      throw new Error("DRAFT_INPUT_SNAPSHOT_REQUIRED");
    await this.assertCurrentAuthority(run.id, run.organisationId, run.tenderId);
    await this.checkpoint(run.id, "SNAPSHOTTING", 10, signal);

    const template = await this.database.draftTemplateVersion.findFirst({
      include: { template: true },
      where: {
        activatedAt: { not: null },
        id: run.templateVersionId,
        retiredAt: null,
        template: {
          draftType: run.draftType,
          OR: [
            { organisationId: null },
            { organisationId: run.organisationId },
          ],
          retiredAt: null,
        },
      },
    });
    if (template === null) throw new Error("DRAFT_TEMPLATE_NOT_CURRENT");
    const sections = parseTemplateSections(template.sections);
    if (!validateTemplateSections(sections))
      throw new Error("DRAFT_TEMPLATE_INVALID");

    const writingInputs = await this.database.draftHumanInput.findMany({
      orderBy: { createdAt: "asc" },
      where: {
        id: {
          in: run.inputSnapshot.sources
            .filter(({ sourceKind }) => sourceKind === "HUMAN_INPUT")
            .map(({ sourceRecordId }) => sourceRecordId),
        },
        inputClass: "WRITING_PREFERENCE",
        invalidatedAt: null,
        organisationId: run.organisationId,
        reviewState: "APPROVED",
        tenderId: run.tenderId,
      },
    });
    const instructions =
      writingInputs.length === 0
        ? null
        : writingInputs
            .map(({ value }) => value)
            .join("\n")
            .slice(0, 2_000);
    if (instructions !== null && isUnsafeDraftInstruction(instructions))
      throw new Error("UNSAFE_DRAFT_INSTRUCTION");

    const planningStarted = Date.now();
    await this.checkpoint(run.id, "PLANNING", 20, signal);
    const generatedSections: {
      readonly plan: ControlledTemplateSection;
      readonly generated: GeneratedDraftSection;
      readonly chunks: readonly RetrievedDraftChunk[];
    }[] = [];
    let retrievalLatencyMs = 0;
    let generationLatencyMs = 0;

    for (const [index, plan] of sections.entries()) {
      await this.checkpoint(
        run.id,
        "RETRIEVING",
        25 + Math.floor((index / sections.length) * 25),
        signal,
      );
      const retrievalStarted = Date.now();
      const queryVector = await this.embeddings.embedQuery(
        `${plan.heading} ${plan.formattingGuidance}`,
        signal,
      );
      const allowedClasses = sourceClassesForMode(
        run.sourceMode as RagSourceMode,
      ).filter(
        (sourceClass) =>
          plan.requiredSourceClasses.length === 0 ||
          plan.requiredSourceClasses.includes(sourceClass),
      );
      const snapshottedChunkIds = run.inputSnapshot.sources
        .filter(({ sourceKind }) => sourceKind === "RAG_CHUNK")
        .map(({ sourceRecordId }) => sourceRecordId);
      const chunks =
        allowedClasses.length === 0 || snapshottedChunkIds.length === 0
          ? []
          : await this.database.$queryRaw<readonly RetrievedDraftChunk[]>(
              Prisma.sql`
        WITH authorised AS (
          SELECT "id","content","content_checksum","document_name","page_number",
            "clause_label","source_class","source_record_id","extraction_citation_id",
            ts_rank_cd("search_vector", plainto_tsquery('english', ${plan.heading})) AS lexical_score,
            1 - ("embedding" <=> ${`[${queryVector.join(",")}]`}::vector) AS vector_score
           FROM "rag_chunks"
           WHERE "organisation_id" = ${run.organisationId}::uuid
             AND "tender_id" = ${run.tenderId}::uuid
             AND "tender_version_id" = ${run.tenderVersionId}::uuid
             AND "index_run_id" = ${run.ragIndexRunId}::uuid
             AND "id" IN (${Prisma.join(
               snapshottedChunkIds.map((id) => Prisma.sql`${id}::uuid`),
             )})
             AND "source_class"::text IN (${Prisma.join(allowedClasses)})
            AND "embedding" IS NOT NULL
        ), ranked AS (
          SELECT *,
            rank() OVER (ORDER BY lexical_score DESC, "id") AS lexical_rank,
            rank() OVER (ORDER BY vector_score DESC, "id") AS vector_rank
          FROM authorised
          ORDER BY GREATEST(lexical_score, vector_score) DESC
          LIMIT 40
        )
        SELECT "id" AS "chunk_id","content","content_checksum","document_name",
          "page_number","clause_label","source_class"::text,"source_record_id",
          "extraction_citation_id"
         FROM ranked
         ORDER BY ((1.0/(60+lexical_rank)) + (1.0/(60+vector_rank))) DESC, "id"
         LIMIT ${DRAFT_MAX_CONTEXTS_PER_SECTION}`,
            );
      retrievalLatencyMs += Date.now() - retrievalStarted;
      await this.checkpoint(
        run.id,
        "GENERATING",
        50 + Math.floor((index / sections.length) * 30),
        signal,
      );
      const generationStarted = Date.now();
      const generated = await this.generator.generateDraftSection(
        {
          formattingGuidance: plan.formattingGuidance,
          heading: plan.heading,
          instructions,
          sectionKey: plan.key,
        },
        chunks.map((chunk, contextIndex) => ({
          handle: `D${contextIndex + 1}`,
          sourceClass: chunk.source_class,
          text: chunk.content,
        })),
        signal,
      );
      generationLatencyMs += Date.now() - generationStarted;
      this.validateGeneratedSection(generated, plan, chunks);
      generatedSections.push({ chunks, generated, plan });
    }

    const validationStarted = Date.now();
    await this.checkpoint(run.id, "VALIDATING", 90, signal);
    const counts = await this.persist(
      run,
      generatedSections,
      planningStarted - started,
      retrievalLatencyMs,
      generationLatencyMs,
      Date.now() - validationStarted,
      started,
    );
    await this.database.auditEvent.create({
      data: {
        actorUserId: run.requestedByUserId,
        eventType: "DRAFT_GENERATION_COMPLETED",
        metadata: counts,
        organisationId: run.organisationId,
        outcome: "SUCCESS",
        requestId: job.requestId,
        subjectId: run.id,
        subjectType: "draft_generation_run",
      },
    });
  }

  public async fail(
    runId: string,
    organisationId: string,
    error: Error,
  ): Promise<void> {
    await this.database.draftGenerationRun.updateMany({
      data: {
        safeFailureCode:
          error.message === "AI_PROVIDER_UNAVAILABLE"
            ? "PROVIDER_UNAVAILABLE"
            : error instanceof ProviderResponseError
              ? error.code
              : error.message.slice(0, 80),
        status: "FAILED",
      },
      where: {
        id: runId,
        organisationId,
        status: { notIn: ["COMPLETE", "CANCELLED", "INVALIDATED"] },
      },
    });
  }

  private validateGeneratedSection(
    generated: GeneratedDraftSection,
    plan: ControlledTemplateSection,
    chunks: readonly RetrievedDraftChunk[],
  ): void {
    const handles = chunks.map((chunk, index) => ({
      chunkId: chunk.chunk_id,
      handle: `D${index + 1}`,
    }));
    for (const claim of generated.claims) {
      if (!plan.allowedClaimClasses.includes(claim.claimClass))
        throw new Error("DRAFT_CLAIM_CLASS_NOT_ALLOWED");
      if (
        claim.material &&
        claim.claimClass !== "PLACEHOLDER" &&
        !verifyCitationHandles(claim.handles, handles)
      )
        throw new Error("DRAFT_CITATION_INVALID");
      if (
        claim.claimClass === "APPROVED_COMPANY_FACT" &&
        !claim.handles.every((handle) => {
          const chunk = chunks[Number(handle.slice(1)) - 1];
          return chunk?.source_class === "COMPANY_EVIDENCE";
        })
      )
        throw new Error("COMPANY_FACT_SOURCE_INVALID");
      if (!generated.content.includes(claim.claim))
        throw new Error("DRAFT_CLAIM_TEXT_NOT_IN_SECTION");
    }
    for (const placeholder of generated.placeholders)
      if (!generated.content.includes(placeholder.marker))
        throw new Error("DRAFT_PLACEHOLDER_NOT_VISIBLE");
  }

  private async persist(
    run: {
      readonly id: string;
      readonly organisationId: string;
      readonly tenderId: string;
      readonly tenderVersionId: string;
      readonly draftId: string | null;
      readonly draftType: DatabaseDraftType;
      readonly title: string;
      readonly inputSnapshotId: string | null;
      readonly templateVersionId: string;
      readonly sourceFingerprint: string;
      readonly provider: string;
      readonly model: string;
      readonly requestedByUserId: string;
    },
    generatedSections: readonly {
      readonly plan: ControlledTemplateSection;
      readonly generated: GeneratedDraftSection;
      readonly chunks: readonly RetrievedDraftChunk[];
    }[],
    planningLatencyMs: number,
    retrievalLatencyMs: number,
    generationLatencyMs: number,
    validationLatencyMs: number,
    started: number,
  ): Promise<{
    readonly citationCount: number;
    readonly claimCount: number;
    readonly placeholderCount: number;
    readonly sectionCount: number;
  }> {
    if (run.inputSnapshotId === null)
      throw new Error("DRAFT_INPUT_SNAPSHOT_REQUIRED");
    const inputSnapshotId = run.inputSnapshotId;
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.draftGenerationRun.findFirst({
        where: {
          cancellationRequestedAt: null,
          id: run.id,
          invalidatedAt: null,
          organisationId: run.organisationId,
          status: "VALIDATING",
          tenderId: run.tenderId,
        },
      });
      if (current === null) throw new Error("DRAFT_GENERATION_CANCELLED");
      const draft =
        run.draftId === null
          ? await transaction.draft.create({
              data: {
                createdByUserId: run.requestedByUserId,
                draftType: run.draftType,
                organisationId: run.organisationId,
                tenderId: run.tenderId,
                title: run.title,
              },
            })
          : await transaction.draft.findFirstOrThrow({
              where: {
                id: run.draftId,
                organisationId: run.organisationId,
                tenderId: run.tenderId,
              },
            });
      const priorCount = await transaction.draftVersion.count({
        where: { draftId: draft.id },
      });
      const version = await transaction.draftVersion.create({
        data: {
          createdByUserId: run.requestedByUserId,
          draftId: draft.id,
          generationRunId: run.id,
          inputSnapshotId,
          model: run.model,
          organisationId: run.organisationId,
          provider: run.provider,
          sourceFingerprint: run.sourceFingerprint,
          templateVersionId: run.templateVersionId,
          tenderId: run.tenderId,
          tenderVersionId: run.tenderVersionId,
          versionNumber: priorCount + 1,
        },
      });
      let claimCount = 0;
      let citationCount = 0;
      let placeholderCount = 0;
      for (const item of generatedSections) {
        const section = await transaction.draftSection.create({
          data: {
            content: item.generated.content,
            contentOrigin: "GENERATED",
            draftVersionId: version.id,
            heading: item.plan.heading,
            sectionKey: item.plan.key,
            sectionOrder: item.plan.order,
          },
        });
        for (const proposed of item.generated.claims) {
          const citedChunks = proposed.handles.map(
            (handle) => item.chunks[Number(handle.slice(1)) - 1],
          );
          const companyChunk = citedChunks.find(
            (chunk) => chunk?.source_class === "COMPANY_EVIDENCE",
          );
          const companyEvidence =
            companyChunk === undefined
              ? null
              : await this.companyEvidenceCitation(
                  transaction,
                  run.organisationId,
                  companyChunk,
                );
          const supportState = claimSupportState({
            approvedEvidence: companyEvidence !== null,
            citationCount: citedChunks.filter(Boolean).length,
            claimClass: proposed.claimClass,
            material: proposed.material,
            reviewedHumanInput: false,
          });
          const claim = await transaction.draftClaim.create({
            data: {
              claimClass: proposed.claimClass,
              claimText: proposed.claim,
              evidenceFactVersionId: companyEvidence?.factVersionId ?? null,
              material: proposed.material,
              sectionId: section.id,
              supportState,
            },
          });
          claimCount += 1;
          for (const [handleIndex, handle] of proposed.handles.entries()) {
            const chunk = citedChunks[handleIndex];
            if (chunk === undefined) throw new Error("DRAFT_CITATION_INVALID");
            const evidence = await this.companyEvidenceCitation(
              transaction,
              run.organisationId,
              chunk,
            );
            await transaction.draftClaimCitation.create({
              data: {
                claimId: claim.id,
                clauseLabel: chunk.clause_label,
                documentName: chunk.document_name,
                evidenceCitationId: evidence?.citationId ?? null,
                excerpt: chunk.content.slice(0, 1_000),
                extractionCitationId: chunk.extraction_citation_id,
                handle,
                pageNumber: chunk.page_number,
                ragChunkId: chunk.chunk_id,
                sourceChecksum: chunk.content_checksum,
              },
            });
            citationCount += 1;
          }
        }
        for (const proposed of item.generated.placeholders) {
          await transaction.draftPlaceholder.create({
            data: {
              approvalBlocking: true,
              draftVersionId: version.id,
              explanation: proposed.explanation.slice(0, 2_000),
              markerText: proposed.marker.slice(0, 1_000),
              organisationId: run.organisationId,
              placeholderType: proposed.type,
              sectionId: section.id,
              tenderId: run.tenderId,
            },
          });
          placeholderCount += 1;
        }
      }
      await transaction.draft.update({
        data: { currentVersionId: version.id },
        where: { id: draft.id },
      });
      await transaction.draftGenerationRun.update({
        data: {
          citationCount,
          completedAt: new Date(),
          currentStage: "Complete",
          draftId: draft.id,
          generationLatencyMs,
          placeholderCount,
          planningLatencyMs,
          progressPercentage: 100,
          retrievalLatencyMs,
          sectionCount: generatedSections.length,
          status: "COMPLETE",
          totalLatencyMs: Date.now() - started,
          validatedClaimCount: claimCount,
          validationLatencyMs,
        },
        where: { id: run.id },
      });
      return {
        citationCount,
        claimCount,
        placeholderCount,
        sectionCount: generatedSections.length,
      };
    });
  }

  private async companyEvidenceCitation(
    transaction: Prisma.TransactionClient,
    organisationId: string,
    chunk: RetrievedDraftChunk,
  ): Promise<{
    readonly citationId: string;
    readonly factVersionId: string;
  } | null> {
    if (chunk.source_class !== "COMPANY_EVIDENCE") return null;
    const fact = await transaction.companyEvidenceFact.findFirst({
      include: {
        currentVersion: {
          include: {
            citations: {
              where: { invalidatedAt: null, validationStatus: "VALID" },
            },
          },
        },
      },
      where: {
        id: chunk.source_record_id,
        invalidatedAt: null,
        organisationId,
      },
    });
    const citation = fact?.currentVersion?.citations[0];
    if (
      fact?.currentVersion?.reviewState !== "ACCEPTED" ||
      citation === undefined
    )
      throw new Error("COMPANY_FACT_SOURCE_INVALID");
    return {
      citationId: citation.id,
      factVersionId: fact.currentVersion.id,
    };
  }

  private async assertCurrentAuthority(
    runId: string,
    organisationId: string,
    tenderId: string,
  ): Promise<void> {
    const run = await this.database.draftGenerationRun.findFirst({
      where: { id: runId, invalidatedAt: null, organisationId, tenderId },
    });
    if (run === null) throw new Error("DRAFT_AUTHORITY_CHANGED");
    const current = await this.database.tender.findFirst({
      include: {
        currentVersion: {
          include: {
            activeEarlyRiskRun: true,
            activeEligibilityAssessmentRun: true,
            activeExtractionRun: true,
          },
        },
      },
      where: { id: tenderId, organisationId },
    });
    const checklist = await this.database.checklistGenerationRun.findFirst({
      where: {
        id: run.checklistGenerationRunId,
        invalidatedAt: null,
        organisationId,
        status: "COMPLETE",
        tenderId,
      },
    });
    const rag = await this.database.ragIndexRun.findFirst({
      where: {
        id: run.ragIndexRunId,
        invalidatedAt: null,
        organisationId,
        status: "COMPLETE",
        tenderId,
      },
    });
    const pursuitDecision = await this.database.earlyPursuitDecision.findFirst({
      where: {
        decision: "CONTINUE",
        id: run.pursuitDecisionId,
        organisationId,
        riskAnalysisRunId: run.riskAnalysisRunId,
        supersededAt: null,
        tenderId,
        tenderVersionId: run.tenderVersionId,
      },
    });
    if (
      current?.currentVersion?.id !== run.tenderVersionId ||
      current.currentVersion.activeExtractionRun?.id !== run.extractionRunId ||
      current.currentVersion.activeEarlyRiskRun?.id !== run.riskAnalysisRunId ||
      current.currentVersion.activeEligibilityAssessmentRun?.id !==
        run.assessmentRunId ||
      pursuitDecision === null ||
      checklist === null ||
      rag === null
    )
      throw new Error("DRAFT_AUTHORITY_CHANGED");
  }

  private async checkpoint(
    id: string,
    status:
      "SNAPSHOTTING" | "PLANNING" | "RETRIEVING" | "GENERATING" | "VALIDATING",
    progressPercentage: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new Error("DRAFT_GENERATION_CANCELLED");
    const updated = await this.database.draftGenerationRun.updateMany({
      data: {
        currentStage: status,
        eventSequence: { increment: 1 },
        progressPercentage,
        ...(status === "SNAPSHOTTING" ? { startedAt: new Date() } : {}),
        status,
      },
      where: {
        cancellationRequestedAt: null,
        id,
        invalidatedAt: null,
        status: { notIn: ["CANCELLED", "INVALIDATED"] },
      },
    });
    if (updated.count !== 1) throw new Error("DRAFT_GENERATION_CANCELLED");
  }
}

function parseTemplateSections(
  value: unknown,
): readonly ControlledTemplateSection[] {
  if (!Array.isArray(value)) throw new Error("DRAFT_TEMPLATE_INVALID");
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null)
      throw new Error("DRAFT_TEMPLATE_INVALID");
    const fields = entry as Record<string, unknown>;
    if (
      typeof fields.key !== "string" ||
      typeof fields.heading !== "string" ||
      typeof fields.order !== "number" ||
      typeof fields.formattingGuidance !== "string" ||
      !Array.isArray(fields.allowedClaimClasses) ||
      !Array.isArray(fields.requiredSourceClasses)
    )
      throw new Error("DRAFT_TEMPLATE_INVALID");
    return {
      allowedClaimClasses:
        fields.allowedClaimClasses as readonly DraftClaimClass[],
      formattingGuidance: fields.formattingGuidance,
      heading: fields.heading,
      key: fields.key,
      order: fields.order,
      requiredSourceClasses: fields.requiredSourceClasses as readonly string[],
    };
  });
}
