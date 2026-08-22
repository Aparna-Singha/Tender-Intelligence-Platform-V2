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
import { tenderWorkflowProgressQueueName } from "@tender/contracts";
import { createPrismaClient, type PrismaClient } from "@tender/database";
import { Redis } from "ioredis";
import { Queue } from "bullmq";

import {
  API_ENVIRONMENT,
  PRISMA_CLIENT,
  REDIS_CLIENT,
  S3_CLIENT,
  JOB_QUEUE,
  WORKFLOW_PROGRESS_QUEUE,
} from "./infrastructure.tokens.js";
import { TenderWorkflowProgressionScheduler } from "./common/tender-workflow-progression-scheduler.service.js";

class InfrastructureShutdown implements OnApplicationShutdown {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(JOB_QUEUE) private readonly queue: Queue,
    @Inject(WORKFLOW_PROGRESS_QUEUE)
    private readonly workflowProgressQueue: Queue,
  ) {}

  public async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([
      this.queue.close(),
      this.workflowProgressQueue.close(),
      this.database.$disconnect(),
      this.redis.quit(),
    ]);
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
      provide: JOB_QUEUE,
      inject: [API_ENVIRONMENT],
      useFactory: (environment: ApiEnvironment): Queue =>
        new Queue(environment.QUEUE_NAME, {
          connection: new Redis(environment.REDIS_URL, {
            lazyConnect: true,
            maxRetriesPerRequest: null,
          }),
        }),
    },
    {
      provide: WORKFLOW_PROGRESS_QUEUE,
      inject: [API_ENVIRONMENT],
      useFactory: (environment: ApiEnvironment): Queue =>
        new Queue(tenderWorkflowProgressQueueName(environment.QUEUE_NAME), {
          connection: new Redis(environment.REDIS_URL, {
            lazyConnect: true,
            maxRetriesPerRequest: null,
          }),
        }),
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
          // The SDK's default flexible-checksum behaviour signs a
          // CRC32 checksum computed over an empty body into presigned
          // PutObject URLs (it has no body to hash at sign time). The
          // browser's direct upload then sends the real file content,
          // which mismatches that pre-baked checksum and MinIO/S3
          // rejects the PUT with 400 before the object is stored.
          // "WHEN_REQUIRED" stops the SDK from opportunistically
          // attaching a checksum unless the operation explicitly asks
          // for one; the app's own sha256 integrity check in
          // completeUpload() is unaffected and remains authoritative.
          requestChecksumCalculation: "WHEN_REQUIRED",
        }),
    },
    TenderWorkflowProgressionScheduler,
    InfrastructureShutdown,
  ],
  exports: [
    API_ENVIRONMENT,
    PRISMA_CLIENT,
    REDIS_CLIENT,
    S3_CLIENT,
    JOB_QUEUE,
    WORKFLOW_PROGRESS_QUEUE,
    TenderWorkflowProgressionScheduler,
  ],
})
export class InfrastructureModule {}
