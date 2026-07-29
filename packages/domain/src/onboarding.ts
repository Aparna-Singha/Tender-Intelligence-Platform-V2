export const onboardingStepNames = [
  "User role and goals",
  "Business identity",
  "Business model and capabilities",
  "Tender preferences",
  "Eligibility profile",
  "Document-readiness inventory",
  "Workflow and notification preferences",
  "Review and confirmation",
] as const;

const requiredFields = [
  "user_role",
  "experience_level",
  "primary_goals",
  "explanation_level",
  "legal_name",
  "entity_type",
  "udyam_status",
  "gst_status",
  "establishment_year",
  "registered_location",
  "employee_range",
  "offering_type",
  "business_models",
  "minimum_preparation_days",
  "emd_capability",
  "performance_bg_capability",
  "years_experience",
  "government_contracts",
  "blacklisting_declaration",
  "documents",
  "tenders_per_month",
  "prepares_roles",
  "reviews_roles",
  "approves_roles",
  "summary_language",
] as const;

function hasValue(
  values: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  const value = values[key];
  return (
    value !== undefined &&
    value !== null &&
    value !== "" &&
    (!Array.isArray(value) || value.length > 0)
  );
}

export interface ProfileCompleteness {
  readonly completed: number;
  readonly missingFields: readonly string[];
  readonly percentage: number;
  readonly total: number;
}

export function calculateProfileCompleteness(
  values: Readonly<Record<string, unknown>>,
): ProfileCompleteness {
  const conditional = new Set<string>();
  const models = Array.isArray(values.business_models)
    ? values.business_models
    : [];
  if (models.includes("RESELLER"))
    conditional.add("oem_authorisation_available");
  if (models.includes("SERVICE_PROVIDER"))
    conditional.add("service_team_capacity");
  if (models.includes("CONSULTANT")) {
    conditional.add("consultant_active_clients");
    conditional.add("consultant_industries");
    conditional.add("consultant_team_size");
    conditional.add("consultant_approval_workflow");
  }
  const expected = [...requiredFields, ...conditional];
  const missingFields = expected.filter((field) => !hasValue(values, field));
  const completed = expected.length - missingFields.length;
  return {
    completed,
    missingFields,
    percentage: Math.round((completed / expected.length) * 100),
    total: expected.length,
  };
}

export interface DashboardRecommendation {
  readonly action: string;
  readonly id: string;
  readonly priority: "HIGH" | "MEDIUM" | "LOW";
}

export function buildOnboardingRecommendations(
  values: Readonly<Record<string, unknown>>,
): readonly DashboardRecommendation[] {
  const recommendations: DashboardRecommendation[] = [];
  const completeness = calculateProfileCompleteness(values);
  if (completeness.percentage < 100) {
    recommendations.push({
      action: "Continue onboarding to improve profile readiness.",
      id: "continue_onboarding",
      priority: "HIGH",
    });
  }
  if (values.udyam_status !== "YES") {
    recommendations.push({
      action:
        "Review whether Udyam registration is applicable to your organisation.",
      id: "review_udyam",
      priority: "MEDIUM",
    });
  }
  if (values.blacklisting_declaration === "HUMAN_REVIEW_REQUIRED") {
    recommendations.push({
      action:
        "Ask an authorised reviewer to resolve the blacklisting declaration.",
      id: "review_blacklisting",
      priority: "HIGH",
    });
  }
  if (
    Array.isArray(values.business_models) &&
    values.business_models.includes("RESELLER") &&
    values.oem_authorisation_available !== "YES"
  ) {
    recommendations.push({
      action: "Review OEM authorisation readiness for reseller opportunities.",
      id: "review_oem_authorisation",
      priority: "MEDIUM",
    });
  }
  return recommendations;
}

export function dashboardMode(
  values: Readonly<Record<string, unknown>>,
): "BEGINNER" | "PROFESSIONAL" {
  return values.experience_level === "EXPERIENCED" ||
    values.explanation_level === "PROFESSIONAL"
    ? "PROFESSIONAL"
    : "BEGINNER";
}
