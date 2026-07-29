import type { PrismaClient } from "@prisma/client";

export interface DatabaseHealth {
  isReady(): Promise<boolean>;
}

export class PrismaDatabaseHealth implements DatabaseHealth {
  public constructor(private readonly client: PrismaClient) {}

  public async isReady(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
