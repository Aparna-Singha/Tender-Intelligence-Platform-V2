import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export { PrismaDatabaseHealth } from "./database-health.js";
export type { DatabaseHealth } from "./database-health.js";
export {
  AuditEventType,
  DraftType,
  InvitationStatus,
  OnboardingStatus,
  OrganisationType,
  ProfileValueSource,
  ProfileValueType,
  Role,
  VerificationStatus,
} from "@prisma/client";
export { Prisma } from "@prisma/client";
export type { PrismaClient, RiskAnalysisRun } from "@prisma/client";

export interface PrismaConnectionLimits {
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
  readonly maxConnections?: number;
}

export function createPrismaClient(
  databaseUrl: string,
  limits: PrismaConnectionLimits = {},
): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    max: limits.maxConnections ?? 10,
    ...(limits.statementTimeoutMs === undefined
      ? {}
      : { statement_timeout: limits.statementTimeoutMs }),
    ...(limits.lockTimeoutMs === undefined
      ? {}
      : { lock_timeout: limits.lockTimeoutMs }),
  });

  return new PrismaClient({ adapter });
}
