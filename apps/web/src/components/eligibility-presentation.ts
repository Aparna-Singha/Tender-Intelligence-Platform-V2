import { humanizeEnum } from "@tender/ui";

export interface EligibilityViewRequirement {
  readonly extractionConfidence?: string;
  readonly assessmentId: string | null;
  readonly categoryLabel: string;
  readonly evidenceLinks: readonly {
    readonly excerpt: string;
    readonly label: string;
    readonly supportingText: string;
  }[];
  readonly id: string;
  readonly reviewStateLabel: string;
  readonly sourceCitation: {
    readonly boundedExcerpt: string;
    readonly clauseLabel?: string | null;
    readonly documentName: string;
    readonly pageNumber: number | null;
    readonly tenderDocumentId: string;
  } | null;
  readonly stateKey: string;
  readonly statement: string;
  readonly statusLabel: string;
  readonly statusTone:
    "accent" | "danger" | "info" | "neutral" | "success" | "warning";
  readonly structuredRequirementId: string | null;
  readonly title: string;
  readonly whatToDo: string;
  readonly why: string;
}

export function needsSourceReview(text: string, confidence?: string): boolean {
  if (confidence === "LOW" || confidence === "VERY_LOW") return true;
  const value = text.trim();
  if (value.length < 3 || !/\p{L}/u.test(value)) return true;
  if (/\uFFFD|[\uE000-\uF8FF]/u.test(value)) return true;
  // Recognise broken UTF-8 decoding, not a language or script.
  const mojibake = value.match(/[ÃÂâàð]/gu) ?? [];
  if (mojibake.length >= 2) return true;
  const tokens = value.split(/\s+/u).filter(Boolean);
  const fragments = tokens.filter(
    (token) => /^\p{M}+$/u.test(token) || /^[^\p{L}\p{N}]{3,}$/u.test(token),
  );
  return tokens.length >= 5 && fragments.length / tokens.length > 0.35;
}

function preferredReadableText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function conciseRequirementTitle(input: {
  readonly category: string;
  readonly normalizedStatement: string;
  readonly sourceCitation: { readonly boundedExcerpt: string } | null;
  readonly sourceWording: string;
  readonly title: string;
}): string {
  const source =
    input.sourceCitation?.boundedExcerpt ??
    input.sourceWording ??
    input.normalizedStatement;
  if (
    needsSourceReview(source) ||
    (input.normalizedStatement.trim() !== "" &&
      needsSourceReview(input.normalizedStatement))
  )
    return "Requirement needs source review";
  const text = `${input.title} ${source}`;
  if (/purchase preference/i.test(text)) return "Purchase preference";
  if (/\bGST\b/i.test(text) && /registration|certificate/i.test(text))
    return "GST registration certificate";
  if (/\bOEM\b|original equipment manufacturer/i.test(text)) {
    if (/authori[sz]ation|authori[sz]ed/i.test(text))
      return "OEM authorisation";
  }
  if (/experience/i.test(text) && /relaxation|exempt/i.test(text))
    return "Experience relaxation";
  if (
    /\bMSE\b|micro (?:or|and) small enterprise/i.test(text) &&
    /exempt/i.test(text)
  )
    return "MSE exemption";
  if (/start[- ]?up/i.test(text) && /exempt/i.test(text))
    return "Startup exemption";
  if (/past experience|prior experience|similar work|past project/i.test(text))
    return "Past experience";
  if (/solvency.*certificate|certificate.*solvency/i.test(text))
    return "Solvency certificate";
  if (/turnover/i.test(text)) return "Turnover requirement";
  if (/earnest money|\bEMD\b/i.test(text)) return "Earnest money deposit (EMD)";
  if (/performance security|performance guarantee/i.test(text))
    return "Performance security";
  const title = preferredReadableText(input.title);
  if (
    title &&
    title.length <= 72 &&
    !/^(other requirement|supporting document|.* requirement)$|^(payments shall|of the|is a micro)/i.test(
      title,
    )
  )
    return title;
  const category = humanizeEnum(input.category);
  return category && category !== "Other"
    ? `${category} requirement`
    : "Tender requirement";
}

export function requirementCategoryLabel(category: string): string {
  const label = humanizeEnum(category).trim();
  return label === "" ? "Requirement" : `${label} requirement`;
}

function matchingRequirementBody(
  requirement: EligibilityViewRequirement,
): string {
  return requirement.statement.trim() === ""
    ? requirement.title
    : requirement.statement;
}

export function requirementDisplaySummary(
  requirement: EligibilityViewRequirement,
): string {
  const text = preferredReadableText(matchingRequirementBody(requirement));
  if (text.length <= 280) return text;
  return `${text.slice(0, 277).trimEnd()}...`;
}

export function compactSourceExcerpt(excerpt: string): string {
  const clean = excerpt.trim();
  if (clean.length <= 260) return clean;
  const sentenceEnd = clean.slice(0, 260).search(/[.!?](?:\s|$)/);
  if (sentenceEnd >= 80) return clean.slice(0, sentenceEnd + 1);
  return `${clean.slice(0, 257).trimEnd()}...`;
}

export function customerAssessmentReason(
  requirement: EligibilityViewRequirement,
): string {
  const reason = requirement.why.trim();
  const technical =
    /evidence scope|comparable fact|assessment run|snapshot|policy|fingerprint/i.test(
      reason,
    );
  if (!technical) return reason;
  if (requirement.evidenceLinks.length === 0)
    return "No accepted company evidence currently proves this requirement.";
  return "The available company documents do not clearly establish this requirement.";
}

export interface RequirementPresentation {
  readonly actionLabel: string | null;
  readonly applicabilityQuestion: string | null;
  readonly displayTitle: string;
  readonly evidenceEmptyLabel: string;
  readonly evidenceNeeded: string;
  readonly kindLabel: string | null;
  readonly statusLabel: string;
  readonly statusTone: EligibilityViewRequirement["statusTone"];
  readonly whatThisMeans: string;
  readonly filterKey:
    | "SATISFIED"
    | "NEED_EVIDENCE"
    | "NEED_REVIEW"
    | "BLOCKING"
    | "OTHER"
    | "NOT_APPLICABLE";
  readonly sourceReview: boolean;
}

export function requirementPresentation(
  requirement: EligibilityViewRequirement,
): RequirementPresentation {
  const statement =
    requirement.statement.trim() === ""
      ? (requirement.sourceCitation?.boundedExcerpt ?? requirement.title)
      : requirement.statement;
  const exactSource = requirement.sourceCitation?.boundedExcerpt ?? statement;
  const sourceReview =
    needsSourceReview(statement, requirement.extractionConfidence) ||
    needsSourceReview(exactSource) ||
    requirement.title === "Requirement needs source review";
  if (sourceReview)
    return {
      actionLabel: "Review source",
      applicabilityQuestion: null,
      displayTitle: "Requirement needs source review",
      evidenceEmptyLabel:
        "Review the source before deciding what evidence is required.",
      evidenceNeeded: "Review the source document wording.",
      kindLabel: "Source review",
      statusLabel: "Source review needed",
      statusTone: "warning",
      whatThisMeans:
        "We couldn't safely interpret this requirement from the extracted text.",
      filterKey: "NEED_REVIEW",
      sourceReview: true,
    };
  const text = `${requirement.title} ${statement}`;
  const conditional =
    /relaxation|exempt(?:ion)?|\bif (?:the )?bidder\b|purchase preference/i.test(
      text,
    );
  const resolved = ["VERIFIED", "LIKELY_MET", "NOT_APPLICABLE"].includes(
    requirement.stateKey,
  );
  const assessed = [
    "VERIFIED",
    "LIKELY_MET",
    "NOT_APPLICABLE",
    "MISSING",
    "HUMAN_REVIEW_REQUIRED",
    "CONFLICT",
  ].includes(requirement.stateKey);
  const displayTitle = conciseRequirementTitle({
    category: requirement.categoryLabel.replace(/ requirement$/, ""),
    normalizedStatement: statement,
    sourceCitation: requirement.sourceCitation,
    sourceWording: exactSource,
    title: requirement.title,
  });
  let statusLabel = requirement.statusLabel;
  let statusTone = requirement.statusTone;
  let filterKey: RequirementPresentation["filterKey"] = "OTHER";
  let actionLabel: string | null = null;
  if (requirement.stateKey === "CONFLICT") {
    statusLabel = "Blocking";
    statusTone = "danger";
    filterKey = "BLOCKING";
    actionLabel = "Review evidence";
  } else if (conditional && !resolved && assessed) {
    statusLabel = "Confirm applicability";
    statusTone = "warning";
    filterKey = "NEED_REVIEW";
    actionLabel = "Confirm applicability";
  } else if (
    requirement.stateKey === "MISSING" ||
    (requirement.stateKey === "HUMAN_REVIEW_REQUIRED" &&
      requirement.evidenceLinks.length === 0)
  ) {
    statusLabel = "Need evidence";
    statusTone = "warning";
    filterKey = "NEED_EVIDENCE";
    actionLabel = "Add evidence";
  } else if (requirement.stateKey === "HUMAN_REVIEW_REQUIRED") {
    statusLabel = "Need review";
    statusTone = "warning";
    filterKey = "NEED_REVIEW";
    actionLabel = "Review evidence";
  } else if (requirement.stateKey === "VERIFIED") {
    statusLabel = "Satisfied";
    statusTone = "success";
    filterKey = "SATISFIED";
  } else if (requirement.stateKey === "LIKELY_MET") {
    statusLabel = "Likely met — review required";
    statusTone = "warning";
    filterKey = "NEED_REVIEW";
    actionLabel = "Review evidence";
  } else if (requirement.stateKey === "NOT_APPLICABLE") {
    statusLabel = "Not applicable";
    statusTone = "neutral";
    filterKey = "NOT_APPLICABLE";
  }
  return {
    actionLabel,
    applicabilityQuestion:
      statusLabel === "Confirm applicability"
        ? "Does your bid claim the preference, relaxation, or exemption described in this clause?"
        : null,
    displayTitle,
    evidenceEmptyLabel: "No supporting evidence is currently linked.",
    evidenceNeeded: conditional
      ? "Confirm applicability, then provide the proof specified by this clause if you claim it."
      : "Provide the supporting evidence specified by the source clause.",
    kindLabel: conditional ? "Conditional" : null,
    statusLabel,
    statusTone,
    whatThisMeans: requirementDisplaySummary(requirement),
    filterKey,
    sourceReview: false,
  };
}
