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
