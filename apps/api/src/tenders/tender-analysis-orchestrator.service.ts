import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { PrismaClient } from "@tender/database";
import { PRISMA_CLIENT } from "../infrastructure.tokens.js";
import { ChecklistsService } from "../checklists/checklists.service.js";
import { EligibilityService } from "../eligibility/eligibility.service.js";
import { ExtractionsService } from "../extractions/extractions.service.js";
import { RagService } from "../rag/rag.service.js";
import { RisksService } from "../risks/risks.service.js";

@Injectable()
export class TenderAnalysisOrchestratorService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    private readonly extractions: ExtractionsService,
    private readonly risks: RisksService,
    private readonly eligibility: EligibilityService,
    private readonly checklists: ChecklistsService,
    private readonly rag: RagService,
  ) {}

  public async ensureCurrentPipeline(
    organisationId: string,
    tenderId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    const version = await this.loadCurrentVersion(organisationId, tenderId);
    if (version === null) return;
    if (!this.canAnalyse(version.documents)) return;

    await this.tryStartExtraction(
      organisationId,
      tenderId,
      version.id,
      userId,
      requestId,
    );

    const extractionVersion = await this.loadCurrentVersion(
      organisationId,
      tenderId,
    );
    const extraction = extractionVersion?.activeExtractionRun;
    if (extraction?.status !== "COMPLETE" || extraction.invalidatedAt !== null)
      return;

    await Promise.all([
      this.tryStartRisk(organisationId, tenderId, version.id, userId, requestId),
      this.tryStartTenderOnlyRag(
        organisationId,
        tenderId,
        version.id,
        userId,
        requestId,
      ),
    ]);

    const riskVersion = await this.loadCurrentVersion(organisationId, tenderId);
    const risk = riskVersion?.activeEarlyRiskRun;
    if (
      riskVersion === null ||
      risk?.status !== "COMPLETE" ||
      risk.invalidatedAt !== null
    )
      return;

    const continueDecision = await this.database.earlyPursuitDecision.findFirst({
      where: {
        decision: "CONTINUE",
        organisationId,
        riskAnalysisRunId: risk.id,
        supersededAt: null,
        tenderId,
        tenderVersionId: riskVersion.id,
      },
    });
    if (continueDecision === null) return;

    await this.tryStartEligibility(
      organisationId,
      tenderId,
      riskVersion.id,
      userId,
      requestId,
    );

    const assessmentVersion = await this.loadCurrentVersion(
      organisationId,
      tenderId,
    );
    const assessment = assessmentVersion?.activeEligibilityAssessmentRun;
    if (
      assessment?.status !== "COMPLETE" ||
      assessment.invalidatedAt !== null
    )
      return;

    await this.tryStartChecklist(
      organisationId,
      tenderId,
      assessmentVersion?.id ?? version.id,
      userId,
      requestId,
    );
  }

  private loadCurrentVersion(
    organisationId: string,
    tenderId: string,
  ): Promise<
    | {
        readonly activeEarlyRiskRun: {
          readonly id: string;
          readonly invalidatedAt: Date | null;
          readonly status: string;
        } | null;
        readonly activeEligibilityAssessmentRun: {
          readonly id: string;
          readonly invalidatedAt: Date | null;
          readonly snapshot: { readonly capturedAt: Date };
          readonly status: string;
        } | null;
        readonly activeExtractionRun: {
          readonly id: string;
          readonly invalidatedAt: Date | null;
          readonly status: string;
        } | null;
        readonly documents: readonly {
          readonly approvedObjectKey: string | null;
          readonly role: string;
          readonly status: string;
        }[];
        readonly id: string;
      }
    | null
  > {
    return this.database.tenderVersion.findFirst({
      include: {
        activeEarlyRiskRun: true,
        activeEligibilityAssessmentRun: { include: { snapshot: true } },
        activeExtractionRun: true,
        documents: {
          orderBy: { createdAt: "asc" },
          where: { deletedAt: null },
        },
      },
      where: {
        tender: {
          currentVersionId: { not: null },
          deletedAt: null,
          id: tenderId,
          organisationId,
        },
        currentForTender: { id: tenderId, organisationId },
      },
    });
  }

  private canAnalyse(
    documents: readonly {
      readonly approvedObjectKey: string | null;
      readonly role: string;
      readonly status: string;
    }[],
  ): boolean {
    return (
      documents.length > 0 &&
      documents.some((document) => document.role === "PRIMARY") &&
      documents.every(
        (document) =>
          document.status === "READY" && document.approvedObjectKey !== null,
      )
    );
  }

  private async tryStartExtraction(
    organisationId: string,
    tenderId: string,
    versionId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    await this.ignoreExpectedStateErrors(() =>
      this.extractions.start(
        organisationId,
        tenderId,
        versionId,
        userId,
        "system-auto-extraction",
        requestId,
      ),
    );
  }

  private async tryStartRisk(
    organisationId: string,
    tenderId: string,
    versionId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    await this.ignoreExpectedStateErrors(() =>
      this.risks.start(
        organisationId,
        tenderId,
        versionId,
        userId,
        "system-auto-risk",
        requestId,
      ),
    );
  }

  private async tryStartEligibility(
    organisationId: string,
    tenderId: string,
    versionId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    await this.ignoreExpectedStateErrors(() =>
      this.eligibility.start(
        organisationId,
        tenderId,
        versionId,
        userId,
        "system-auto-eligibility",
        requestId,
      ),
    );
  }

  private async tryStartChecklist(
    organisationId: string,
    tenderId: string,
    versionId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    await this.ignoreExpectedStateErrors(() =>
      this.checklists.start(
        organisationId,
        tenderId,
        versionId,
        userId,
        "system-auto-checklist",
        requestId,
      ),
    );
  }

  private async tryStartTenderOnlyRag(
    organisationId: string,
    tenderId: string,
    versionId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    await this.ignoreExpectedStateErrors(() =>
      this.rag.startIndex(
        organisationId,
        tenderId,
        versionId,
        "TENDER_ONLY",
        "system-auto-rag-tender-only",
        userId,
        requestId,
      ),
    );
  }

  private async ignoreExpectedStateErrors(
    action: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof UnprocessableEntityException
      ) {
        return;
      }
      throw error;
    }
  }
}
