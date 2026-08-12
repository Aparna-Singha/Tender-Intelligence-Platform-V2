import type { Queue } from "bullmq";
import type { Readiness } from "@tender/contracts";
import type { PrismaClient } from "@tender/database";
import type { Redis } from "ioredis";

export interface WorkerDependencies {
  readonly database: PrismaClient;
  readonly queue: Queue;
  readonly redis: Redis;
}

type CheckName = "postgresql" | "queue" | "redis";
const readinessTimeoutMs = 2_000;

export class WorkerReadiness {
  public constructor(private readonly dependencies: WorkerDependencies) {}

  public async check(): Promise<Readiness> {
    const entries = await Promise.all([
      this.runCheck("postgresql", async () => {
        await withTimeout(
          this.dependencies.database.$queryRaw`SELECT 1`,
          readinessTimeoutMs,
        );
      }),
      this.runCheck("redis", async () => {
        await withTimeout(this.pingRedis(), readinessTimeoutMs);
      }),
      this.runCheck("queue", async () => {
        await withTimeout(this.checkQueue(), readinessTimeoutMs);
      }),
    ]);
    const checks = Object.fromEntries(entries) as Record<
      CheckName,
      "down" | "up"
    >;

    return {
      checks,
      status: Object.values(checks).every((value) => value === "up")
        ? "ready"
        : "not_ready",
    };
  }

  private async runCheck(
    name: CheckName,
    check: () => Promise<void>,
  ): Promise<readonly [CheckName, "down" | "up"]> {
    try {
      await check();
      return [name, "up"];
    } catch {
      return [name, "down"];
    }
  }

  private async pingRedis(): Promise<void> {
    if (this.dependencies.redis.status === "wait") {
      await this.dependencies.redis.connect();
    }
    await this.dependencies.redis.ping();
  }

  private async checkQueue(): Promise<void> {
    await this.dependencies.queue.waitUntilReady();
    await this.dependencies.queue.getJobCounts();
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Readiness check timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
