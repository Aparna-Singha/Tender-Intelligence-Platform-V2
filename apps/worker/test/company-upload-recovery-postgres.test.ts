import { createPrismaClient } from "@tender/database";
import { expect, it } from "vitest";

const isolatedUrl = process.env.BIDVEDA_SHUTDOWN_POSTGRES_URL;

it.skipIf(isolatedUrl === undefined)(
  "server-enforced lock timeout releases recovery discovery without abandoning a query",
  async () => {
    const target = new URL(isolatedUrl ?? "");
    if (
      target.protocol !== "postgresql:" ||
      target.hostname !== "127.0.0.1" ||
      target.port !== "15442" ||
      target.pathname !== "/shutdown_rehearsal" ||
      target.username !== "postgres" ||
      target.search !== ""
    ) {
      throw new Error("Isolated PostgreSQL test target mismatch");
    }
    const holder = createPrismaClient(isolatedUrl ?? "");
    const recovery = createPrismaClient(isolatedUrl ?? "", {
      statementTimeoutMs: 10_000,
      lockTimeoutMs: 1_000,
      maxConnections: 1,
    });
    let releaseLock: () => void = () => undefined;
    let lockAcquired: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      releaseLock = () => resolve();
    });
    const locked = new Promise<void>((resolve) => {
      lockAcquired = () => resolve();
    });
    try {
      const settings = await recovery.$queryRaw<
        { statement_timeout: string; lock_timeout: string }[]
      >`SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout`;
      expect(settings[0]).toMatchObject({
        statement_timeout: "10s",
        lock_timeout: "1s",
      });
      const holding = holder.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`LOCK TABLE upload_sessions IN ACCESS EXCLUSIVE MODE`;
          lockAcquired();
          await released;
        },
        { timeout: 10_000 },
      );
      await locked;
      const started = Date.now();
      await expect(
        recovery.uploadSession.findMany({ take: 1 }),
      ).rejects.toBeDefined();
      expect(Date.now() - started).toBeLessThan(4_000);
      releaseLock();
      await holding;
      await expect(
        recovery.uploadSession.findMany({ take: 1 }),
      ).resolves.toEqual([]);
    } finally {
      releaseLock();
      await holder.$disconnect();
      await recovery.$disconnect();
    }
  },
);
