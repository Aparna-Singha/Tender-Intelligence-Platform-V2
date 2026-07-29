"use client";

import { useEffect, useMemo, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "../lib/api";

const stepNames = [
  "User role and goals",
  "Business identity",
  "Business model and capabilities",
  "Tender preferences",
  "Eligibility profile",
  "Document-readiness inventory",
  "Workflow and notification preferences",
  "Review and confirmation",
] as const;

interface ResumeResponse {
  display_mode: "BEGINNER" | "PROFESSIONAL";
  progress: { completed_steps: number[]; current_step: number; status: string };
  values: Record<string, unknown>;
}

interface Field {
  readonly key: string;
  readonly label: string;
  readonly options?: readonly string[];
  readonly required?: boolean;
  readonly sensitive?: string;
  readonly type?: "boolean" | "list" | "number" | "text" | "url";
}

const fieldsByStep: Readonly<Record<number, readonly Field[]>> = {
  1: [
    {
      key: "user_role",
      label: "Your role",
      options: [
        "MSME_OWNER",
        "TENDER_EXECUTIVE",
        "TENDER_CONSULTANT",
        "REVIEWER",
      ],
      required: true,
    },
    {
      key: "experience_level",
      label: "Tender experience",
      options: ["BEGINNER", "INTERMEDIATE", "EXPERIENCED"],
      required: true,
    },
    {
      key: "primary_goals",
      label: "Primary goals (comma separated)",
      required: true,
      type: "list",
    },
    {
      key: "explanation_level",
      label: "Explanation level",
      options: ["GUIDED", "STANDARD", "PROFESSIONAL"],
      required: true,
    },
  ],
  2: [
    { key: "legal_name", label: "Legal business name", required: true },
    {
      key: "entity_type",
      label: "Entity type",
      options: [
        "PROPRIETORSHIP",
        "PARTNERSHIP",
        "LLP",
        "PRIVATE_LIMITED",
        "PUBLIC_LIMITED",
        "TRUST",
        "SOCIETY",
        "OTHER",
      ],
      required: true,
    },
    {
      key: "udyam_status",
      label: "Udyam registration status",
      options: ["YES", "NO", "NOT_SURE"],
      required: true,
      sensitive:
        "Used for readiness guidance only; it is not an eligibility guarantee.",
    },
    {
      key: "gst_status",
      label: "GST registration status",
      options: ["YES", "NO", "NOT_SURE"],
      required: true,
    },
    {
      key: "pan",
      label: "PAN (optional)",
      sensitive:
        "Stored privately for organisation profile readiness. Do not enter another organisation's identifier.",
    },
    { key: "cin", label: "CIN, where applicable (optional)" },
    {
      key: "establishment_year",
      label: "Establishment year",
      required: true,
      type: "number",
    },
    {
      key: "registered_location",
      label: "Registered location",
      required: true,
    },
    {
      key: "operating_locations",
      label: "Operating locations (comma separated)",
      type: "list",
    },
    {
      key: "employee_range",
      label: "Employee range",
      options: ["1_10", "11_50", "51_200", "201_500", "500_PLUS"],
      required: true,
    },
    { key: "website", label: "Website (optional)", type: "url" },
  ],
  3: [
    {
      key: "offering_type",
      label: "Products, services or both",
      options: ["PRODUCTS", "SERVICES", "BOTH"],
      required: true,
    },
    {
      key: "business_models",
      label: "Business models (comma separated)",
      required: true,
      type: "list",
    },
    { key: "categories", label: "Categories", type: "list" },
    { key: "products_services", label: "Products and services", type: "list" },
    {
      key: "brands_oem_relationships",
      label: "Brands and OEM relationships",
      type: "list",
    },
    {
      key: "oem_authorisation_available",
      label: "OEM authorisation available",
      options: ["YES", "NO", "NOT_SURE"],
    },
    {
      key: "delivery_service_regions",
      label: "Delivery and service regions",
      type: "list",
    },
    { key: "delivery_capacity", label: "Delivery capacity" },
    {
      key: "technical_capabilities",
      label: "Technical capabilities",
      type: "list",
    },
    { key: "service_team_capacity", label: "Service team capacity" },
    { key: "service_licences", label: "Service licences", type: "list" },
    {
      key: "consultant_active_clients",
      label: "Active clients",
      type: "number",
    },
    { key: "consultant_industries", label: "Client industries", type: "list" },
    {
      key: "consultant_team_size",
      label: "Consulting team size",
      type: "number",
    },
    { key: "consultant_approval_workflow", label: "Client approval workflow" },
  ],
  4: [
    { key: "buyer_types", label: "Buyer types", type: "list" },
    { key: "preferred_states", label: "Preferred states", type: "list" },
    { key: "all_india", label: "Consider all India", type: "boolean" },
    {
      key: "tender_value_min",
      label: "Minimum tender value (INR)",
      type: "number",
    },
    {
      key: "tender_value_max",
      label: "Maximum tender value (INR)",
      type: "number",
    },
    {
      key: "contract_duration_months",
      label: "Preferred contract duration (months)",
      type: "number",
    },
    {
      key: "minimum_preparation_days",
      label: "Minimum preparation time (days)",
      required: true,
      type: "number",
    },
    {
      key: "emd_capability",
      label: "EMD capability",
      options: ["YES", "NO", "NOT_SURE"],
      required: true,
    },
    {
      key: "performance_bg_capability",
      label: "Performance bank guarantee capability",
      options: ["YES", "NO", "NOT_SURE"],
      required: true,
    },
    {
      key: "consortium_jv_preference",
      label: "Consortium or JV preference",
      options: ["OPEN", "PREFER", "AVOID", "NOT_SURE"],
      required: true,
    },
    { key: "include_keywords", label: "Include keywords", type: "list" },
    { key: "exclude_keywords", label: "Exclude keywords", type: "list" },
  ],
  5: [
    {
      key: "years_experience",
      label: "Years of business experience",
      required: true,
      type: "number",
    },
    {
      key: "government_contracts",
      label: "Previous government contracts",
      options: ["YES", "NO", "NOT_SURE"],
      required: true,
    },
    {
      key: "similar_projects_count",
      label: "Similar projects completed",
      type: "number",
    },
    {
      key: "largest_completed_contract_inr",
      label: "Largest completed contract (INR)",
      type: "number",
    },
    { key: "certifications", label: "Certifications", type: "list" },
    { key: "licences", label: "Licences", type: "list" },
    {
      key: "startup_india_status",
      label: "Startup India / DPIIT status",
      options: ["YES", "NO", "NOT_SURE"],
      required: true,
    },
    {
      key: "oem_reseller_status",
      label: "OEM or reseller status",
      options: ["YES", "NO", "NOT_SURE"],
      required: true,
    },
    {
      key: "blacklisting_declaration",
      label: "Blacklisting declaration",
      options: ["NOT_BLACKLISTED", "BLACKLISTED", "HUMAN_REVIEW_REQUIRED"],
      required: true,
      sensitive:
        "This is self-declared and must be reviewed by an authorised human when uncertain.",
    },
  ],
  6: [],
  7: [
    {
      key: "tenders_per_month",
      label: "Tenders handled per month",
      required: true,
      type: "number",
    },
    {
      key: "prepares_roles",
      label: "Who prepares tenders",
      required: true,
      type: "list",
    },
    {
      key: "reviews_roles",
      label: "Who reviews tenders",
      required: true,
      type: "list",
    },
    {
      key: "approves_roles",
      label: "Who approves tenders",
      required: true,
      type: "list",
    },
    {
      key: "external_consultant_usage",
      label: "External consultant usage",
      options: ["YES", "NO", "NOT_SURE"],
      required: true,
    },
    {
      key: "summary_language",
      label: "Preferred summary language",
      options: ["ENGLISH", "HINDI", "BILINGUAL"],
      required: true,
    },
    {
      key: "notification_preferences",
      label: "Notification preferences",
      type: "list",
    },
  ],
  8: [],
};

const businessModels = [
  "MANUFACTURER",
  "OEM",
  "AUTHORISED_DEALER",
  "DISTRIBUTOR",
  "RESELLER",
  "SERVICE_PROVIDER",
  "SYSTEM_INTEGRATOR",
  "CONSULTANT",
];
const documentTypes = [
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
];

function normalise(field: Field, value: FormDataEntryValue | null): unknown {
  if (field.type === "boolean") return value === "true";
  if (field.type === "number")
    return value === null || value === "" ? undefined : Number(value);
  if (field.type === "list")
    return typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function formText(value: FormDataEntryValue | null, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function displayText(value: unknown, fallback = ""): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

export function OnboardingWizard({
  organisationId,
}: {
  readonly organisationId: string;
}): JSX.Element {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState("Loading saved progress…");
  const [mode, setMode] = useState<"BEGINNER" | "PROFESSIONAL">("BEGINNER");

  useEffect(() => {
    void apiRequest<ResumeResponse>(
      `/organisations/${organisationId}/onboarding`,
    )
      .then((saved) => {
        setStep(saved.progress.current_step);
        setValues(saved.values);
        setMode(saved.display_mode);
        setMessage("");
      })
      .catch(() => router.replace("/dashboard"));
  }, [organisationId, router]);

  const visibleFields = useMemo(() => {
    const fields = fieldsByStep[step] ?? [];
    const models = Array.isArray(values.business_models)
      ? values.business_models
      : [];
    return fields.filter((field) => {
      if (field.key.startsWith("consultant_"))
        return models.includes("CONSULTANT");
      if (field.key.startsWith("service_"))
        return models.includes("SERVICE_PROVIDER");
      if (field.key === "oem_authorisation_available")
        return models.includes("RESELLER");
      return true;
    });
  }, [step, values.business_models]);

  async function save(
    formElement: HTMLFormElement,
    continueNext: boolean,
  ): Promise<void> {
    const form = new FormData(formElement);
    const payload: Record<string, unknown> = {};
    for (const field of visibleFields)
      payload[field.key] = normalise(field, form.get(field.key));
    if (step === 3)
      payload.business_models = businessModels.filter(
        (model) => form.get(`model_${model}`) === "on",
      );
    if (step === 5) {
      payload.turnover_by_financial_year = [0, 1, 2]
        .map((index) => ({
          amount_inr: Number(form.get(`turnover_amount_${index}`)),
          financial_year: formText(form.get(`turnover_year_${index}`)),
        }))
        .filter(
          (entry) =>
            entry.financial_year.length > 0 &&
            Number.isFinite(entry.amount_inr),
        );
    }
    if (step === 6) {
      payload.documents = documentTypes.map((type) => ({
        type,
        status: formText(form.get(`document_${type}`), "MISSING"),
        expected_expiry: formText(form.get(`expiry_${type}`)) || undefined,
      }));
    }
    if (step === 8) payload.confirmed = true;
    setMessage("Saving…");
    try {
      const saved = await apiRequest<ResumeResponse>(
        `/organisations/${organisationId}/onboarding/steps/${step}`,
        { body: JSON.stringify(payload), method: "PUT" },
      );
      setValues(saved.values);
      setMode(saved.display_mode);
      if (continueNext && step < 8) setStep(step + 1);
      setMessage(continueNext ? "Saved." : "Saved. You can return later.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Please correct the highlighted fields.",
      );
    }
  }

  return (
    <main>
      <p>Step {step} of 8</p>
      <progress aria-label="Onboarding progress" max={8} value={step}>
        {step} of 8
      </progress>
      <h1>{stepNames[step - 1]}</h1>
      {mode === "BEGINNER" && (
        <p>
          Guided mode explains why sensitive information is requested. You may
          skip fields marked optional.
        </p>
      )}
      <form
        onBlur={(event) => {
          if (event.currentTarget.checkValidity())
            void save(event.currentTarget, false);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void save(event.currentTarget, true);
        }}
      >
        {step === 3 && (
          <fieldset>
            <legend>Business models</legend>
            {businessModels.map((model) => (
              <label key={model}>
                <input
                  defaultChecked={(
                    values.business_models as string[] | undefined
                  )?.includes(model)}
                  name={`model_${model}`}
                  onChange={(event) => {
                    const prior = stringArray(values.business_models);
                    const selected = event.currentTarget.checked
                      ? [...new Set([...prior, model])]
                      : prior.filter((candidate) => candidate !== model);
                    setValues((current) => ({
                      ...current,
                      business_models: selected,
                    }));
                  }}
                  type="checkbox"
                />
                {model.replaceAll("_", " ")}
              </label>
            ))}
          </fieldset>
        )}
        {visibleFields
          .filter((field) => field.key !== "business_models")
          .map((field) => (
            <label key={field.key}>
              {field.label}
              {field.required ? " *" : ""}
              {field.sensitive && <small>{field.sensitive}</small>}
              {field.options ? (
                <select
                  defaultValue={displayText(values[field.key])}
                  name={field.key}
                  required={field.required}
                >
                  <option value="">Select</option>
                  {field.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : field.type === "boolean" ? (
                <select
                  defaultValue={displayText(values[field.key], "false")}
                  name={field.key}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              ) : (
                <input
                  defaultValue={
                    Array.isArray(values[field.key])
                      ? (values[field.key] as string[]).join(", ")
                      : displayText(values[field.key])
                  }
                  name={field.key}
                  required={field.required}
                  type={
                    field.type === "number"
                      ? "number"
                      : field.type === "url"
                        ? "url"
                        : "text"
                  }
                />
              )}
            </label>
          ))}
        {step === 5 && (
          <fieldset>
            <legend>Turnover by financial year</legend>
            {[0, 1, 2].map((index) => (
              <div key={index}>
                <label>
                  Financial year
                  <input
                    name={`turnover_year_${index}`}
                    pattern="\\d{4}-\\d{2}"
                    placeholder="2025-26"
                  />
                </label>
                <label>
                  Amount INR
                  <input
                    min="0"
                    name={`turnover_amount_${index}`}
                    type="number"
                  />
                </label>
              </div>
            ))}
          </fieldset>
        )}
        {step === 6 && (
          <fieldset>
            <legend>Document readiness</legend>
            {documentTypes.map((type) => (
              <label key={type}>
                {type.replaceAll("_", " ")}
                <select name={`document_${type}`}>
                  <option>AVAILABLE</option>
                  <option>MISSING</option>
                  <option>NOT_APPLICABLE</option>
                </select>
                <span>Expected expiry (optional)</span>
                <input name={`expiry_${type}`} type="date" />
              </label>
            ))}
          </fieldset>
        )}
        {step === 8 && (
          <section aria-labelledby="review-heading">
            <h2 id="review-heading">Review and confirm</h2>
            <p>
              Review your saved profile. Values remain self-declared until
              supported and verified by an authorised process.
            </p>
            <pre>{JSON.stringify(values, null, 2)}</pre>
          </section>
        )}
        <p aria-live="polite">{message}</p>
        <div>
          <button
            disabled={step === 1}
            onClick={() => setStep(step - 1)}
            type="button"
          >
            Back
          </button>
          <button
            onClick={(event) => void save(event.currentTarget.form!, false)}
            type="button"
          >
            Save and continue later
          </button>
          <button type="submit">
            {step === 8 ? "Confirm profile" : "Save and next"}
          </button>
        </div>
      </form>
    </main>
  );
}
