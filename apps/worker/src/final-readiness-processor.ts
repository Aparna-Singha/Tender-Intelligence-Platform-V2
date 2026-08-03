/* eslint-disable @typescript-eslint/explicit-function-return-type -- Prisma payload inference is retained across the bounded snapshot loader. */
import { Prisma, type PrismaClient } from "@tender/database";
import {
  classifyEvidenceExpiry,
  classifyFinalReadinessFinding,
  FINAL_READINESS_EXPIRY_POLICY_VERSION,
  FINAL_READINESS_POLICY_VERSION,
  FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION,
  normaliseFinalReadinessFingerprintInput,
  type FinalReadinessFindingCondition,
  type FinalReadinessTreatment,
} from "@tender/domain";
import { createHash, randomUUID } from "node:crypto";

export interface FinalReadinessJob {
  readonly finalReadinessRunId: string;
  readonly kind: "FINAL_READINESS";
  readonly organisationId: string;
  readonly requestId: string;
}

export function isFinalReadinessJob(
  value: unknown,
): value is FinalReadinessJob {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") ===
      "finalReadinessRunId,kind,organisationId,requestId" &&
    record.kind === "FINAL_READINESS" &&
    nonEmpty(record.finalReadinessRunId) &&
    nonEmpty(record.organisationId) &&
    nonEmpty(record.requestId)
  );
}

export interface DeterministicReadinessInput {
  readonly assessments: readonly {
    readonly citationId?: string;
    readonly id: string;
    readonly mandatory: boolean;
    readonly state: string;
  }[];
  readonly checklistItems: readonly {
    readonly citationId?: string;
    readonly id: string;
    readonly priority: string;
    readonly status: string;
  }[];
  readonly draftClaims: readonly {
    readonly citationId?: string;
    readonly expiryDate?: Date | null;
    readonly id: string;
    readonly material: boolean;
    readonly supportState: string;
  }[];
  readonly draftPlaceholders: readonly {
    readonly id: string;
    readonly material: boolean;
    readonly resolutionState: string;
  }[];
  readonly evidence: readonly {
    readonly assessmentId: string;
    readonly citationId?: string;
    readonly expiryDate: Date | null;
    readonly mandatory: boolean;
  }[];
  readonly evaluatedAt: Date;
  readonly extractionAmbiguities: readonly { readonly citationId: string }[];
  readonly invalidCitations: readonly { readonly provenance: Provenance }[];
  readonly priorRisks: readonly {
    readonly accepted: boolean;
    readonly citationId?: string;
    readonly id: string;
    readonly material: boolean;
    readonly open: boolean;
  }[];
  readonly approvalValid: boolean;
  readonly approvalDraftVersionId?: string;
}

interface Candidate {
  readonly condition: FinalReadinessFindingCondition;
  readonly explanation: string;
  readonly materiality: "NON_MATERIAL" | "MATERIAL" | "POTENTIALLY_BLOCKING";
  readonly provenance?: Provenance;
  readonly riskCitationId?: string;
  readonly title: string;
}

type Provenance =
  | { readonly kind: "CHECKLIST_ITEM"; readonly checklistItemId: string }
  | { readonly kind: "DRAFT_CLAIM"; readonly draftClaimId: string }
  | { readonly kind: "DRAFT_CITATION"; readonly draftCitationId: string }
  | { readonly kind: "DRAFT_PLACEHOLDER"; readonly draftPlaceholderId: string }
  | { readonly kind: "DRAFT_VERSION"; readonly draftVersionId: string }
  | {
      readonly kind: "ELIGIBILITY_ASSESSMENT";
      readonly eligibilityAssessmentId: string;
    }
  | {
      readonly kind: "EXTRACTION_CITATION";
      readonly extractionCitationId: string;
    }
  | { readonly kind: "RISK_FINDING"; readonly riskFindingId: string };

export function generateDeterministicReadinessFindings(
  input: DeterministicReadinessInput,
): readonly (Candidate & {
  readonly ruleCode: FinalReadinessFindingCondition;
  readonly treatment: FinalReadinessTreatment;
})[] {
  const candidates: Candidate[] = [];
  for (const assessment of input.assessments) {
    if (!assessment.mandatory) continue;
    const condition =
      assessment.state === "MISSING"
        ? "MANDATORY_ELIGIBILITY_MISSING"
        : assessment.state === "CONFLICT"
          ? "MANDATORY_ELIGIBILITY_CONFLICT"
          : assessment.state === "LIKELY_MET"
            ? "MANDATORY_ELIGIBILITY_LIKELY_MET"
            : undefined;
    if (condition !== undefined)
      candidates.push(
        candidate(
          condition,
          "Mandatory eligibility requires attention.",
          {
            kind: "ELIGIBILITY_ASSESSMENT",
            eligibilityAssessmentId: assessment.id,
          },
          "MATERIAL",
          assessment.citationId,
        ),
      );
  }
  for (const evidence of input.evidence) {
    const expiry = classifyEvidenceExpiry({
      evaluatedAt: input.evaluatedAt,
      expiryDate: evidence.expiryDate,
      relevant: evidence.mandatory,
    });
    if (expiry === undefined) continue;
    if (expiry.policyRuleId === "EVIDENCE_EXPIRED" && !evidence.mandatory)
      continue;
    const condition =
      expiry.policyRuleId === "EVIDENCE_EXPIRED"
        ? "EXPIRED_MANDATORY_EVIDENCE"
        : expiry.policyRuleId === "EVIDENCE_EXPIRING_WITHIN_30_DAYS"
          ? "EVIDENCE_EXPIRING_WITHIN_30_DAYS"
          : "PRODUCT_LIMITATION";
    candidates.push(
      candidate(
        condition,
        "Authoritative evidence expiry requires attention.",
        {
          kind: "ELIGIBILITY_ASSESSMENT",
          eligibilityAssessmentId: evidence.assessmentId,
        },
        "MATERIAL",
        evidence.citationId,
      ),
    );
  }
  for (const item of input.checklistItems) {
    if (
      ["RESOLVED", "DISMISSED", "SUPERSEDED", "INVALIDATED"].includes(
        item.status,
      )
    )
      continue;
    const condition =
      item.status === "READY_FOR_REASSESSMENT"
        ? "CHECKLIST_ITEM_READY_FOR_REASSESSMENT"
        : item.priority === "BLOCKING"
          ? "UNRESOLVED_BLOCKING_CHECKLIST_ITEM"
          : "UNRESOLVED_NON_BLOCKING_CHECKLIST_ITEM";
    candidates.push(
      candidate(
        condition,
        "Checklist work remains unresolved.",
        { kind: "CHECKLIST_ITEM", checklistItemId: item.id },
        "MATERIAL",
        item.citationId,
      ),
    );
  }
  for (const claim of input.draftClaims) {
    if (!claim.material) continue;
    const expiry = classifyEvidenceExpiry({
      evaluatedAt: input.evaluatedAt,
      expiryDate: claim.expiryDate ?? null,
      relevant: true,
    });
    if (expiry?.policyRuleId === "EVIDENCE_EXPIRED") {
      candidates.push(
        candidate(
          "EXPIRED_MATERIAL_DRAFT_CLAIM",
          "Evidence supporting a material draft claim has expired.",
          { kind: "DRAFT_CLAIM", draftClaimId: claim.id },
          "MATERIAL",
          claim.citationId,
        ),
      );
      continue;
    }
    if (claim.supportState === "SUPPORTED") continue;
    const condition =
      claim.supportState === "CONFLICTING"
        ? "CONFLICTING_MATERIAL_DRAFT_CLAIM"
        : "UNSUPPORTED_MATERIAL_DRAFT_CLAIM";
    candidates.push(
      candidate(
        condition,
        "A material draft claim lacks acceptable support.",
        { kind: "DRAFT_CLAIM", draftClaimId: claim.id },
        "MATERIAL",
        claim.citationId,
      ),
    );
  }
  for (const placeholder of input.draftPlaceholders) {
    if (placeholder.material && placeholder.resolutionState !== "RESOLVED")
      candidates.push(
        candidate(
          "UNRESOLVED_MATERIAL_PLACEHOLDER",
          "A material draft placeholder remains unresolved.",
          { kind: "DRAFT_PLACEHOLDER", draftPlaceholderId: placeholder.id },
        ),
      );
  }
  for (const ambiguity of input.extractionAmbiguities)
    candidates.push(
      candidate(
        "MATERIAL_EXTRACTION_AMBIGUITY",
        "A material extraction ambiguity requires human disposition.",
        {
          kind: "EXTRACTION_CITATION",
          extractionCitationId: ambiguity.citationId,
        },
        "MATERIAL",
        ambiguity.citationId,
      ),
    );
  for (const citation of input.invalidCitations)
    candidates.push(
      candidate(
        "INVALID_MATERIAL_CITATION",
        "A material citation failed deterministic relational validation.",
        citation.provenance,
        "POTENTIALLY_BLOCKING",
      ),
    );
  for (const risk of input.priorRisks) {
    const condition = risk.accepted
      ? risk.material
        ? "ACCEPTED_MATERIAL_RISK"
        : "ACCEPTED_NON_MATERIAL_RISK"
      : risk.open && risk.material
        ? "OPEN_DISPOSITIONABLE_MATERIAL_RISK"
        : undefined;
    if (condition !== undefined)
      candidates.push(
        candidate(
          condition,
          "A prior risk remains relevant to final readiness.",
          {
            kind: "RISK_FINDING",
            riskFindingId: risk.id,
          },
          risk.material ? "MATERIAL" : "NON_MATERIAL",
          risk.citationId,
        ),
      );
  }
  if (!input.approvalValid)
    candidates.push(
      candidate(
        "MISSING_INDEPENDENT_APPROVAL",
        "The required draft lacks verifiable role-at-approval evidence.",
        input.approvalDraftVersionId === undefined
          ? undefined
          : {
              kind: "DRAFT_VERSION",
              draftVersionId: input.approvalDraftVersionId,
            },
      ),
    );
  candidates.push(
    candidate(
      "NON_AFFILIATION_NOTICE",
      "The product is independent and is not affiliated with a government authority.",
      undefined,
      "NON_MATERIAL",
    ),
    candidate(
      "NO_COMPLETE_RISK_GUARANTEE",
      "Deterministic analysis cannot guarantee that every risk has been identified.",
      undefined,
      "NON_MATERIAL",
    ),
    candidate(
      "PRODUCT_LIMITATION",
      "Final readiness supports human review and is not approval to submit.",
      undefined,
      "NON_MATERIAL",
    ),
  );
  return candidates
    .map((item) => ({
      ...item,
      ruleCode: item.condition,
      treatment: classifyFinalReadinessFinding(item.condition).treatment,
    }))
    .sort((left, right) =>
      `${treatmentOrder(left.treatment)}:${left.ruleCode}:${provenanceKey(left.provenance)}`.localeCompare(
        `${treatmentOrder(right.treatment)}:${right.ruleCode}:${provenanceKey(right.provenance)}`,
      ),
    );
}

export class FinalReadinessProcessor {
  public constructor(private readonly database: PrismaClient) {}

  public async process(
    job: FinalReadinessJob,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const loaded = await this.load(job);
    if (loaded.run.status === "COMPLETED") return;
    if (["CANCELLED", "INVALIDATED"].includes(loaded.run.status)) return;
    await this.checkCancellation(loaded.run.id, loaded.finalRisk.id);
    await this.validateAuthority(loaded);
    await this.stage(loaded.run.id, "VALIDATING_SNAPSHOT", 15);
    signal?.throwIfAborted();
    await this.checkCancellation(loaded.run.id, loaded.finalRisk.id);

    await this.stage(loaded.run.id, "EVALUATING_FINAL_RISK", 40);
    await this.database.riskAnalysisRun.update({
      data: {
        currentStage: "ANALYSING",
        eventSequence: { increment: 1 },
        progressPercentage: 40,
        publicMessage: "Applying deterministic final-readiness risk rules",
        startedAt: loaded.finalRisk.startedAt ?? new Date(),
        status: "ANALYSING",
      },
      where: { id: loaded.finalRisk.id },
    });
    const findings = generateDeterministicReadinessFindings(
      toPolicyInput(loaded),
    );
    signal?.throwIfAborted();
    await this.checkCancellation(loaded.run.id, loaded.finalRisk.id);
    await this.stage(loaded.run.id, "PERSISTING_FINDINGS", 75);
    await this.validateAuthority(await this.load(job));
    signal?.throwIfAborted();
    await this.activate(job, loaded, findings);
  }

  public async fail(job: FinalReadinessJob, error: unknown): Promise<void> {
    const safeCode =
      error instanceof FinalReadinessProcessingFailure
        ? error.code
        : error instanceof Error &&
            (error.name === "AbortError" ||
              error.message === "Document job timed out")
          ? "FINAL_READINESS_TIMEOUT"
          : "FINAL_READINESS_PROCESSING_FAILED";
    const stale = [
      "AUTHORITATIVE_INPUT_CHANGED",
      "INPUT_FINGERPRINT_CHANGED",
      "NEWER_RUN_ALREADY_ACTIVE",
      "SOURCE_SET_CHANGED",
    ].includes(safeCode);
    const run = await this.database.finalReadinessRun.findFirst({
      select: { finalRiskRun: { select: { id: true } } },
      where: {
        id: job.finalReadinessRunId,
        organisationId: job.organisationId,
      },
    });
    await this.database.$transaction([
      this.database.finalReadinessRun.updateMany({
        data: {
          ...(stale
            ? {
                invalidatedAt: new Date(),
                invalidationCode: safeCode,
                status: "INVALIDATED" as const,
              }
            : {
                failedAt: new Date(),
                safeFailureCode: safeCode,
                status: "FAILED" as const,
              }),
        },
        where: {
          id: job.finalReadinessRunId,
          organisationId: job.organisationId,
          status: { in: ["QUEUED", "PROCESSING"] },
        },
      }),
      ...(run?.finalRiskRun === null || run?.finalRiskRun === undefined
        ? []
        : [
            this.database.riskAnalysisRun.updateMany({
              data: {
                ...(stale
                  ? {
                      invalidatedAt: new Date(),
                      publicMessage: "Final-readiness inputs changed",
                      status: "INVALIDATED" as const,
                    }
                  : {
                      failureCategory: safeCode,
                      internalFailureReference: randomUUID(),
                      publicMessage:
                        "Final-readiness risk analysis failed safely",
                      safeFailureMessage:
                        "Analysis could not be completed. Retry or contact support.",
                      status: "FAILED" as const,
                    }),
              },
              where: {
                id: run.finalRiskRun.id,
                status: { in: ["QUEUED", "ANALYSING", "VALIDATING"] },
              },
            }),
          ]),
    ]);
  }

  private async load(job: FinalReadinessJob) {
    const run = await this.database.finalReadinessRun.findFirst({
      include: {
        finalRiskRun: true,
        inputSnapshot: {
          include: {
            checklistGenerationRun: {
              include: { items: { include: { sourceCitations: true } } },
            },
            documents: true,
            earlyRiskRun: {
              include: {
                findings: { include: { citations: true, reviews: true } },
              },
            },
            eligibilityAssessmentRun: {
              include: {
                assessments: {
                  include: {
                    evidenceLinks: { include: { evidenceCitation: true } },
                  },
                },
              },
            },
            eligibilityInputSnapshot: {
              include: {
                documents: true,
                evidenceFacts: { include: { evidenceFactVersion: true } },
              },
            },
            extractionRun: { include: { citations: true, issues: true } },
            pursuitDecision: true,
            requiredDrafts: {
              include: {
                draft: true,
                draftVersion: {
                  include: {
                    sections: {
                      include: {
                        claims: { include: { citations: true } },
                        placeholders: true,
                      },
                    },
                  },
                },
                qualifyingReviewEvent: true,
                templateVersion: true,
              },
            },
          },
        },
        tender: { select: { currentVersionId: true } },
        tenderVersion: {
          select: {
            activeEarlyRiskRunId: true,
            activeEligibilityAssessmentRunId: true,
            activeExtractionRunId: true,
            activeFinalReadinessRunId: true,
            sourceFingerprint: true,
          },
        },
      },
      where: {
        id: job.finalReadinessRunId,
        organisationId: job.organisationId,
      },
    });
    if (run?.inputSnapshot === null || run?.inputSnapshot === undefined)
      throw new FinalReadinessProcessingFailure("SNAPSHOT_NOT_FOUND");
    if (run.finalRiskRun?.gateType !== "FINAL_READINESS")
      throw new FinalReadinessProcessingFailure("FINAL_RISK_RUN_INVALID");
    return { finalRisk: run.finalRiskRun, run, snapshot: run.inputSnapshot };
  }

  private async validateAuthority(
    loaded: Awaited<ReturnType<FinalReadinessProcessor["load"]>>,
  ): Promise<void> {
    const { run, snapshot } = loaded;
    const requiredDraft = snapshot.requiredDrafts[0];
    if (
      snapshot.requiredDrafts.length !== 1 ||
      requiredDraft === undefined ||
      run.organisationId !== snapshot.organisationId ||
      run.tenderId !== snapshot.tenderId ||
      run.tenderVersionId !== snapshot.tenderVersionId ||
      run.tender.currentVersionId !== run.tenderVersionId ||
      run.tenderVersion.activeExtractionRunId !== snapshot.extractionRunId ||
      run.tenderVersion.activeEarlyRiskRunId !== snapshot.earlyRiskRunId ||
      run.tenderVersion.activeEligibilityAssessmentRunId !==
        snapshot.eligibilityAssessmentRunId ||
      snapshot.extractionRun.status !== "COMPLETE" ||
      snapshot.extractionRun.invalidatedAt !== null ||
      snapshot.extractionRun.organisationId !== run.organisationId ||
      snapshot.extractionRun.tenderId !== run.tenderId ||
      snapshot.extractionRun.tenderVersionId !== run.tenderVersionId ||
      snapshot.earlyRiskRun.status !== "COMPLETE" ||
      snapshot.earlyRiskRun.invalidatedAt !== null ||
      snapshot.earlyRiskRun.organisationId !== run.organisationId ||
      snapshot.earlyRiskRun.tenderId !== run.tenderId ||
      snapshot.earlyRiskRun.tenderVersionId !== run.tenderVersionId ||
      snapshot.pursuitDecision.decision !== "CONTINUE" ||
      snapshot.pursuitDecision.supersededAt !== null ||
      snapshot.pursuitDecision.organisationId !== run.organisationId ||
      snapshot.pursuitDecision.tenderId !== run.tenderId ||
      snapshot.pursuitDecision.tenderVersionId !== run.tenderVersionId ||
      snapshot.eligibilityAssessmentRun.status !== "COMPLETE" ||
      snapshot.eligibilityAssessmentRun.invalidatedAt !== null ||
      snapshot.eligibilityAssessmentRun.organisationId !== run.organisationId ||
      snapshot.eligibilityAssessmentRun.tenderId !== run.tenderId ||
      snapshot.eligibilityAssessmentRun.tenderVersionId !==
        run.tenderVersionId ||
      snapshot.checklistGenerationRun.status !== "COMPLETE" ||
      snapshot.checklistGenerationRun.invalidatedAt !== null ||
      snapshot.checklistGenerationRun.organisationId !== run.organisationId ||
      snapshot.checklistGenerationRun.tenderId !== run.tenderId ||
      snapshot.checklistGenerationRun.tenderVersionId !== run.tenderVersionId ||
      requiredDraft.draft.currentVersionId !== requiredDraft.draftVersionId ||
      requiredDraft.draft.organisationId !== run.organisationId ||
      requiredDraft.draft.tenderId !== run.tenderId ||
      requiredDraft.draftVersion.organisationId !== run.organisationId ||
      requiredDraft.draftVersion.tenderId !== run.tenderId ||
      requiredDraft.draftVersion.tenderVersionId !== run.tenderVersionId ||
      requiredDraft.draftVersion.invalidatedAt !== null ||
      requiredDraft.draftVersion.reviewState !== "APPROVED" ||
      requiredDraft.qualifyingReviewEvent.action !== "APPROVE_VERSION" ||
      requiredDraft.qualifyingReviewEvent.actorUserId ===
        requiredDraft.draftCreatorUserId ||
      requiredDraft.qualifyingReviewEvent.actorRoleAtAction !==
        requiredDraft.templateVersion.requiredReviewRole ||
      run.policyVersion !== FINAL_READINESS_POLICY_VERSION ||
      run.evidenceExpiryPolicyVersion !==
        FINAL_READINESS_EXPIRY_POLICY_VERSION ||
      run.requiredDraftPolicyVersion !==
        FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION
    )
      await this.invalidate(
        run.id,
        loaded.finalRisk.id,
        "AUTHORITATIVE_INPUT_CHANGED",
      );
    const currentDocuments = await this.database.tenderDocument.findMany({
      orderBy: { id: "asc" },
      select: { id: true, role: true, sha256: true },
      where: {
        deletedAt: null,
        organisationId: run.organisationId,
        status: "READY",
        tenderVersionId: run.tenderVersionId,
      },
    });
    const currentSet = currentDocuments
      .map(({ id, role, sha256 }) => `${id}:${role}:${sha256}`)
      .sort();
    const snapshotSet = snapshot.documents
      .map(
        ({ checksum, role, tenderDocumentId }) =>
          `${tenderDocumentId}:${role}:${checksum}`,
      )
      .sort();
    if (JSON.stringify(currentSet) !== JSON.stringify(snapshotSet))
      await this.invalidate(run.id, loaded.finalRisk.id, "SOURCE_SET_CHANGED");
    const fingerprint = fingerprintFor(loaded);
    if (
      fingerprint !== snapshot.fingerprint ||
      fingerprint !== run.inputFingerprint
    )
      await this.invalidate(
        run.id,
        loaded.finalRisk.id,
        "INPUT_FINGERPRINT_CHANGED",
      );
  }

  private async activate(
    job: FinalReadinessJob,
    loaded: Awaited<ReturnType<FinalReadinessProcessor["load"]>>,
    findings: ReturnType<typeof generateDeterministicReadinessFindings>,
  ): Promise<void> {
    await this.database.$transaction(
      async (transaction) => {
        const current = await transaction.finalReadinessRun.findFirst({
          include: {
            finalRiskRun: true,
            tenderVersion: { select: { activeFinalReadinessRunId: true } },
          },
          where: {
            cancellationRequestedAt: null,
            id: loaded.run.id,
            organisationId: loaded.run.organisationId,
            status: "PROCESSING",
          },
        });
        if (
          current?.finalRiskRun?.id !== loaded.finalRisk.id ||
          current.finalRiskRun.gateType !== "FINAL_READINESS"
        )
          throw new FinalReadinessProcessingFailure("RUN_NOT_COMMITTABLE");
        if (
          current.tenderVersion.activeFinalReadinessRunId !== null &&
          current.tenderVersion.activeFinalReadinessRunId !== current.id
        )
          throw new FinalReadinessProcessingFailure("NEWER_RUN_ALREADY_ACTIVE");
        const [
          authority,
          tender,
          documents,
          draft,
          draftVersion,
          approval,
          extraction,
          earlyRisk,
          decision,
          eligibility,
          checklist,
        ] = await Promise.all([
          transaction.tenderVersion.findFirst({
            select: {
              activeEarlyRiskRunId: true,
              activeEligibilityAssessmentRunId: true,
              activeExtractionRunId: true,
              sourceFingerprint: true,
            },
            where: {
              id: current.tenderVersionId,
              tenderId: current.tenderId,
            },
          }),
          transaction.tender.findFirst({
            select: { currentVersionId: true },
            where: {
              id: current.tenderId,
              organisationId: current.organisationId,
            },
          }),
          transaction.tenderDocument.findMany({
            orderBy: { id: "asc" },
            select: { id: true, role: true, sha256: true },
            where: {
              deletedAt: null,
              organisationId: current.organisationId,
              status: "READY",
              tenderVersionId: current.tenderVersionId,
            },
          }),
          transaction.draft.findFirst({
            select: { currentVersionId: true },
            where: {
              id: loaded.snapshot.requiredDrafts[0]!.draftId,
              organisationId: current.organisationId,
              tenderId: current.tenderId,
            },
          }),
          transaction.draftVersion.findFirst({
            select: {
              invalidatedAt: true,
              reviewState: true,
              sourceFingerprint: true,
            },
            where: {
              id: loaded.snapshot.requiredDrafts[0]!.draftVersionId,
              organisationId: current.organisationId,
              tenderId: current.tenderId,
              tenderVersionId: current.tenderVersionId,
            },
          }),
          transaction.draftReviewEvent.findFirst({
            select: {
              action: true,
              actorRoleAtAction: true,
              actorUserId: true,
            },
            where: {
              id: loaded.snapshot.requiredDrafts[0]!.qualifyingReviewEventId,
              organisationId: current.organisationId,
              tenderId: current.tenderId,
            },
          }),
          transaction.extractionRun.findFirst({
            select: {
              invalidatedAt: true,
              sourceFingerprint: true,
              status: true,
            },
            where: {
              id: loaded.snapshot.extractionRunId,
              organisationId: current.organisationId,
              tenderId: current.tenderId,
              tenderVersionId: current.tenderVersionId,
            },
          }),
          transaction.riskAnalysisRun.findFirst({
            select: {
              gateType: true,
              invalidatedAt: true,
              sourceFingerprint: true,
              status: true,
            },
            where: {
              id: loaded.snapshot.earlyRiskRunId,
              organisationId: current.organisationId,
              tenderId: current.tenderId,
              tenderVersionId: current.tenderVersionId,
            },
          }),
          transaction.earlyPursuitDecision.findFirst({
            select: {
              decision: true,
              riskAnalysisRunId: true,
              supersededAt: true,
            },
            where: {
              id: loaded.snapshot.pursuitDecisionId,
              organisationId: current.organisationId,
              tenderId: current.tenderId,
              tenderVersionId: current.tenderVersionId,
            },
          }),
          transaction.eligibilityAssessmentRun.findFirst({
            include: { snapshot: { select: { fingerprint: true } } },
            where: {
              id: loaded.snapshot.eligibilityAssessmentRunId,
              organisationId: current.organisationId,
              tenderId: current.tenderId,
              tenderVersionId: current.tenderVersionId,
            },
          }),
          transaction.checklistGenerationRun.findFirst({
            select: {
              assessmentRunId: true,
              evidenceSnapshotId: true,
              invalidatedAt: true,
              sourceFingerprint: true,
              status: true,
            },
            where: {
              id: loaded.snapshot.checklistGenerationRunId,
              organisationId: current.organisationId,
              tenderId: current.tenderId,
              tenderVersionId: current.tenderVersionId,
            },
          }),
        ]);
        const snapshotDocuments = loaded.snapshot.documents
          .map(
            ({ checksum, role, tenderDocumentId }) =>
              `${tenderDocumentId}:${role}:${checksum}`,
          )
          .sort();
        const currentDocuments = documents
          .map(({ id, role, sha256 }) => `${id}:${role}:${sha256}`)
          .sort();
        const requiredDraft = loaded.snapshot.requiredDrafts[0]!;
        if (
          tender?.currentVersionId !== current.tenderVersionId ||
          authority?.activeExtractionRunId !==
            loaded.snapshot.extractionRunId ||
          authority?.activeEarlyRiskRunId !== loaded.snapshot.earlyRiskRunId ||
          authority?.activeEligibilityAssessmentRunId !==
            loaded.snapshot.eligibilityAssessmentRunId ||
          authority?.sourceFingerprint !==
            loaded.run.tenderVersion.sourceFingerprint ||
          JSON.stringify(snapshotDocuments) !==
            JSON.stringify(currentDocuments) ||
          draft?.currentVersionId !== requiredDraft.draftVersionId ||
          draftVersion?.invalidatedAt !== null ||
          draftVersion?.reviewState !== "APPROVED" ||
          draftVersion?.sourceFingerprint !== requiredDraft.sourceFingerprint ||
          approval?.action !== "APPROVE_VERSION" ||
          approval.actorRoleAtAction !==
            requiredDraft.templateVersion.requiredReviewRole ||
          approval.actorUserId === requiredDraft.draftCreatorUserId ||
          extraction?.status !== "COMPLETE" ||
          extraction.invalidatedAt !== null ||
          extraction.sourceFingerprint !==
            loaded.snapshot.extractionRun.sourceFingerprint ||
          earlyRisk?.status !== "COMPLETE" ||
          earlyRisk.gateType !== "EARLY" ||
          earlyRisk.invalidatedAt !== null ||
          earlyRisk.sourceFingerprint !==
            loaded.snapshot.earlyRiskRun.sourceFingerprint ||
          decision?.decision !== "CONTINUE" ||
          decision.supersededAt !== null ||
          decision.riskAnalysisRunId !== loaded.snapshot.earlyRiskRunId ||
          eligibility?.status !== "COMPLETE" ||
          eligibility.invalidatedAt !== null ||
          eligibility.snapshotId !==
            loaded.snapshot.eligibilityInputSnapshotId ||
          eligibility.snapshot.fingerprint !==
            loaded.snapshot.eligibilityInputSnapshot.fingerprint ||
          checklist?.status !== "COMPLETE" ||
          checklist.invalidatedAt !== null ||
          checklist.assessmentRunId !==
            loaded.snapshot.eligibilityAssessmentRunId ||
          checklist.evidenceSnapshotId !==
            loaded.snapshot.eligibilityInputSnapshotId ||
          checklist.sourceFingerprint !==
            loaded.snapshot.checklistGenerationRun.sourceFingerprint
        )
          throw new FinalReadinessProcessingFailure(
            "AUTHORITATIVE_INPUT_CHANGED",
          );
        await transaction.finalReadinessFinding.deleteMany({
          where: { runId: current.id },
        });
        await transaction.riskFinding.deleteMany({
          where: { riskAnalysisRunId: loaded.finalRisk.id },
        });
        const validRiskCitationIds = new Set(
          loaded.snapshot.extractionRun.citations
            .filter(
              ({ sourceChecksum, validationStatus }) =>
                sourceChecksum.length === 64 &&
                validationStatus === "VALIDATED",
            )
            .map(({ id }) => id),
        );
        let order = 1;
        for (const finding of findings) {
          const risk =
            finding.materiality === "NON_MATERIAL" ||
            finding.riskCitationId === undefined ||
            !validRiskCitationIds.has(finding.riskCitationId)
              ? null
              : await transaction.riskFinding.create({
                  data: {
                    blocking: finding.treatment === "BLOCKER",
                    category: "FINAL_READINESS",
                    confidence: "HIGH",
                    deterministicRuleId: finding.ruleCode,
                    deterministicRuleVersion: FINAL_READINESS_POLICY_VERSION,
                    explanation: finding.explanation,
                    extractionRunId: loaded.snapshot.extractionRunId,
                    materiality: finding.materiality,
                    organisationId: current.organisationId,
                    riskAnalysisRunId: loaded.finalRisk.id,
                    severity: severityFor(finding.treatment),
                    sourceInputFingerprint: current.inputFingerprint,
                    sourceSupportedRationale: finding.explanation,
                    tenderId: current.tenderId,
                    tenderVersionId: current.tenderVersionId,
                    title: finding.title,
                  },
                });
          if (risk !== null)
            await transaction.riskFindingCitation.create({
              data: {
                extractionCitationId: finding.riskCitationId!,
                riskFindingId: risk.id,
                validationStatus: "VALIDATED",
              },
            });
          const provenance =
            finding.provenance ??
            (risk === null
              ? undefined
              : { kind: "RISK_FINDING" as const, riskFindingId: risk.id });
          if (
            finding.materiality !== "NON_MATERIAL" &&
            provenance === undefined
          )
            throw new FinalReadinessProcessingFailure(
              "MATERIAL_PROVENANCE_INVALID",
            );
          await transaction.finalReadinessFinding.create({
            data: {
              explanation: finding.explanation,
              findingOrder: order,
              materiality: finding.materiality,
              organisationId: current.organisationId,
              ...(provenance === undefined
                ? {}
                : { provenance: { create: provenance } }),
              provenanceValid:
                provenance !== undefined ||
                finding.materiality === "NON_MATERIAL",
              ruleCode: finding.ruleCode,
              runId: current.id,
              tenderId: current.tenderId,
              title: finding.title,
              treatment: finding.treatment,
            },
          });
          order += 1;
        }
        const now = new Date();
        await transaction.riskAnalysisRun.update({
          data: {
            completedAt: now,
            currentStage: "COMPLETE",
            eventSequence: { increment: 1 },
            progressPercentage: 100,
            publicMessage:
              "Deterministic final-readiness risk analysis complete",
            status: "COMPLETE",
            summary: {
              findings: findings.filter(
                ({ materiality }) => materiality !== "NON_MATERIAL",
              ).length,
            },
          },
          where: { id: loaded.finalRisk.id },
        });
        await transaction.finalReadinessRun.update({
          data: {
            completedAt: now,
            currentStage: "COMPLETE",
            eventSequence: { increment: 1 },
            progressPercentage: 100,
            status: "COMPLETED",
          },
          where: { id: current.id },
        });
        await transaction.tenderVersion.update({
          data: { activeFinalReadinessRunId: current.id },
          where: { id: current.tenderVersionId },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: current.requestedByUserId,
            eventType: "FINAL_READINESS_ACTIVATED",
            organisationId: current.organisationId,
            outcome: "SUCCESS",
            requestId: job.requestId,
            subjectId: current.id,
            subjectType: "final_readiness_run",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async stage(
    id: string,
    stage: string,
    progressPercentage: number,
  ): Promise<void> {
    const result = await this.database.finalReadinessRun.updateMany({
      data: {
        currentStage: stage,
        eventSequence: { increment: 1 },
        progressPercentage,
        startedAt: new Date(),
        status: "PROCESSING",
      },
      where: {
        cancellationRequestedAt: null,
        id,
        status: { in: ["QUEUED", "PROCESSING"] },
      },
    });
    if (result.count !== 1)
      throw new FinalReadinessProcessingFailure("RUN_NOT_PROCESSABLE");
  }

  private async checkCancellation(
    runId: string,
    riskId: string,
  ): Promise<void> {
    const run = await this.database.finalReadinessRun.findUnique({
      select: { cancellationRequestedAt: true },
      where: { id: runId },
    });
    if (run?.cancellationRequestedAt === null) return;
    const now = new Date();
    await this.database.$transaction([
      this.database.finalReadinessRun.updateMany({
        data: {
          cancelledAt: now,
          currentStage: "CANCELLED",
          status: "CANCELLED",
        },
        where: { id: runId, status: { in: ["QUEUED", "PROCESSING"] } },
      }),
      this.database.riskAnalysisRun.updateMany({
        data: {
          currentStage: "CANCELLED",
          publicMessage: "Final-readiness risk analysis cancelled",
          status: "CANCELLED",
        },
        where: {
          id: riskId,
          status: { in: ["QUEUED", "ANALYSING", "VALIDATING"] },
        },
      }),
    ]);
    throw new FinalReadinessProcessingFailure("RUN_CANCELLED");
  }

  private async invalidate(
    runId: string,
    riskId: string,
    code: string,
  ): Promise<never> {
    const now = new Date();
    await this.database.$transaction([
      this.database.finalReadinessRun.updateMany({
        data: {
          currentStage: "FAILED",
          invalidatedAt: now,
          invalidationCode: code,
          status: "INVALIDATED",
        },
        where: { id: runId, status: { in: ["QUEUED", "PROCESSING"] } },
      }),
      this.database.riskAnalysisRun.updateMany({
        data: {
          currentStage: "INVALIDATED",
          invalidatedAt: now,
          publicMessage: "Final-readiness inputs changed",
          status: "INVALIDATED",
        },
        where: {
          id: riskId,
          status: { in: ["QUEUED", "ANALYSING", "VALIDATING"] },
        },
      }),
    ]);
    throw new FinalReadinessProcessingFailure(code);
  }
}

export class FinalReadinessProcessingFailure extends Error {
  public constructor(public readonly code: string) {
    super(code);
  }
}

function fingerprintFor(
  loaded: Awaited<ReturnType<FinalReadinessProcessor["load"]>>,
): string {
  const { run, snapshot } = loaded;
  const draft = snapshot.requiredDrafts[0];
  if (draft === undefined) return "";
  const canonical = normaliseFinalReadinessFingerprintInput({
    checklistFingerprint: snapshot.checklistGenerationRun.sourceFingerprint,
    checklistRunId: snapshot.checklistGenerationRunId,
    consolidatedDraftFingerprint: draft.sourceFingerprint,
    consolidatedDraftId: draft.draftId,
    consolidatedDraftVersionId: draft.draftVersionId,
    documents: snapshot.documents.map(
      ({ checksum, role, tenderDocumentId }) => ({
        checksum,
        id: tenderDocumentId,
        role,
      }),
    ),
    earlyRiskFingerprint: snapshot.earlyRiskRun.sourceFingerprint,
    earlyRiskRunId: snapshot.earlyRiskRunId,
    eligibilityRunId: snapshot.eligibilityAssessmentRunId,
    evidenceSnapshotFingerprint: snapshot.eligibilityInputSnapshot.fingerprint,
    evidenceSnapshotId: snapshot.eligibilityInputSnapshotId,
    extractionFingerprint: snapshot.extractionRun.sourceFingerprint,
    extractionRunId: snapshot.extractionRunId,
    organisationId: run.organisationId,
    policyVersions: [
      run.policyVersion,
      run.evidenceExpiryPolicyVersion,
      run.requiredDraftPolicyVersion,
    ],
    pursuitDecisionId: snapshot.pursuitDecisionId,
    tenderId: run.tenderId,
    tenderVersionFingerprint: run.tenderVersion.sourceFingerprint,
    tenderVersionId: run.tenderVersionId,
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function toPolicyInput(
  loaded: Awaited<ReturnType<FinalReadinessProcessor["load"]>>,
): DeterministicReadinessInput {
  const { snapshot } = loaded;
  const requiredDraft = snapshot.requiredDrafts[0]!;
  const firstCitation = snapshot.extractionRun.citations[0];
  return {
    approvalValid:
      requiredDraft.qualifyingReviewEvent.actorRoleAtAction !== null &&
      requiredDraft.qualifyingReviewEvent.actorRoleAtAction ===
        requiredDraft.templateVersion.requiredReviewRole &&
      requiredDraft.qualifyingReviewEvent.actorUserId !==
        requiredDraft.draftCreatorUserId,
    approvalDraftVersionId: requiredDraft.draftVersionId,
    assessments: snapshot.eligibilityAssessmentRun.assessments.map(
      ({ currentState, id, requirementObligation, tenderCitationId }) => ({
        citationId: tenderCitationId,
        id,
        mandatory: requirementObligation === "MANDATORY",
        state: currentState,
      }),
    ),
    checklistItems: snapshot.checklistGenerationRun.items.map(
      ({ currentPriority, id, sourceCitations, status }) => ({
        ...(sourceCitations[0]?.extractionCitationId === undefined
          ? {}
          : { citationId: sourceCitations[0].extractionCitationId }),
        id,
        priority: currentPriority,
        status,
      }),
    ),
    draftClaims: requiredDraft.draftVersion.sections.flatMap(({ claims }) =>
      claims.map(
        ({ citations, evidenceFactVersionId, id, material, supportState }) => ({
          ...(citations.find(
            ({ extractionCitationId }) => extractionCitationId !== null,
          )?.extractionCitationId === undefined ||
          citations.find(
            ({ extractionCitationId }) => extractionCitationId !== null,
          )?.extractionCitationId === null
            ? {}
            : {
                citationId: citations.find(
                  ({ extractionCitationId }) => extractionCitationId !== null,
                )!.extractionCitationId!,
              }),
          id,
          expiryDate:
            snapshot.eligibilityInputSnapshot.evidenceFacts.find(
              ({ evidenceFactVersionId: snapshotFactVersionId }) =>
                snapshotFactVersionId === evidenceFactVersionId,
            )?.evidenceFactVersion.validUntil ?? null,
          material,
          supportState,
        }),
      ),
    ),
    draftPlaceholders: requiredDraft.draftVersion.sections.flatMap(
      ({ placeholders }) =>
        placeholders.map(({ id, material, resolutionState }) => ({
          id,
          material,
          resolutionState,
        })),
    ),
    evidence: snapshot.eligibilityAssessmentRun.assessments.flatMap(
      (assessment) =>
        assessment.evidenceLinks.map((link) => {
          const document = snapshot.eligibilityInputSnapshot.documents.find(
            (item) => item.id === link.snapshotDocumentId,
          );
          return {
            assessmentId: assessment.id,
            citationId: assessment.tenderCitationId,
            expiryDate: document?.expiryDate ?? null,
            mandatory: assessment.requirementObligation === "MANDATORY",
          };
        }),
    ),
    evaluatedAt: snapshot.capturedAt,
    extractionAmbiguities:
      firstCitation === undefined
        ? []
        : snapshot.extractionRun.issues
            .filter(
              ({ requiresHumanReview, resolvedAt }) =>
                requiresHumanReview && resolvedAt === null,
            )
            .map(() => ({ citationId: firstCitation.id })),
    invalidCitations: [
      ...requiredDraft.draftVersion.sections.flatMap(({ claims }) =>
        claims.flatMap((claim) =>
          claim.material
            ? claim.citations
                .filter(
                  ({
                    evidenceCitationId,
                    extractionCitationId,
                    sourceChecksum,
                  }) =>
                    sourceChecksum.length !== 64 ||
                    (evidenceCitationId === null &&
                      extractionCitationId === null),
                )
                .map(({ id }) => ({
                  provenance: {
                    draftCitationId: id,
                    kind: "DRAFT_CITATION" as const,
                  },
                }))
            : [],
        ),
      ),
      ...snapshot.eligibilityAssessmentRun.assessments.flatMap((assessment) =>
        assessment.requirementObligation === "MANDATORY"
          ? assessment.evidenceLinks
              .filter(
                ({ evidenceCitation }) =>
                  evidenceCitation !== null &&
                  (evidenceCitation.invalidatedAt !== null ||
                    evidenceCitation.validationStatus !== "VALID"),
              )
              .map(() => ({
                provenance: {
                  eligibilityAssessmentId: assessment.id,
                  kind: "ELIGIBILITY_ASSESSMENT" as const,
                },
              }))
          : [],
      ),
    ],
    priorRisks: snapshot.earlyRiskRun.findings.map(
      ({ citations, findingStatus, id, materiality, reviews }) => ({
        accepted:
          findingStatus === "ACCEPTED_RISK" ||
          reviews.some(({ action }) => action === "ACCEPT_RISK"),
        id,
        ...(citations[0]?.extractionCitationId === undefined
          ? {}
          : { citationId: citations[0].extractionCitationId }),
        material: materiality !== "NON_MATERIAL",
        open: findingStatus === "OPEN",
      }),
    ),
  };
}

function candidate(
  condition: FinalReadinessFindingCondition,
  explanation: string,
  provenance?: Provenance,
  materiality: Candidate["materiality"] = "MATERIAL",
  riskCitationId?: string,
): Candidate {
  return {
    condition,
    explanation,
    materiality,
    ...(provenance === undefined ? {} : { provenance }),
    ...(riskCitationId === undefined ? {} : { riskCitationId }),
    title: condition.toLowerCase().replaceAll("_", " "),
  };
}
function nonEmpty(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 128
  );
}
function provenanceKey(value: Provenance | undefined): string {
  return value === undefined ? "" : JSON.stringify(value);
}
function treatmentOrder(value: FinalReadinessTreatment): number {
  return [
    "BLOCKER",
    "HUMAN_DISPOSITION_REQUIRED",
    "WARNING",
    "INFORMATIONAL",
  ].indexOf(value);
}
function severityFor(
  value: FinalReadinessTreatment,
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  return value === "BLOCKER"
    ? "CRITICAL"
    : value === "HUMAN_DISPOSITION_REQUIRED"
      ? "HIGH"
      : value === "WARNING"
        ? "MEDIUM"
        : "LOW";
}
