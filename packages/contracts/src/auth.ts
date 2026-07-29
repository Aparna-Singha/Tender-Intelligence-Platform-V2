import { z } from "zod";

const emailSchema = z
  .email()
  .max(320)
  .transform((value) => value.trim().toLowerCase());

const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number");

export const registerRequestSchema = z.object({
  display_name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

export const passwordResetConfirmSchema = z.object({
  password: passwordSchema,
  token: z.string().min(32).max(512),
});

export const invitationAcceptSchema = z.object({
  token: z.string().min(32).max(512),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;
export type InvitationAccept = z.infer<typeof invitationAcceptSchema>;
