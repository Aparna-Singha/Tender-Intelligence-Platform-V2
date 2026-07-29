export const CHECKLIST_POLICY_VERSION = "deterministic-checklist-v1";
export const CHECKLIST_PRIORITY_POLICY_VERSION = "checklist-priority-v1";
export const CHECKLIST_DATE_POLICY_VERSION = "checklist-dates-v1";
export const CHECKLIST_DEDUPLICATION_POLICY_VERSION =
  "conservative-checklist-dedup-v1";

export const checklistItemTypes = [
  "OBTAIN_DOCUMENT",
  "UPLOAD_DOCUMENT",
  "RENEW_DOCUMENT",
  "VERIFY_DOCUMENT",
  "REVIEW_DOCUMENT_CONTENT",
  "CAPTURE_EVIDENCE_FACT",
  "LINK_EXISTING_EVIDENCE",
  "VERIFY_SELF_DECLARED_FACT",
  "PROVIDE_FINANCIAL_EVIDENCE",
  "PROVIDE_EXPERIENCE_EVIDENCE",
  "OBTAIN_OEM_AUTHORISATION",
  "PROVIDE_CERTIFICATION",
  "PROVIDE_LICENCE",
  "UPDATE_COMPANY_PROFILE",
  "RESOLVE_EVIDENCE_CONFLICT",
  "REVIEW_REQUIREMENT",
  "CONFIRM_APPLICABILITY",
  "SEEK_TENDER_CLARIFICATION",
  "TECHNICAL_REVIEW",
  "COMMERCIAL_REVIEW",
  "LEGAL_REVIEW",
  "READY_FOR_REASSESSMENT",
  "OTHER",
] as const;

export type ChecklistItemType = (typeof checklistItemTypes)[number];
export type ChecklistPriority = "BLOCKING" | "HIGH" | "MEDIUM" | "LOW";

export interface ChecklistAssessmentInput {
  readonly assessmentId: string;
  readonly currentState:
    | "VERIFIED"
    | "LIKELY_MET"
    | "MISSING"
    | "CONFLICT"
    | "NOT_APPLICABLE"
    | "HUMAN_REVIEW_REQUIRED";
  readonly proposedState: string;
  readonly policyRule: string;
  readonly requirementCategory: string;
  readonly requirementId: string;
  readonly obligation: "MANDATORY" | "OPTIONAL" | "CONDITIONAL" | "UNSPECIFIED";
  readonly sourceCoverageComplete: boolean;
  readonly tenderCitationId: string;
  readonly hasDirectEvidence: boolean;
  readonly hasDocumentMetadata: boolean;
  readonly hasUnverifiedEvidence: boolean;
  readonly hasExpiredEvidence: boolean;
  readonly financialYear?: string;
  readonly manufacturer?: string;
  readonly scope?: string;
}

export interface ChecklistProposal {
  readonly completionCriteria: string;
  readonly deduplicationKey: string;
  readonly evidenceNeedCategory: string;
  readonly explanation: string;
  readonly itemType: ChecklistItemType;
  readonly policyRule: string;
  readonly priority: ChecklistPriority;
  readonly priorityRationale: string;
  readonly title: string;
}

export function proposeChecklistItem(
  input: ChecklistAssessmentInput,
): ChecklistProposal | undefined {
  if (
    input.currentState === "VERIFIED" ||
    input.currentState === "NOT_APPLICABLE"
  )
    return undefined;

  if (!input.sourceCoverageComplete)
    return proposal(input, {
      completionCriteria:
        "An authorised human examines the cited source and records a source-grounded Phase 7 review.",
      evidenceNeedCategory: "HUMAN_REVIEW",
      itemType: "REVIEW_DOCUMENT_CONTENT",
      policyRule: "INCOMPLETE_SOURCE_COVERAGE",
      title: "Review source coverage",
    });

  if (input.currentState === "CONFLICT")
    return proposal(input, {
      completionCriteria:
        "An authorised reviewer resolves the cited evidence conflict in Phase 7.",
      evidenceNeedCategory: "CONFLICTING_EVIDENCE",
      itemType: "RESOLVE_EVIDENCE_CONFLICT",
      policyRule: "CONTROLLED_CONFLICT",
      title: "Resolve conflicting evidence",
    });

  if (input.hasExpiredEvidence)
    return proposal(input, {
      completionCriteria:
        "Current approved evidence is captured and reassessed in Phase 7.",
      evidenceNeedCategory: "EXPIRED_EVIDENCE",
      itemType: "RENEW_DOCUMENT",
      policyRule: "EXPIRED_EVIDENCE",
      title: "Renew expired evidence",
    });

  if (input.currentState === "HUMAN_REVIEW_REQUIRED")
    return proposal(input, {
      completionCriteria:
        "An authorised reviewer records a cited interpretation in Phase 7.",
      evidenceNeedCategory: "AMBIGUOUS_REQUIREMENT",
      itemType:
        input.obligation === "CONDITIONAL"
          ? "CONFIRM_APPLICABILITY"
          : "REVIEW_REQUIREMENT",
      policyRule: "ASSESSMENT_REQUIRES_HUMAN_REVIEW",
      title:
        input.obligation === "CONDITIONAL"
          ? "Confirm requirement applicability"
          : "Review ambiguous requirement",
    });

  if (input.currentState === "LIKELY_MET") {
    if (input.hasDocumentMetadata && !input.hasDirectEvidence)
      return proposal(input, {
        completionCriteria:
          "A cited company-evidence fact establishes document scope and is reviewed in Phase 7.",
        evidenceNeedCategory: "DOCUMENT_CONTENT_REVIEW",
        itemType: "REVIEW_DOCUMENT_CONTENT",
        policyRule: "DOCUMENT_EXISTS_WITHOUT_DIRECT_SUPPORT",
        title: "Review existing document content",
      });
    return proposal(input, {
      completionCriteria:
        "Direct current evidence is verified by an authorised reviewer in Phase 7.",
      evidenceNeedCategory: "EVIDENCE_VERIFICATION",
      itemType: input.hasUnverifiedEvidence
        ? "VERIFY_SELF_DECLARED_FACT"
        : "LINK_EXISTING_EVIDENCE",
      policyRule: "LIKELY_MET_REQUIRES_DIRECT_SUPPORT",
      title: "Verify supporting evidence",
    });
  }

  const category = input.requirementCategory.toUpperCase();
  const mapping: readonly [RegExp, ChecklistItemType, string][] = [
    [/TURNOVER|FINANCIAL/u, "PROVIDE_FINANCIAL_EVIDENCE", "financial evidence"],
    [
      /EXPERIENCE|PAST_PERFORMANCE/u,
      "PROVIDE_EXPERIENCE_EVIDENCE",
      "experience evidence",
    ],
    [
      /OEM|AUTHORISATION|AUTHORIZATION/u,
      "OBTAIN_OEM_AUTHORISATION",
      "OEM authorisation",
    ],
    [/CERTIF/u, "PROVIDE_CERTIFICATION", "certification"],
    [/LICEN[CS]E/u, "PROVIDE_LICENCE", "licence"],
  ];
  const mapped = mapping.find(([pattern]) => pattern.test(category));
  return proposal(input, {
    completionCriteria:
      "Current approved, cited evidence is added to a fresh Phase 7 assessment.",
    evidenceNeedCategory: mapped?.[2] ?? "MISSING_STRUCTURED_EVIDENCE",
    itemType: mapped?.[1] ?? "CAPTURE_EVIDENCE_FACT",
    policyRule:
      mapped === undefined
        ? "MISSING_STRUCTURED_EVIDENCE"
        : "MISSING_CATEGORY_EVIDENCE",
    title: `Provide ${mapped?.[2] ?? "missing structured evidence"}`,
  });
}

function proposal(
  input: ChecklistAssessmentInput,
  values: Omit<
    ChecklistProposal,
    "deduplicationKey" | "explanation" | "priority" | "priorityRationale"
  >,
): ChecklistProposal {
  const priority = priorityFor(input);
  return {
    ...values,
    deduplicationKey: [
      values.itemType,
      input.requirementCategory.toUpperCase(),
      input.financialYear ?? "",
      input.manufacturer?.toUpperCase() ?? "",
      input.scope?.toUpperCase() ?? "",
      input.obligation,
    ].join("|"),
    explanation:
      "This action is derived from the current controlled Phase 7 assessment and does not independently determine eligibility.",
    priority,
    priorityRationale:
      priority === "BLOCKING"
        ? "A mandatory unresolved assessment prevents reliable reassessment."
        : priority === "HIGH"
          ? "The unresolved evidence need is material and should be reviewed promptly."
          : priority === "MEDIUM"
            ? "The requirement is conditional or requires non-blocking review."
            : "The action concerns optional evidence improvement.",
  };
}

function priorityFor(input: ChecklistAssessmentInput): ChecklistPriority {
  if (
    input.obligation === "MANDATORY" &&
    (input.currentState === "MISSING" ||
      input.currentState === "CONFLICT" ||
      input.hasExpiredEvidence)
  )
    return "BLOCKING";
  if (input.obligation === "MANDATORY") return "HIGH";
  if (input.obligation === "CONDITIONAL") return "MEDIUM";
  return input.obligation === "OPTIONAL" ? "LOW" : "MEDIUM";
}

export function canTransitionChecklistItem(
  from: string,
  to: string,
  input: {
    readonly blockedReason?: string;
    readonly dismissalRationale?: string;
    readonly resolutionProvenance?: boolean;
  },
): boolean {
  if (to === "BLOCKED" && (input.blockedReason?.trim().length ?? 0) < 10)
    return false;
  if (to === "DISMISSED" && (input.dismissalRationale?.trim().length ?? 0) < 10)
    return false;
  if (to === "RESOLVED" && input.resolutionProvenance !== true) return false;
  const allowed: Readonly<Record<string, readonly string[]>> = {
    OPEN: ["IN_PROGRESS", "BLOCKED", "DISMISSED"],
    IN_PROGRESS: ["BLOCKED", "READY_FOR_REASSESSMENT", "DISMISSED"],
    BLOCKED: ["IN_PROGRESS", "DISMISSED"],
    READY_FOR_REASSESSMENT: ["IN_PROGRESS", "RESOLVED", "BLOCKED"],
    RESOLVED: ["OPEN"],
    DISMISSED: ["OPEN"],
  };
  return allowed[from]?.includes(to) ?? false;
}
