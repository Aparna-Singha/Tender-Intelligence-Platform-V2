export interface DomainEvent<TPayload extends object = Record<string, never>> {
  readonly eventId: string;
  readonly eventName: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

export {
  canChangeMemberRole,
  canInviteRole,
  hasPermission,
  isOrganisationRole,
  organisationRoles,
  ownsOrganisationResource,
  permissions,
  roles,
} from "./authorisation.js";
export {
  buildOnboardingRecommendations,
  calculateProfileCompleteness,
  dashboardMode,
  onboardingStepNames,
} from "./onboarding.js";
export type {
  DashboardRecommendation,
  ProfileCompleteness,
} from "./onboarding.js";
export type {
  OrganisationPrincipal,
  OrganisationRole,
  Permission,
  Role,
} from "./authorisation.js";
export {
  canDownloadDocument,
  extensionFor,
  isAllowedMimeExtension,
  MAX_DOCUMENTS_PER_ORGANISATION,
  MAX_UPLOAD_BYTES,
} from "./document-policy.js";
export {
  AdminImportAdapter,
  CuratedDatasetAdapter,
  DEMONSTRATION_LABEL,
  ManualUploadAdapter,
  validateZipEntries,
} from "./tender-source.js";
export {
  classifySections,
  extractDeterministicFields,
  extractDeterministicRequirements,
  PARSER_POLICY_VERSION,
  STRUCTURING_POLICY_VERSION,
  validateCitation,
} from "./extraction.js";
export {
  analyseEarlyTenderRisk,
  EARLY_RISK_POLICY_VERSION,
  RISK_RULE_VERSION,
  riskCategories,
} from "./risk-analysis.js";
export type {
  RiskCategory,
  RiskConfidence,
  RiskFindingCandidate,
  RiskMateriality,
  RiskRuleInput,
  RiskSeverity,
} from "./risk-analysis.js";
export type {
  ClassifiedSectionCandidate,
  Confidence,
  ExtractedFieldCandidate,
  ExtractionIssueCandidate,
  NormalizedBlockType,
  OcrEngine,
  OcrPageInput,
  OcrPageOutput,
  ParsedBlock,
  ParsedDocument,
  ParsedTable,
  ParsedTableCell,
  ParsedUnit,
  RequirementCandidate,
  SourceAnchor,
  SourceFormat,
  TenderDocumentParser,
} from "./extraction.js";
export type {
  NormalizedTenderSource,
  TenderSourceAdapter,
  TenderSourceInput,
  ZipEntry,
} from "./tender-source.js";
