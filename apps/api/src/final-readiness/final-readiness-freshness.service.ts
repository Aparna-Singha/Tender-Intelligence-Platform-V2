import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@tender/database";
import {
  FINAL_READINESS_EXPIRY_POLICY_VERSION,
  FINAL_READINESS_POLICY_VERSION,
  FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION,
  normaliseFinalReadinessFingerprintInput,
} from "@tender/domain";
import { createHash } from "node:crypto";
import { PRISMA_CLIENT } from "../infrastructure.tokens.js";

export interface FinalReadinessFreshness {
  readonly fresh: boolean;
  readonly reasons: readonly string[];
}

@Injectable()
export class FinalReadinessFreshnessService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
  ) {}

  public async evaluate(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<FinalReadinessFreshness> {
    const run = await this.database.finalReadinessRun.findFirst({
      include: {
        finalRiskRun: true,
        inputSnapshot: {
          include: {
            checklistGenerationRun: true,
            documents: true,
            earlyRiskRun: true,
            eligibilityAssessmentRun: true,
            eligibilityInputSnapshot: true,
            extractionRun: true,
            pursuitDecision: true,
            requiredDrafts: {
              include: {
                draftVersion: true,
                qualifyingReviewEvent: true,
                templateVersion: true,
              },
            },
          },
        },
      },
      where: { id: runId, organisationId, tenderId },
    });
    if (run?.inputSnapshot === null || run?.inputSnapshot === undefined)
      return { fresh: false, reasons: ["SNAPSHOT_MISSING"] };
    const snapshot = run.inputSnapshot;
    const [tender, version, documents, draft] = await Promise.all([
      this.database.tender.findFirst({
        select: { currentVersionId: true },
        where: { id: tenderId, organisationId },
      }),
      this.database.tenderVersion.findFirst({
        select: {
          activeEarlyRiskRunId: true,
          activeEligibilityAssessmentRunId: true,
          activeExtractionRunId: true,
          activeFinalReadinessRunId: true,
          sourceFingerprint: true,
        },
        where: { id: run.tenderVersionId, tenderId },
      }),
      this.database.tenderDocument.findMany({
        orderBy: { id: "asc" },
        select: { id: true, sha256: true },
        where: {
          deletedAt: null,
          organisationId,
          status: "READY",
          tenderVersionId: run.tenderVersionId,
        },
      }),
      snapshot.requiredDrafts.length === 1
        ? this.database.draft.findFirst({
            select: { currentVersionId: true },
            where: {
              id: snapshot.requiredDrafts[0]!.draftId,
              organisationId,
              tenderId,
            },
          })
        : Promise.resolve(null),
    ]);
    const reasons: string[] = [];
    if (tender?.currentVersionId !== run.tenderVersionId)
      reasons.push("TENDER_VERSION_CHANGED");
    if (version?.activeExtractionRunId !== snapshot.extractionRunId)
      reasons.push("EXTRACTION_CHANGED");
    if (
      run.status === "COMPLETED" &&
      version?.activeFinalReadinessRunId !== run.id
    )
      reasons.push("ACTIVE_READINESS_RUN_CHANGED");
    if (version?.activeEarlyRiskRunId !== snapshot.earlyRiskRunId)
      reasons.push("EARLY_RISK_CHANGED");
    if (
      version?.activeEligibilityAssessmentRunId !==
      snapshot.eligibilityAssessmentRunId
    )
      reasons.push("ELIGIBILITY_CHANGED");
    const snapshottedDocuments = snapshot.documents
      .map(
        ({ checksum, tenderDocumentId }) => `${tenderDocumentId}:${checksum}`,
      )
      .sort();
    const currentDocuments = documents
      .map(({ id, sha256 }) => `${id}:${sha256}`)
      .sort();
    if (
      JSON.stringify(snapshottedDocuments) !== JSON.stringify(currentDocuments)
    )
      reasons.push("SOURCE_SET_CHANGED");
    if (
      snapshot.requiredDrafts.length !== 1 ||
      draft?.currentVersionId !== snapshot.requiredDrafts[0]?.draftVersionId
    )
      reasons.push("REQUIRED_DRAFT_CHANGED");
    const requiredDraft = snapshot.requiredDrafts[0];
    if (
      requiredDraft?.draftVersion.invalidatedAt !== null ||
      requiredDraft.draftVersion.reviewState !== "APPROVED" ||
      requiredDraft.qualifyingReviewEvent.action !== "APPROVE_VERSION" ||
      requiredDraft.qualifyingReviewEvent.actorRoleAtAction === null ||
      requiredDraft.qualifyingReviewEvent.actorRoleAtAction !==
        requiredDraft.templateVersion.requiredReviewRole
    )
      reasons.push("REQUIRED_DRAFT_APPROVAL_CHANGED");
    if (
      snapshot.extractionRun.status !== "COMPLETE" ||
      snapshot.extractionRun.invalidatedAt !== null ||
      snapshot.earlyRiskRun.status !== "COMPLETE" ||
      snapshot.earlyRiskRun.invalidatedAt !== null ||
      snapshot.pursuitDecision.supersededAt !== null ||
      snapshot.pursuitDecision.decision !== "CONTINUE" ||
      snapshot.eligibilityAssessmentRun.status !== "COMPLETE" ||
      snapshot.eligibilityAssessmentRun.invalidatedAt !== null ||
      snapshot.checklistGenerationRun.status !== "COMPLETE" ||
      snapshot.checklistGenerationRun.invalidatedAt !== null
    )
      reasons.push("SNAPSHOTTED_AUTHORITY_CHANGED");
    if (
      snapshot.policyVersion !== FINAL_READINESS_POLICY_VERSION ||
      snapshot.evidenceExpiryPolicyVersion !==
        FINAL_READINESS_EXPIRY_POLICY_VERSION ||
      snapshot.requiredDraftPolicyVersion !==
        FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION
    )
      reasons.push("POLICY_VERSION_CHANGED");
    if (requiredDraft !== undefined && version !== null) {
      const canonical = normaliseFinalReadinessFingerprintInput({
        checklistFingerprint: snapshot.checklistGenerationRun.sourceFingerprint,
        checklistRunId: snapshot.checklistGenerationRunId,
        consolidatedDraftFingerprint: requiredDraft.sourceFingerprint,
        consolidatedDraftId: requiredDraft.draftId,
        consolidatedDraftVersionId: requiredDraft.draftVersionId,
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
        evidenceSnapshotFingerprint:
          snapshot.eligibilityInputSnapshot.fingerprint,
        evidenceSnapshotId: snapshot.eligibilityInputSnapshotId,
        extractionFingerprint: snapshot.extractionRun.sourceFingerprint,
        extractionRunId: snapshot.extractionRunId,
        organisationId,
        policyVersions: [
          snapshot.policyVersion,
          snapshot.evidenceExpiryPolicyVersion,
          snapshot.requiredDraftPolicyVersion,
        ],
        pursuitDecisionId: snapshot.pursuitDecisionId,
        tenderId,
        tenderVersionFingerprint: version.sourceFingerprint,
        tenderVersionId: run.tenderVersionId,
      });
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(canonical))
        .digest("hex");
      if (
        fingerprint !== snapshot.fingerprint ||
        fingerprint !== run.inputFingerprint
      )
        reasons.push("INPUT_FINGERPRINT_CHANGED");
    }
    if (run.invalidatedAt !== null || run.status === "INVALIDATED")
      reasons.push("RUN_INVALIDATED");
    return { fresh: reasons.length === 0, reasons };
  }
}
