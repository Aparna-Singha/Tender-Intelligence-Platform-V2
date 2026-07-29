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

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    max: 10,
  });

  return new PrismaClient({ adapter });
}
