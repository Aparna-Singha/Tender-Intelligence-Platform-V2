import { describe, expect, it } from "vitest";
import {
  capabilitiesStepSchema,
  documentReadinessStepSchema,
  eligibilityStepSchema,
  onboardingStepPayloadSchemas,
  tenderPreferencesStepSchema,
} from "./onboarding.js";

const capabilities = {
  offering_type: "BOTH",
  business_models: ["RESELLER"],
  categories: [],
  products_services: [],
  brands_oem_relationships: [],
  delivery_service_regions: [],
  technical_capabilities: [],
  service_licences: [],
  consultant_industries: [],
};

describe("onboarding validation", () => {
  it("requires OEM authorisation context for resellers", () => {
    expect(capabilitiesStepSchema.safeParse(capabilities).success).toBe(false);
    expect(
      capabilitiesStepSchema.safeParse({
        ...capabilities,
        oem_authorisation_available: "NOT_SURE",
      }).success,
    ).toBe(true);
  });

  it("validates partial autosave values without requiring a completed step", () => {
    expect(
      onboardingStepPayloadSchemas[2]
        .partial()
        .safeParse({ legal_name: "Synthetic Draft Enterprise" }).success,
    ).toBe(true);
    expect(
      onboardingStepPayloadSchemas[2].partial().safeParse({ pan: "NOT-A-PAN" })
        .success,
    ).toBe(false);
  });

  it("rejects an inverted tender value range", () => {
    expect(
      tenderPreferencesStepSchema.safeParse({
        buyer_types: [],
        preferred_states: [],
        all_india: true,
        tender_value_min: 200,
        tender_value_max: 100,
        minimum_preparation_days: 5,
        emd_capability: "YES",
        performance_bg_capability: "YES",
        consortium_jv_preference: "OPEN",
        include_keywords: [],
        exclude_keywords: [],
      }).success,
    ).toBe(false);
  });

  it("validates document inventory types and ISO expiry dates", () => {
    expect(
      documentReadinessStepSchema.safeParse({
        documents: [
          { type: "UDYAM", status: "AVAILABLE", expected_expiry: "2027-01-01" },
        ],
      }).success,
    ).toBe(true);
    expect(
      documentReadinessStepSchema.safeParse({
        documents: [{ type: "PRIVATE_FILE", status: "AVAILABLE" }],
      }).success,
    ).toBe(false);
  });

  it("validates an end-to-end eight-step onboarding journey", () => {
    const journey = [
      {
        user_role: "MSME_OWNER",
        experience_level: "BEGINNER",
        primary_goals: ["UNDERSTAND_REQUIREMENTS"],
        explanation_level: "GUIDED",
      },
      {
        legal_name: "Synthetic Test Enterprise",
        entity_type: "PROPRIETORSHIP",
        udyam_status: "YES",
        gst_status: "YES",
        establishment_year: 2020,
        registered_location: "Synthetic location",
        operating_locations: [],
        employee_range: "1_10",
      },
      {
        ...capabilities,
        business_models: ["MANUFACTURER"],
      },
      {
        buyer_types: [],
        preferred_states: [],
        all_india: true,
        minimum_preparation_days: 7,
        emd_capability: "NOT_SURE",
        performance_bg_capability: "NOT_SURE",
        consortium_jv_preference: "OPEN",
        include_keywords: [],
        exclude_keywords: [],
      },
      {
        turnover_by_financial_year: [
          { financial_year: "2025-26", amount_inr: 100 },
        ],
        years_experience: 5,
        government_contracts: "NO",
        certifications: [],
        licences: [],
        startup_india_status: "NO",
        oem_reseller_status: "NO",
        blacklisting_declaration: "NOT_BLACKLISTED",
      },
      { documents: [{ type: "UDYAM", status: "AVAILABLE" }] },
      {
        tenders_per_month: 1,
        prepares_roles: ["OWNER"],
        reviews_roles: ["OWNER"],
        approves_roles: ["OWNER"],
        external_consultant_usage: "NO",
        summary_language: "ENGLISH",
        notification_preferences: [],
      },
      { confirmed: true },
    ] as const;
    for (const [index, payload] of journey.entries()) {
      const step = (index + 1) as keyof typeof onboardingStepPayloadSchemas;
      expect(
        onboardingStepPayloadSchemas[step].safeParse(payload).success,
      ).toBe(true);
    }
    expect(eligibilityStepSchema.safeParse(journey[4]).success).toBe(true);
  });
});
