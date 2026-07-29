import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@tender/domain";

export const ACCESS_POLICY = Symbol("ACCESS_POLICY");
export const RATE_LIMIT_POLICY = Symbol("RATE_LIMIT_POLICY");

export type AccessPolicy =
  | { readonly kind: "authenticated" }
  | { readonly kind: "organisation"; readonly permission: Permission }
  | { readonly kind: "public" };

export interface RateLimitPolicy {
  readonly limit: number;
  readonly scope: string;
  readonly windowSeconds: number;
}

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_POLICY, { kind: "public" } satisfies AccessPolicy);

export const Authenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_POLICY, { kind: "authenticated" } satisfies AccessPolicy);

export const RequireOrganisationPermission = (
  permission: Permission,
): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_POLICY, {
    kind: "organisation",
    permission,
  } satisfies AccessPolicy);

export const RateLimited = (
  policy: RateLimitPolicy,
): MethodDecorator & ClassDecorator => SetMetadata(RATE_LIMIT_POLICY, policy);
