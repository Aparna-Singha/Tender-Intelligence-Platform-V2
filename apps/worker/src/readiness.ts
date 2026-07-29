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

export class WorkerReadiness {
  public constructor(private readonly dependencies: WorkerDependencies) {}

  public async check(): Promise<Readiness> {
    const entries = await Promise.all([
      this.runCheck("postgresql", async () => {
        await this.dependencies.database.$queryRaw`SELECT 1`;
      }),
      this.runCheck("redis", async () => {
        if (this.dependencies.redis.status === "wait") {
          await this.dependencies.redis.connect();
        }
        await this.dependencies.redis.ping();
      }),
      this.runCheck("queue", async () => {
        await this.dependencies.queue.waitUntilReady();
        await this.dependencies.queue.getJobCounts();
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
}
