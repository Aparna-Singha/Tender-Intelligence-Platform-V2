import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@tender/database";
import {
  CONTROLLED_REVIEW_PACKAGE_CONTENT_POLICY_VERSION,
  CONTROLLED_REVIEW_PACKAGE_POLICY_VERSION,
  CONTROLLED_REVIEW_PACKAGE_RENDERER_COMPATIBILITY_VERSION,
} from "@tender/domain";
import { PRISMA_CLIENT } from "../infrastructure.tokens.js";

export interface ControlledPackageFreshnessResult {
  readonly fresh: boolean;
  readonly freshness: "CURRENT" | "STALE" | "INVALIDATED";
  readonly reasons: readonly string[];
}

@Injectable()
export class ControlledReviewPackageFreshnessService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
  ) {}

  public async evaluate(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<ControlledPackageFreshnessResult> {
    const run = await this.database.controlledReviewPackageRun.findFirst({
      include: {
        inputSnapshot: { include: { documents: true, templateVersion: true } },
      },
      where: { id: runId, organisationId, tenderId },
    });
    if (run?.inputSnapshot === null || run?.inputSnapshot === undefined)
      return {
        fresh: false,
        freshness: "INVALIDATED",
        reasons: ["SNAPSHOT_MISSING"],
      };
    if (run.invalidatedAt !== null || run.generationStatus === "INVALIDATED")
      return {
        fresh: false,
        freshness: "INVALIDATED",
        reasons: ["RUN_INVALIDATED"],
      };
    const snapshot = run.inputSnapshot;
    const [tender, version, readiness, decision, documents, template] =
      await Promise.all([
        this.database.tender.findFirst({
          select: { currentVersionId: true },
          where: { id: tenderId, organisationId },
        }),
        this.database.tenderVersion.findFirst({
          select: { activeFinalReadinessRunId: true },
          where: { id: run.tenderVersionId, tenderId },
        }),
        this.database.finalReadinessRun.findFirst({
          select: {
            finalRiskRun: { select: { invalidatedAt: true, status: true } },
            inputFingerprint: true,
            invalidatedAt: true,
            status: true,
          },
          where: {
            id: snapshot.finalReadinessRunId,
            organisationId,
            tenderId,
          },
        }),
        this.database.finalReadinessDecision.findFirst({
          select: { disposition: true, supersededAt: true },
          where: {
            id: snapshot.finalReadinessDecisionId,
            organisationId,
            tenderId,
          },
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
        this.database.exportTemplate.findFirst({
          select: { activeVersionId: true },
          where: { id: snapshot.templateVersion.templateId, retiredAt: null },
        }),
      ]);
    const reasons: string[] = [];
    if (tender?.currentVersionId !== run.tenderVersionId)
      reasons.push("TENDER_VERSION_CHANGED");
    if (version?.activeFinalReadinessRunId !== snapshot.finalReadinessRunId)
      reasons.push("FINAL_READINESS_RUN_CHANGED");
    if (
      readiness?.status !== "COMPLETED" ||
      readiness.invalidatedAt !== null ||
      readiness.finalRiskRun?.status !== "COMPLETE" ||
      readiness.finalRiskRun.invalidatedAt !== null
    )
      reasons.push("FINAL_READINESS_AUTHORITY_CHANGED");
    if (
      decision?.disposition !== "PROCEED_TO_CONTROLLED_EXPORT_REVIEW" ||
      decision.supersededAt !== null
    )
      reasons.push("PROCEED_DECISION_CHANGED");
    if (template?.activeVersionId !== snapshot.templateVersionId)
      reasons.push("EXPORT_TEMPLATE_CHANGED");
    if (
      run.generationPolicyVersion !==
        CONTROLLED_REVIEW_PACKAGE_POLICY_VERSION ||
      run.contentPolicyVersion !==
        CONTROLLED_REVIEW_PACKAGE_CONTENT_POLICY_VERSION ||
      run.rendererCompatibilityVersion !==
        CONTROLLED_REVIEW_PACKAGE_RENDERER_COMPATIBILITY_VERSION
    )
      reasons.push("PACKAGE_POLICY_CHANGED");
    const expectedDocuments = snapshot.documents
      .map(
        ({ checksum, tenderDocumentId }) => `${tenderDocumentId}:${checksum}`,
      )
      .sort();
    const currentDocuments = documents
      .map(({ id, sha256 }) => `${id}:${sha256}`)
      .sort();
    if (JSON.stringify(expectedDocuments) !== JSON.stringify(currentDocuments))
      reasons.push("SOURCE_SET_CHANGED");
    return {
      fresh: reasons.length === 0,
      freshness: reasons.length === 0 ? "CURRENT" : "STALE",
      reasons,
    };
  }
}
