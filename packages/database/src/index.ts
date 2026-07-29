import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export { PrismaDatabaseHealth } from "./database-health.js";
export type { DatabaseHealth } from "./database-health.js";
export {
  AuditEventType,
  InvitationStatus,
  OrganisationType,
  Role,
} from "@prisma/client";
export type { Prisma, PrismaClient } from "@prisma/client";

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    max: 10,
  });

  return new PrismaClient({ adapter });
}
