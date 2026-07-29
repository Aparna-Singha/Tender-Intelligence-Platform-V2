export const organisationRoles = [
  "OWNER",
  "ADMIN",
  "TENDER_EXECUTIVE",
  "CONSULTANT",
  "REVIEWER",
] as const;

export const roles = [...organisationRoles, "PLATFORM_ADMIN"] as const;

export type OrganisationRole = (typeof organisationRoles)[number];
export type Role = (typeof roles)[number];

export const permissions = [
  "ORGANISATION_READ",
  "ORGANISATION_UPDATE",
  "MEMBERSHIP_READ",
  "MEMBERSHIP_INVITE",
  "MEMBERSHIP_ROLE_CHANGE",
  "COMPANY_PROFILE_READ",
] as const;

export type Permission = (typeof permissions)[number];

const permissionsByRole: Readonly<
  Record<OrganisationRole, readonly Permission[]>
> = {
  OWNER: permissions,
  ADMIN: [
    "ORGANISATION_READ",
    "ORGANISATION_UPDATE",
    "MEMBERSHIP_READ",
    "MEMBERSHIP_INVITE",
    "COMPANY_PROFILE_READ",
  ],
  TENDER_EXECUTIVE: ["ORGANISATION_READ", "COMPANY_PROFILE_READ"],
  CONSULTANT: ["ORGANISATION_READ", "COMPANY_PROFILE_READ"],
  REVIEWER: ["ORGANISATION_READ", "COMPANY_PROFILE_READ"],
};

export interface OrganisationPrincipal {
  readonly membershipId: string;
  readonly organisationId: string;
  readonly role: OrganisationRole;
  readonly userId: string;
}

export function isOrganisationRole(role: Role): role is OrganisationRole {
  return role !== "PLATFORM_ADMIN";
}

export function hasPermission(
  role: OrganisationRole,
  permission: Permission,
): boolean {
  return permissionsByRole[role].includes(permission);
}

export function ownsOrganisationResource(
  principal: OrganisationPrincipal,
  resourceOrganisationId: string,
): boolean {
  return principal.organisationId === resourceOrganisationId;
}

export function canInviteRole(
  actorRole: OrganisationRole,
  invitedRole: Role,
): invitedRole is OrganisationRole {
  if (!isOrganisationRole(invitedRole) || invitedRole === "OWNER") {
    return false;
  }

  if (actorRole === "OWNER") {
    return true;
  }

  return actorRole === "ADMIN" && invitedRole !== "ADMIN";
}

export function canChangeMemberRole(
  actor: OrganisationPrincipal,
  targetMembershipId: string,
  nextRole: Role,
): nextRole is OrganisationRole {
  return (
    actor.role === "OWNER" &&
    actor.membershipId !== targetMembershipId &&
    isOrganisationRole(nextRole) &&
    nextRole !== "OWNER"
  );
}
