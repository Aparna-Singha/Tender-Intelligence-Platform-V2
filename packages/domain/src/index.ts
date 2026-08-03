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
  classifyEvidenceExpiry,
  classifyFinalReadinessFinding,
  consolidatedDraftQualificationDenials,
  evaluateFinalReadinessPrerequisites,
  FINAL_READINESS_EXPIRY_POLICY_VERSION,
  FINAL_READINESS_EXPIRY_WARNING_DAYS,
  FINAL_READINESS_POLICY_VERSION,
  FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION,
  FINAL_READINESS_REQUIRED_DRAFT_TYPE,
  finalReadinessDispositionDenials,
  finalReadinessDispositions,
  finalReadinessFindingConditions,
  finalReadinessTreatments,
  normaliseFinalReadinessFingerprintInput,
  type ConsolidatedDraftQualificationInput,
  type ConsolidatedDraftQualificationReason,
  type EvidenceExpiryClassification,
  type FinalReadinessDisposition,
  type FinalReadinessDispositionDenial,
  type FinalReadinessDispositionInput,
  type FinalReadinessFindingCondition,
  type FinalReadinessFingerprintInput,
  type FinalReadinessPrerequisite,
  type FinalReadinessPrerequisiteDenial,
  type FinalReadinessPrerequisiteInput,
  type FinalReadinessPrerequisiteReason,
  type FinalReadinessTreatment,
  type FinalReadinessTreatmentResult,
  type ScopedPrerequisite,
} from "./final-readiness.js";
export {
  createStructureAwareChunks,
  isPromptInjectionText,
  reciprocalRankFusion,
  RAG_ANSWER_POLICY_VERSION,
  RAG_CANDIDATE_LIMIT,
  RAG_CHUNK_POLICY_VERSION,
  RAG_CONTEXT_LIMIT,
  RAG_EMBEDDING_DIMENSIONS,
  RAG_FUSION_POLICY_VERSION,
  RAG_MAX_CHUNK_CHARACTERS,
  RAG_MAX_QUESTION_CHARACTERS,
  RAG_RETRIEVAL_POLICY_VERSION,
  ragSourceClasses,
  ragSourceModes,
  sourceClassesForMode,
  verifyCitationHandles,
} from "./rag-policy.js";
export {
  claimSupportState,
  DRAFTING_POLICY_VERSION,
  DRAFT_MAX_CLAIMS_PER_SECTION,
  DRAFT_MAX_CONTEXTS_PER_SECTION,
  DRAFT_MAX_INSTRUCTION_CHARACTERS,
  DRAFT_MAX_SECTION_CHARACTERS,
  DRAFT_MAX_SECTIONS,
  DRAFT_PROMPT_POLICY_VERSION,
  DRAFT_TEMPLATE_POLICY_VERSION,
  draftApprovalBlockers,
  draftClaimClasses,
  draftPlaceholderTypes,
  draftSourceFingerprint,
  draftTypes,
  evaluateDraftStartGate,
  isUnsafeDraftInstruction,
  validateTemplateSections,
  visiblePlaceholder,
  type ApprovalPolicyInput,
  type ClaimPolicyInput,
  type ControlledTemplateSection,
  type DraftClaimClass,
  type DraftGateFailure,
  type DraftGateInput,
  type DraftPlaceholderType,
  type DraftType,
} from "./drafting-policy.js";
export type {
  ChunkSource,
  CitationHandle,
  RagSourceClass,
  RagSourceMode,
  RetrievalRank,
  StructureAwareChunk,
} from "./rag-policy.js";
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
export {
  canHumanFinaliseVerified,
  EVIDENCE_COMPARISON_POLICY_VERSION,
  EVIDENCE_NORMALISATION_POLICY_VERSION,
  eligibilityStates,
  proposeEligibilityAssessment,
} from "./evidence-assessment.js";
export {
  canTransitionChecklistItem,
  CHECKLIST_DATE_POLICY_VERSION,
  CHECKLIST_DEDUPLICATION_POLICY_VERSION,
  CHECKLIST_POLICY_VERSION,
  CHECKLIST_PRIORITY_POLICY_VERSION,
  checklistItemTypes,
  proposeChecklistItem,
} from "./checklist-policy.js";
export type {
  ChecklistAssessmentInput,
  ChecklistItemType,
  ChecklistPriority,
  ChecklistProposal,
} from "./checklist-policy.js";
export type {
  AssessmentProposal,
  ComparisonEvidence,
  ComparisonRequirement,
  EligibilityState,
  MachineProposedState,
} from "./evidence-assessment.js";
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
