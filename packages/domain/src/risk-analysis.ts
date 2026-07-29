export const EARLY_RISK_POLICY_VERSION = "early-deterministic-v1";
export const RISK_RULE_VERSION = "1";

export const riskCategories = [
  "EXTRACTION_UNCERTAINTY",
  "AMBIGUOUS_CLAUSE",
  "CONFLICTING_INFORMATION",
  "DOCUMENT_SUBMISSION",
  "OEM_OR_MANUFACTURER_RESTRICTION",
  "RESELLER_RESTRICTION",
  "EMD_OR_BID_SECURITY",
  "PERFORMANCE_SECURITY",
  "PAYMENT_TERM",
  "PENALTY_OR_LIQUIDATED_DAMAGES",
  "WARRANTY_OR_MAINTENANCE",
  "DELIVERY_OR_IMPLEMENTATION",
  "MSME_RELAXATION_AMBIGUITY",
  "OTHER",
] as const;
export type RiskCategory = (typeof riskCategories)[number];
export type RiskSeverity =
  "INFORMATIONAL" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RiskMateriality =
  | "NON_MATERIAL"
  | "MATERIAL"
  | "POTENTIALLY_BLOCKING"
  | "BLOCKING_REQUIRES_HUMAN_DISPOSITION";
export type RiskConfidence =
  "HIGH" | "MEDIUM" | "LOW" | "HUMAN_REVIEW_REQUIRED";

export interface RiskRuleInput {
  readonly citationIds: readonly string[];
  readonly confidence: RiskConfidence;
  readonly findingState: string;
  readonly sourceWording: string;
}
export interface RiskFindingCandidate {
  readonly blocking: boolean;
  readonly category: RiskCategory;
  readonly citationIds: readonly string[];
  readonly confidence: RiskConfidence;
  readonly explanation: string;
  readonly materiality: RiskMateriality;
  readonly rationale: string;
  readonly ruleId: string;
  readonly severity: RiskSeverity;
  readonly title: string;
}

interface Rule {
  readonly category: RiskCategory;
  readonly explanation: string;
  readonly id: string;
  readonly materiality: RiskMateriality;
  readonly pattern: RegExp;
  readonly severity: RiskSeverity;
  readonly title: string;
}

const rules: readonly Rule[] = [
  rule(
    "AMBIGUOUS_WORDING",
    /\b(may|normally|generally|as applicable|and\/or)\b/iu,
    "AMBIGUOUS_CLAUSE",
    "Source wording is ambiguous",
    "The cited wording is imprecise and requires human interpretation.",
    "MEDIUM",
    "MATERIAL",
  ),
  rule(
    "EMD_OBLIGATION",
    /\b(emd|earnest money|bid security)\b/iu,
    "EMD_OR_BID_SECURITY",
    "Bid-security obligation requires review",
    "The cited source contains an EMD or bid-security obligation.",
    "HIGH",
    "MATERIAL",
  ),
  rule(
    "PERFORMANCE_SECURITY",
    /\b(performance (?:security|bank guarantee)|pbg)\b/iu,
    "PERFORMANCE_SECURITY",
    "Performance-security obligation requires review",
    "The cited source contains a material performance-security obligation.",
    "HIGH",
    "POTENTIALLY_BLOCKING",
  ),
  rule(
    "PENALTY_LD",
    /\b(liquidated damages?|penalt(?:y|ies))\b/iu,
    "PENALTY_OR_LIQUIDATED_DAMAGES",
    "Penalty or liquidated-damages term",
    "The cited source contains a material penalty or liquidated-damages clause.",
    "HIGH",
    "MATERIAL",
  ),
  rule(
    "OEM_RESTRICTION",
    /\b(manufacturer only|oem only|original equipment manufacturer|manufacturer authori[sz]ation)\b/iu,
    "OEM_OR_MANUFACTURER_RESTRICTION",
    "Potentially restrictive manufacturer wording",
    "Manufacturer or OEM wording may restrict participation and requires review; no eligibility conclusion is made.",
    "HIGH",
    "POTENTIALLY_BLOCKING",
  ),
  rule(
    "RESELLER_RESTRICTION",
    /\b(reseller|dealer|distributor).{0,80}\b(not permitted|prohibited|authori[sz]ation|required)\b/iu,
    "RESELLER_RESTRICTION",
    "Reseller condition requires review",
    "The cited source contains a potentially restrictive reseller condition.",
    "HIGH",
    "POTENTIALLY_BLOCKING",
  ),
  rule(
    "MSME_RELAXATION",
    /\b(msme|mse|startup).{0,120}\b(relaxation|exemption|preference|waiver)\b/iu,
    "MSME_RELAXATION_AMBIGUITY",
    "MSME or Startup relaxation requires review",
    "The cited relaxation wording requires human interpretation and is not an eligibility decision.",
    "MEDIUM",
    "MATERIAL",
  ),
  rule(
    "PAYMENT_TERM",
    /\b(payment within|payment period|retention money|withhold|deduction)\b/iu,
    "PAYMENT_TERM",
    "Payment or retention term requires review",
    "The cited source contains a material payment, retention, or deduction term.",
    "MEDIUM",
    "MATERIAL",
  ),
  rule(
    "WARRANTY_MAINTENANCE",
    /\b(warranty|maintenance|annual maintenance|amc)\b/iu,
    "WARRANTY_OR_MAINTENANCE",
    "Warranty or maintenance obligation",
    "The cited source contains a warranty or maintenance obligation.",
    "MEDIUM",
    "MATERIAL",
  ),
  rule(
    "DELIVERY_TIMELINE",
    /\b(deliver(?:y)?|implementation).{0,80}\b(within|days?|weeks?|months?|deadline)\b/iu,
    "DELIVERY_OR_IMPLEMENTATION",
    "Delivery or implementation timeline",
    "The cited source contains a delivery or implementation timeline requiring feasibility review.",
    "MEDIUM",
    "MATERIAL",
  ),
  rule(
    "SUBMISSION_COMPLEXITY",
    /\b(notari[sz]ed|physical submission|hard cop(?:y|ies)|digitally signed|multiple copies)\b/iu,
    "DOCUMENT_SUBMISSION",
    "Submission instruction requires attention",
    "The cited source contains a signing, notarisation, or physical-submission obligation.",
    "MEDIUM",
    "MATERIAL",
  ),
];

export function analyseEarlyTenderRisk(
  inputs: readonly RiskRuleInput[],
): readonly RiskFindingCandidate[] {
  return inputs.flatMap((input) => {
    if (input.citationIds.length === 0) return [];
    const uncertain =
      input.findingState === "AMBIGUOUS" ||
      input.findingState === "CONFLICTING" ||
      input.findingState === "HUMAN_REVIEW_REQUIRED" ||
      input.confidence === "LOW" ||
      input.confidence === "HUMAN_REVIEW_REQUIRED";
    const uncertainty: RiskFindingCandidate[] = uncertain
      ? [
          {
            blocking: false,
            category:
              input.findingState === "CONFLICTING"
                ? "CONFLICTING_INFORMATION"
                : "EXTRACTION_UNCERTAINTY",
            citationIds: input.citationIds,
            confidence: input.confidence,
            explanation:
              input.findingState === "CONFLICTING"
                ? "Conflicting source values detected."
                : "Insufficient extraction confidence; human interpretation is required.",
            materiality: "MATERIAL",
            rationale: input.sourceWording.slice(0, 1000),
            ruleId: "EXTRACTION_UNCERTAINTY",
            severity: "MEDIUM",
            title: "Extracted content requires human review",
          },
        ]
      : [];
    return [
      ...uncertainty,
      ...rules
        .filter((candidate) => candidate.pattern.test(input.sourceWording))
        .map((candidate) => ({
          blocking:
            candidate.materiality === "BLOCKING_REQUIRES_HUMAN_DISPOSITION",
          category: candidate.category,
          citationIds: input.citationIds,
          confidence: input.confidence,
          explanation: candidate.explanation,
          materiality: candidate.materiality,
          rationale: input.sourceWording.slice(0, 1000),
          ruleId: candidate.id,
          severity: candidate.severity,
          title: candidate.title,
        })),
    ];
  });
}

function rule(
  id: string,
  pattern: RegExp,
  category: RiskCategory,
  title: string,
  explanation: string,
  severity: RiskSeverity,
  materiality: RiskMateriality,
): Rule {
  return { category, explanation, id, materiality, pattern, severity, title };
}
