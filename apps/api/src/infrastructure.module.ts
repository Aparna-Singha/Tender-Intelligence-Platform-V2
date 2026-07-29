import { S3Client } from "@aws-sdk/client-s3";
import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  apiEnvironmentSchema,
  parseEnvironment,
  type ApiEnvironment,
} from "@tender/config";
import { createPrismaClient, type PrismaClient } from "@tender/database";
import { Redis } from "ioredis";

import {
  API_ENVIRONMENT,
  PRISMA_CLIENT,
  REDIS_CLIENT,
  S3_CLIENT,
} from "./infrastructure.tokens.js";

class InfrastructureShutdown implements OnApplicationShutdown {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  public async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.database.$disconnect(), this.redis.quit()]);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: API_ENVIRONMENT,
      useFactory: (): ApiEnvironment =>
        parseEnvironment("api", apiEnvironmentSchema, process.env),
    },
    {
      provide: PRISMA_CLIENT,
      inject: [API_ENVIRONMENT],
      useFactory: (environment: ApiEnvironment): PrismaClient =>
        createPrismaClient(environment.DATABASE_URL),
    },
    {
      provide: REDIS_CLIENT,
      inject: [API_ENVIRONMENT],
      useFactory: (environment: ApiEnvironment): Redis =>
        new Redis(environment.REDIS_URL, {
          enableOfflineQueue: false,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        }),
    },
    {
      provide: S3_CLIENT,
      inject: [API_ENVIRONMENT],
      useFactory: (environment: ApiEnvironment): S3Client =>
        new S3Client({
          credentials: {
            accessKeyId: environment.S3_ACCESS_KEY_ID,
            secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
          },
          endpoint: environment.S3_ENDPOINT,
          forcePathStyle: environment.S3_FORCE_PATH_STYLE,
          region: environment.S3_REGION,
        }),
    },
    InfrastructureShutdown,
  ],
  exports: [API_ENVIRONMENT, PRISMA_CLIENT, REDIS_CLIENT, S3_CLIENT],
})
export class InfrastructureModule {}
