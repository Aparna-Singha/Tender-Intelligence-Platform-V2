import { z } from "zod";

const text = z.string().trim().max(500);
const optionalText = text.optional();
const textList = z
  .array(z.string().trim().min(1).max(120))
  .max(100)
  .default([]);
const requiredTextList = z
  .array(z.string().trim().min(1).max(120))
  .min(1)
  .max(100);
const yesNoUnknown = z.enum(["YES", "NO", "NOT_SURE"]);

export const onboardingStepSchema = z.coerce.number().int().min(1).max(8);

export const userContextStepSchema = z.object({
  user_role: z.enum([
    "MSME_OWNER",
    "TENDER_EXECUTIVE",
    "TENDER_CONSULTANT",
    "REVIEWER",
  ]),
  experience_level: z.enum(["BEGINNER", "INTERMEDIATE", "EXPERIENCED"]),
  primary_goals: requiredTextList,
  explanation_level: z.enum(["GUIDED", "STANDARD", "PROFESSIONAL"]),
});

export const businessIdentityStepSchema = z.object({
  legal_name: text.min(1),
  entity_type: z.enum([
    "PROPRIETORSHIP",
    "PARTNERSHIP",
    "LLP",
    "PRIVATE_LIMITED",
    "PUBLIC_LIMITED",
    "TRUST",
    "SOCIETY",
    "OTHER",
  ]),
  udyam_status: yesNoUnknown,
  gst_status: yesNoUnknown,
  pan: z
    .string()
    .trim()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .optional(),
  cin: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{21}$/)
    .optional(),
  establishment_year: z.number().int().min(1800).max(new Date().getFullYear()),
  registered_location: text.min(1),
  operating_locations: textList,
  employee_range: z.enum(["1_10", "11_50", "51_200", "201_500", "500_PLUS"]),
  website: z.url().optional(),
});

export const capabilitiesStepSchema = z
  .object({
    offering_type: z.enum(["PRODUCTS", "SERVICES", "BOTH"]),
    business_models: z
      .array(
        z.enum([
          "MANUFACTURER",
          "OEM",
          "AUTHORISED_DEALER",
          "DISTRIBUTOR",
          "RESELLER",
          "SERVICE_PROVIDER",
          "SYSTEM_INTEGRATOR",
          "CONSULTANT",
        ]),
      )
      .min(1),
    categories: textList,
    products_services: textList,
    brands_oem_relationships: textList,
    oem_authorisation_available: yesNoUnknown.optional(),
    delivery_service_regions: textList,
    delivery_capacity: optionalText,
    technical_capabilities: textList,
    service_team_capacity: optionalText,
    service_licences: textList,
    consultant_active_clients: z.number().int().min(0).max(100000).optional(),
    consultant_industries: textList,
    consultant_team_size: z.number().int().min(1).max(100000).optional(),
    consultant_approval_workflow: optionalText,
  })
  .superRefine((value, context) => {
    if (
      value.business_models.includes("RESELLER") &&
      value.oem_authorisation_available === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "OEM authorisation is required for resellers",
        path: ["oem_authorisation_available"],
      });
    }
    if (
      value.business_models.includes("SERVICE_PROVIDER") &&
      value.service_team_capacity === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Team capacity is required for service providers",
        path: ["service_team_capacity"],
      });
    }
    if (
      value.business_models.includes("CONSULTANT") &&
      (value.consultant_active_clients === undefined ||
        value.consultant_team_size === undefined ||
        value.consultant_approval_workflow === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Consultant context is incomplete",
        path: ["consultant_active_clients"],
      });
    }
  });

export const tenderPreferencesStepSchema = z
  .object({
    buyer_types: textList,
    preferred_states: textList,
    all_india: z.boolean(),
    tender_value_min: z.number().nonnegative().optional(),
    tender_value_max: z.number().nonnegative().optional(),
    contract_duration_months: z.number().int().positive().max(240).optional(),
    minimum_preparation_days: z.number().int().min(1).max(365),
    emd_capability: yesNoUnknown,
    performance_bg_capability: yesNoUnknown,
    consortium_jv_preference: z.enum(["OPEN", "PREFER", "AVOID", "NOT_SURE"]),
    include_keywords: textList,
    exclude_keywords: textList,
  })
  .refine(
    (value) =>
      value.tender_value_min === undefined ||
      value.tender_value_max === undefined ||
      value.tender_value_min <= value.tender_value_max,
    {
      message: "Minimum tender value must not exceed maximum",
      path: ["tender_value_max"],
    },
  );

const turnoverSchema = z.object({
  financial_year: z.string().regex(/^\d{4}-\d{2}$/),
  amount_inr: z.number().nonnegative(),
});

export const eligibilityStepSchema = z.object({
  turnover_by_financial_year: z.array(turnoverSchema).max(10),
  years_experience: z.number().nonnegative().max(200),
  government_contracts: yesNoUnknown,
  similar_projects_count: z.number().int().nonnegative().optional(),
  largest_completed_contract_inr: z.number().nonnegative().optional(),
  certifications: textList,
  licences: textList,
  startup_india_status: yesNoUnknown,
  oem_reseller_status: yesNoUnknown,
  blacklisting_declaration: z.enum([
    "NOT_BLACKLISTED",
    "BLACKLISTED",
    "HUMAN_REVIEW_REQUIRED",
  ]),
});

export const documentTypes = [
  "UDYAM",
  "GST",
  "PAN_CIN",
  "AUDITED_FINANCIAL_STATEMENTS",
  "TURNOVER_CERTIFICATES",
  "PURCHASE_ORDERS",
  "COMPLETION_CERTIFICATES",
  "EXPERIENCE_CERTIFICATES",
  "OEM_AUTHORISATIONS",
  "ISO_CERTIFICATES",
  "LICENCES",
  "DATASHEETS",
  "DECLARATIONS",
  "BANK_DOCUMENTS",
] as const;

export const documentReadinessStepSchema = z.object({
  documents: z
    .array(
      z.object({
        type: z.enum(documentTypes),
        status: z.enum(["AVAILABLE", "MISSING", "NOT_APPLICABLE"]),
        expected_expiry: z.iso.date().optional(),
      }),
    )
    .max(documentTypes.length),
});

export const workflowStepSchema = z.object({
  tenders_per_month: z.number().int().nonnegative().max(10000),
  prepares_roles: textList,
  reviews_roles: textList,
  approves_roles: textList,
  external_consultant_usage: yesNoUnknown,
  summary_language: z.enum(["ENGLISH", "HINDI", "BILINGUAL"]),
  notification_preferences: textList,
});

export const reviewStepSchema = z.object({
  confirmed: z.literal(true),
});

export const onboardingStepPayloadSchemas = {
  1: userContextStepSchema,
  2: businessIdentityStepSchema,
  3: capabilitiesStepSchema,
  4: tenderPreferencesStepSchema,
  5: eligibilityStepSchema,
  6: documentReadinessStepSchema,
  7: workflowStepSchema,
  8: reviewStepSchema,
} as const;

export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type UserContextStep = z.infer<typeof userContextStepSchema>;
export type BusinessIdentityStep = z.infer<typeof businessIdentityStepSchema>;
export type CapabilitiesStep = z.infer<typeof capabilitiesStepSchema>;
export type TenderPreferencesStep = z.infer<typeof tenderPreferencesStepSchema>;
export type EligibilityStep = z.infer<typeof eligibilityStepSchema>;
export type DocumentReadinessStep = z.infer<typeof documentReadinessStepSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
