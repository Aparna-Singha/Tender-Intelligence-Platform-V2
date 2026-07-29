import { z } from "zod";

export const organisationTypeSchema = z.enum(["MSME", "CONSULTANT"]);
export const organisationRoleSchema = z.enum([
  "OWNER",
  "ADMIN",
  "TENDER_EXECUTIVE",
  "CONSULTANT",
  "REVIEWER",
]);

export const createOrganisationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: organisationTypeSchema,
});

export const createInvitationRequestSchema = z.object({
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  role: organisationRoleSchema.exclude(["OWNER"]),
});

export const changeMembershipRoleRequestSchema = z.object({
  role: organisationRoleSchema.exclude(["OWNER"]),
});

export type OrganisationType = z.infer<typeof organisationTypeSchema>;
export type OrganisationRole = z.infer<typeof organisationRoleSchema>;
export type CreateOrganisationRequest = z.infer<
  typeof createOrganisationRequestSchema
>;
export type CreateInvitationRequest = z.infer<
  typeof createInvitationRequestSchema
>;
export type ChangeMembershipRoleRequest = z.infer<
  typeof changeMembershipRoleRequestSchema
>;
