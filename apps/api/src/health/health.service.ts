import { HeadBucketCommand, type S3Client } from "@aws-sdk/client-s3";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@tender/config";
import type { Readiness } from "@tender/contracts";
import type { PrismaClient } from "@tender/database";
import type { Redis } from "ioredis";

import {
  API_ENVIRONMENT,
  PRISMA_CLIENT,
  REDIS_CLIENT,
  S3_CLIENT,
} from "../infrastructure.tokens.js";

type CheckName = "object_storage" | "postgresql" | "redis";

@Injectable()
export class HealthService {
  public constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(S3_CLIENT) private readonly objectStorage: S3Client,
  ) {}

  public async readiness(): Promise<Readiness> {
    const entries = await Promise.all([
      this.runCheck("postgresql", async () => {
        await this.database.$queryRaw`SELECT 1`;
      }),
      this.runCheck("redis", async () => {
        if (this.redis.status === "wait") {
          await this.redis.connect();
        }
        await this.redis.ping();
      }),
      this.runCheck("object_storage", async () => {
        await this.objectStorage.send(
          new HeadBucketCommand({ Bucket: this.environment.S3_BUCKET }),
        );
      }),
    ]);
    const checks = Object.fromEntries(entries) as Record<
      CheckName,
      "down" | "up"
    >;
    const ready = Object.values(checks).every((result) => result === "up");

    return {
      checks,
      status: ready ? "ready" : "not_ready",
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
