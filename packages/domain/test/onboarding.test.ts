import { describe, expect, it } from "vitest";
import {
  buildOnboardingRecommendations,
  calculateProfileCompleteness,
  dashboardMode,
} from "../src/onboarding.js";

const completeBase = {
  user_role: "MSME_OWNER",
  experience_level: "EXPERIENCED",
  primary_goals: ["READINESS"],
  explanation_level: "PROFESSIONAL",
  legal_name: "Synthetic Test Enterprise",
  entity_type: "PRIVATE_LIMITED",
  udyam_status: "YES",
  gst_status: "YES",
  establishment_year: 2020,
  registered_location: "Synthetic location",
  employee_range: "11_50",
  offering_type: "BOTH",
  business_models: ["MANUFACTURER"],
  minimum_preparation_days: 10,
  emd_capability: "YES",
  performance_bg_capability: "YES",
  years_experience: 6,
  government_contracts: "NO",
  blacklisting_declaration: "NOT_BLACKLISTED",
  documents: [{ type: "UDYAM", status: "AVAILABLE" }],
  tenders_per_month: 2,
  prepares_roles: ["TENDER_EXECUTIVE"],
  reviews_roles: ["REVIEWER"],
  approves_roles: ["OWNER"],
  summary_language: "ENGLISH",
};

describe("profile completeness", () => {
  it("calculates a complete baseline profile", () => {
    expect(calculateProfileCompleteness(completeBase)).toMatchObject({
      missingFields: [],
      percentage: 100,
    });
  });

  it("adds conditional reseller and consultant requirements", () => {
    const result = calculateProfileCompleteness({
      ...completeBase,
      business_models: ["RESELLER", "CONSULTANT"],
    });
    expect(result.missingFields).toEqual(
      expect.arrayContaining([
        "oem_authorisation_available",
        "consultant_active_clients",
        "consultant_industries",
        "consultant_team_size",
        "consultant_approval_workflow",
      ]),
    );
  });
});

describe("personalisation", () => {
  it("uses compact professional mode for experienced users", () => {
    expect(dashboardMode(completeBase)).toBe("PROFESSIONAL");
  });

  it("recommends human review for an uncertain blacklisting declaration", () => {
    const recommendations = buildOnboardingRecommendations({
      ...completeBase,
      blacklisting_declaration: "HUMAN_REVIEW_REQUIRED",
    });
    expect(
      recommendations.some((item) => item.id === "review_blacklisting"),
    ).toBe(true);
  });
});
