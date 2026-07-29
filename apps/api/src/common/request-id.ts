import { randomUUID } from "node:crypto";

import { requestIdSchema } from "@tender/contracts";

export function resolveRequestId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  const result = requestIdSchema.safeParse(candidate);
  return result.success ? result.data : randomUUID();
}
