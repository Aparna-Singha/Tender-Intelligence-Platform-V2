import { describe, expect, it } from "vitest";

import {
  canChangeMemberRole,
  canInviteRole,
  hasPermission,
  isOrganisationRole,
  ownsOrganisationResource,
  type OrganisationPrincipal,
  type OrganisationRole,
  type Permission,
} from "../src/index.js";

const owner: OrganisationPrincipal = {
  membershipId: "membership-owner",
  organisationId: "organisation-a",
  role: "OWNER",
  userId: "user-owner",
};

describe("organisation authorisation policy", () => {
  it("denies a resource owned by another organisation", () => {
    expect(ownsOrganisationResource(owner, "organisation-b")).toBe(false);
  });

  it("does not allow a changed resource ID to bypass organisation ownership", () => {
    const browserProvidedId = "organisation-b";

    expect(ownsOrganisationResource(owner, browserProvidedId)).toBe(false);
    expect(ownsOrganisationResource(owner, "organisation-a")).toBe(true);
  });

  it("denies elevated or platform roles in invitations", () => {
    expect(canInviteRole("ADMIN", "ADMIN")).toBe(false);
    expect(canInviteRole("OWNER", "OWNER")).toBe(false);
    expect(canInviteRole("OWNER", "PLATFORM_ADMIN")).toBe(false);
    expect(canInviteRole("ADMIN", "REVIEWER")).toBe(true);
  });

  it("prevents users from changing their own role or creating another owner", () => {
    expect(canChangeMemberRole(owner, owner.membershipId, "ADMIN")).toBe(false);
    expect(canChangeMemberRole(owner, "membership-reviewer", "OWNER")).toBe(
      false,
    );
    expect(canChangeMemberRole(owner, "membership-reviewer", "ADMIN")).toBe(
      true,
    );
  });

  it("denies permissions that are not explicitly granted", () => {
    expect(hasPermission("REVIEWER", "MEMBERSHIP_ROLE_CHANGE")).toBe(false);
    expect(hasPermission("OWNER", "MEMBERSHIP_ROLE_CHANGE")).toBe(true);
    expect(hasPermission("REVIEWER", "ONBOARDING_UPDATE")).toBe(false);
    expect(hasPermission("TENDER_EXECUTIVE", "ONBOARDING_UPDATE")).toBe(true);
    expect(hasPermission("REVIEWER", "TENDER_READ")).toBe(true);
    expect(hasPermission("REVIEWER", "TENDER_UPLOAD")).toBe(false);
    expect(hasPermission("TENDER_EXECUTIVE", "TENDER_ADMIN_IMPORT")).toBe(
      false,
    );
    expect(hasPermission("ADMIN", "TENDER_ADMIN_IMPORT")).toBe(true);
    expect(hasPermission("REVIEWER", "TENDER_EXTRACTION_READ")).toBe(true);
    expect(hasPermission("REVIEWER", "TENDER_EXTRACTION_REVIEW")).toBe(true);
    expect(hasPermission("REVIEWER", "TENDER_EXTRACTION_START")).toBe(false);
    expect(
      hasPermission("TENDER_EXECUTIVE", "TENDER_EXTRACTION_ADMIN_RETRY"),
    ).toBe(false);
    expect(hasPermission("ADMIN", "TENDER_EXTRACTION_ADMIN_RETRY")).toBe(true);
    expect(hasPermission("REVIEWER", "TENDER_RISK_ANALYSIS_READ")).toBe(true);
    expect(hasPermission("REVIEWER", "TENDER_RISK_ANALYSIS_START")).toBe(false);
    expect(
      hasPermission("TENDER_EXECUTIVE", "TENDER_RISK_ANALYSIS_RETRY"),
    ).toBe(false);
    expect(hasPermission("ADMIN", "TENDER_RISK_ANALYSIS_RETRY")).toBe(true);
    expect(hasPermission("REVIEWER", "TENDER_PURSUIT_DECISION_CREATE")).toBe(
      true,
    );
  });

  it("enforces the complete Phase 11 permission matrix", () => {
    const phase11Permissions = [
      "TENDER_FINAL_READINESS_READ",
      "TENDER_FINAL_READINESS_START",
      "TENDER_FINAL_READINESS_CANCEL",
      "TENDER_FINAL_READINESS_RETRY",
      "TENDER_FINAL_READINESS_FINDING_REVIEW",
      "TENDER_FINAL_READINESS_DISPOSITION_CREATE",
    ] as const satisfies readonly Permission[];
    const expected: Readonly<Record<OrganisationRole, readonly Permission[]>> =
      {
        OWNER: phase11Permissions,
        ADMIN: phase11Permissions,
        TENDER_EXECUTIVE: phase11Permissions.slice(0, 4),
        CONSULTANT: phase11Permissions.slice(0, 4),
        REVIEWER: [
          "TENDER_FINAL_READINESS_READ",
          "TENDER_FINAL_READINESS_FINDING_REVIEW",
          "TENDER_FINAL_READINESS_DISPOSITION_CREATE",
        ],
      };

    for (const [role, allowed] of Object.entries(expected) as readonly [
      OrganisationRole,
      readonly Permission[],
    ][])
      for (const permission of phase11Permissions)
        expect(hasPermission(role, permission), `${role}:${permission}`).toBe(
          allowed.includes(permission),
        );
  });

  it("does not treat Platform Administrator as an organisation role", () => {
    expect(isOrganisationRole("PLATFORM_ADMIN")).toBe(false);
  });
});
