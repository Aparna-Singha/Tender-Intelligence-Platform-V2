import { z } from "zod";

export const livenessSchema = z.object({
  status: z.literal("ok"),
  service: z.string().min(1),
});

export const readinessSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.record(z.string(), z.enum(["up", "down"])),
});

export type Liveness = z.infer<typeof livenessSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
