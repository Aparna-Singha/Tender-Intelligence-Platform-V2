import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  onboardingStepPayloadSchemas,
  type OnboardingStep,
} from "@tender/contracts";
import type { Prisma, PrismaClient } from "@tender/database";
import {
  buildOnboardingRecommendations,
  calculateProfileCompleteness,
  dashboardMode,
  type DashboardRecommendation,
  type ProfileCompleteness,
} from "@tender/domain";

import { PRISMA_CLIENT } from "../infrastructure.tokens.js";

type StoredValue =
  | { readonly valueType: "BOOLEAN"; readonly booleanValue: boolean }
  | { readonly valueType: "NUMBER"; readonly numberValue: number }
  | { readonly valueType: "TEXT"; readonly textValue: string }
  | { readonly valueType: "TEXT_LIST"; readonly textListValue: string[] };

export interface OnboardingResponse {
  readonly completeness: ProfileCompleteness;
  readonly display_mode: "BEGINNER" | "PROFESSIONAL";
  readonly progress: {
    readonly completed_steps: number[];
    readonly current_step: number;
    readonly status: string;
  };
  readonly recommendations: readonly DashboardRecommendation[];
  readonly values: Readonly<Record<string, unknown>>;
}

export interface CompanyProfileResponse {
  readonly completeness: ProfileCompleteness;
  readonly fields: readonly {
    readonly evidence_document_id: string | null;
    readonly key: string;
    readonly source: string;
    readonly updated_at: Date;
    readonly updated_by: string;
    readonly verification_status: string;
    readonly value: unknown;
  }[];
  readonly values: Readonly<Record<string, unknown>>;
}

function toStoredValue(value: unknown): StoredValue | null {
  if (typeof value === "boolean")
    return { booleanValue: value, valueType: "BOOLEAN" };
  if (typeof value === "number")
    return { numberValue: value, valueType: "NUMBER" };
  if (typeof value === "string") return { textValue: value, valueType: "TEXT" };
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.length === 0
      ? null
      : { textListValue: value, valueType: "TEXT_LIST" };
  }
  return null;
}

function fromStoredValue(value: {
  readonly booleanValue: boolean | null;
  readonly numberValue: Prisma.Decimal | null;
  readonly textListValue: string[];
  readonly textValue: string | null;
  readonly valueType: string;
}): unknown {
  if (value.valueType === "BOOLEAN") return value.booleanValue;
  if (value.valueType === "NUMBER") return value.numberValue?.toNumber();
  if (value.valueType === "TEXT_LIST") return value.textListValue;
  return value.textValue;
}

@Injectable()
export class OnboardingService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
  ) {}

  public async saveStep(
    organisationId: string,
    userId: string,
    step: OnboardingStep,
    payload: unknown,
    requestId: string,
    complete = true,
  ): Promise<OnboardingResponse> {
    const schema = complete
      ? onboardingStepPayloadSchemas[step]
      : onboardingStepPayloadSchemas[step].partial();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new BadRequestException();
    const values = Object.entries(parsed.data);

    await this.database.$transaction(async (transaction) => {
      if (step === 5 && "turnover_by_financial_year" in parsed.data) {
        const turnover = parsed.data as {
          turnover_by_financial_year: {
            amount_inr: number;
            financial_year: string;
          }[];
        };
        await transaction.companyTurnover.deleteMany({
          where: { organisationId },
        });
        if (turnover.turnover_by_financial_year.length > 0) {
          await transaction.companyTurnover.createMany({
            data: turnover.turnover_by_financial_year.map((entry) => ({
              amountInr: entry.amount_inr,
              financialYear: entry.financial_year,
              organisationId,
              updatedByUserId: userId,
            })),
          });
        }
      }
      if (step === 6 && "documents" in parsed.data) {
        const inventory = parsed.data as {
          documents: {
            expected_expiry?: string;
            status: string;
            type: string;
          }[];
        };
        await transaction.documentReadiness.deleteMany({
          where: { organisationId },
        });
        if (inventory.documents.length > 0) {
          await transaction.documentReadiness.createMany({
            data: inventory.documents.map((document) => ({
              documentType: document.type,
              expectedExpiry:
                document.expected_expiry === undefined
                  ? null
                  : new Date(`${document.expected_expiry}T00:00:00.000Z`),
              organisationId,
              readinessStatus: document.status,
              updatedByUserId: userId,
            })),
          });
        }
      }

      for (const [fieldKey, value] of values) {
        if (
          fieldKey === "turnover_by_financial_year" ||
          fieldKey === "documents" ||
          fieldKey === "confirmed"
        )
          continue;
        const stored = toStoredValue(value);
        if (stored === null) {
          await transaction.companyProfileValue.deleteMany({
            where: { fieldKey, organisationId },
          });
          continue;
        }
        await transaction.companyProfileValue.upsert({
          create: {
            fieldKey,
            organisationId,
            updatedByUserId: userId,
            ...stored,
          },
          update: {
            booleanValue: null,
            dateValue: null,
            numberValue: null,
            textListValue: [],
            textValue: null,
            updatedByUserId: userId,
            verificationStatus: "SELF_DECLARED",
            ...stored,
          },
          where: { organisationId_fieldKey: { fieldKey, organisationId } },
        });
      }

      const progress = await transaction.onboardingProgress.upsert({
        create: { organisationId, userId },
        update: {},
        where: { organisationId_userId: { organisationId, userId } },
      });
      const completedSteps = complete
        ? [...new Set([...progress.completedSteps, step])].sort()
        : progress.completedSteps;
      await transaction.onboardingProgress.update({
        data: {
          completedAt: complete && step === 8 ? new Date() : null,
          completedSteps,
          currentStep: complete
            ? step === 8
              ? 8
              : Math.min(step + 1, 8)
            : step,
          status: complete && step === 8 ? "COMPLETED" : "IN_PROGRESS",
        },
        where: { id: progress.id },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType:
            complete && step === 8
              ? "ONBOARDING_COMPLETED"
              : "ONBOARDING_STEP_SAVED",
          metadata: { changed_fields: values.map(([key]) => key), step },
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectType: "company_profile",
        },
      });
      if (step >= 2 && step <= 7) {
        const invalidatedAt = new Date();
        await transaction.eligibilityAssessmentRun.updateMany({
          data: {
            currentStage: "INVALIDATED",
            invalidatedAt,
            publicMessage: "Company profile evidence changed",
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
        });
        await transaction.eligibilityAssessment.updateMany({
          data: { invalidatedAt },
          where: { invalidatedAt: null, organisationId },
        });
        await transaction.tenderVersion.updateMany({
          data: { activeEligibilityAssessmentRunId: null },
          where: {
            activeEligibilityAssessmentRun: { organisationId },
          },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: userId,
            eventType: "COMPANY_PROFILE_UPDATED",
            metadata: { changed_fields: values.map(([key]) => key), step },
            organisationId,
            outcome: "SUCCESS",
            requestId,
            subjectType: "company_profile",
          },
        });
      }
    });
    return this.resume(organisationId, userId);
  }

  public async resume(
    organisationId: string,
    userId: string,
  ): Promise<OnboardingResponse> {
    const [progress, storedValues, turnover, documents] = await Promise.all([
      this.database.onboardingProgress.upsert({
        create: { organisationId, userId },
        update: {},
        where: { organisationId_userId: { organisationId, userId } },
      }),
      this.database.companyProfileValue.findMany({ where: { organisationId } }),
      this.database.companyTurnover.findMany({
        orderBy: { financialYear: "desc" },
        where: { organisationId },
      }),
      this.database.documentReadiness.findMany({
        orderBy: { documentType: "asc" },
        where: { organisationId },
      }),
    ]);
    const values: Record<string, unknown> = Object.fromEntries(
      storedValues.map((value) => [value.fieldKey, fromStoredValue(value)]),
    );
    values.turnover_by_financial_year = turnover.map((entry) => ({
      amount_inr: entry.amountInr.toNumber(),
      financial_year: entry.financialYear,
    }));
    values.documents = documents.map((document) => ({
      expected_expiry: document.expectedExpiry?.toISOString().slice(0, 10),
      status: document.readinessStatus,
      type: document.documentType,
    }));
    const completeness = calculateProfileCompleteness(values);
    return {
      completeness,
      display_mode: dashboardMode(values),
      progress: {
        completed_steps: progress.completedSteps,
        current_step: progress.currentStep,
        status: progress.status,
      },
      recommendations: buildOnboardingRecommendations(values),
      values,
    };
  }

  public async profile(
    organisationId: string,
    userId: string,
  ): Promise<CompanyProfileResponse> {
    const onboarding = await this.resume(organisationId, userId);
    const fields = await this.database.companyProfileValue.findMany({
      where: { organisationId },
    });
    return {
      completeness: onboarding.completeness,
      fields: fields.map((field) => ({
        evidence_document_id: field.evidenceDocumentId,
        key: field.fieldKey,
        source: field.source,
        updated_at: field.updatedAt,
        updated_by: field.updatedByUserId,
        verification_status: field.verificationStatus,
        value: fromStoredValue(field),
      })),
      values: onboarding.values,
    };
  }
}
