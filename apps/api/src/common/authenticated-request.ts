import type { OrganisationPrincipal, Role } from "@tender/domain";
import type { FastifyRequest } from "fastify";

export interface AuthenticatedUser {
  readonly activeOrganisationId: string | null;
  readonly displayName: string;
  readonly email: string;
  readonly platformRole: Role | null;
  readonly sessionId: string;
  readonly userId: string;
}

export interface AuthenticatedRequest extends FastifyRequest {
  authenticatedUser: AuthenticatedUser;
  organisationPrincipal?: OrganisationPrincipal;
}
