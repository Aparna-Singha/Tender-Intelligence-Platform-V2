import { z } from "zod";

export const requestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/);

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string().min(1),
  }),
  request_id: requestIdSchema,
});

export function apiResponseSchema<T extends z.ZodType>(
  dataSchema: T,
): z.ZodObject<{
  data: T;
  request_id: typeof requestIdSchema;
}> {
  return z.object({
    data: dataSchema,
    request_id: requestIdSchema,
  });
}

export interface ApiResponse<T> {
  readonly data: T;
  readonly request_id: string;
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly request_id: string;
}
