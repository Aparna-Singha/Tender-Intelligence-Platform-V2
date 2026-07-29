import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { OnboardingService } from "../src/onboarding/onboarding.service.js";

function databaseMock(): {
  companyProfileValue: { findMany: ReturnType<typeof vi.fn> };
  companyTurnover: { findMany: ReturnType<typeof vi.fn> };
  documentReadiness: { findMany: ReturnType<typeof vi.fn> };
  onboardingProgress: { upsert: ReturnType<typeof vi.fn> };
} {
  return {
    companyProfileValue: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    companyTurnover: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    documentReadiness: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    onboardingProgress: {
      upsert: vi.fn().mockResolvedValue({
        completedSteps: [],
        currentStep: 1,
        status: "NOT_STARTED",
      }),
    },
  };
}

describe("onboarding application service", () => {
  it("rejects invalid autosave data before database access", async () => {
    const database = databaseMock();
    const service = new OnboardingService(database as never);
    await expect(
      service.saveStep(
        "organisation-a",
        "user-a",
        1,
        { user_role: "OWNER" },
        "request",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.companyProfileValue.findMany).not.toHaveBeenCalled();
  });

  it("scopes every resume query to the authorised organisation", async () => {
    const database = databaseMock();
    const service = new OnboardingService(database as never);
    await service.resume("organisation-a", "user-a");
    expect(database.companyProfileValue.findMany).toHaveBeenCalledWith({
      where: { organisationId: "organisation-a" },
    });
    expect(database.companyTurnover.findMany).toHaveBeenCalledWith({
      orderBy: { financialYear: "desc" },
      where: { organisationId: "organisation-a" },
    });
    expect(database.onboardingProgress.upsert).toHaveBeenCalledWith({
      create: { organisationId: "organisation-a", userId: "user-a" },
      update: {},
      where: {
        organisationId_userId: {
          organisationId: "organisation-a",
          userId: "user-a",
        },
      },
    });
  });
});
