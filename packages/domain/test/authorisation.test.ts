import { describe, expect, it } from "vitest";

import {
  canChangeMemberRole,
  canInviteRole,
  hasPermission,
  ownsOrganisationResource,
  type OrganisationPrincipal,
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
  });
});
