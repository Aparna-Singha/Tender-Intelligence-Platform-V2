import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Queue } from "bullmq";
import type { PrismaClient } from "@tender/database";

import {
  JOB_QUEUE,
  PRISMA_CLIENT,
  WORKFLOW_PROGRESS_QUEUE,
} from "../infrastructure.tokens.js";

const MAX_JOB_ID_CHECKS = 100;
const SNAPSHOT_TIMEOUT_MS = 10_000;
const QUEUE_STATES = [
  "active",
  "waiting",
  "delayed",
  "paused",
  "waiting-children",
  "prioritized",
  "failed",
] as const;

@Injectable()
export class MaintenanceReconciliationService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(JOB_QUEUE) private readonly jobs: Queue,
    @Inject(WORKFLOW_PROGRESS_QUEUE) private readonly workflowJobs: Queue,
  ) {}

  public async snapshot(): Promise<{
    pendingUnexpiredUploads: number;
    completedUnapprovedUploads: number;
    checkedStableJobIds: number;
    missingStableJobIds: number;
    jobIdCheckTruncated: boolean;
    primaryQueue: Record<string, number>;
    workflowQueue: Record<string, number>;
    recoveryIdleProven: false;
  }> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.collectSnapshot(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("snapshot_timeout")),
            SNAPSHOT_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      throw new ServiceUnavailableException(
        "Maintenance reconciliation unavailable",
      );
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async collectSnapshot(): ReturnType<
    MaintenanceReconciliationService["snapshot"]
  > {
    const [
      pendingUnexpiredUploads,
      completedUnapprovedUploads,
      sessions,
      primaryQueue,
      workflowQueue,
    ] = await Promise.all([
      this.database.uploadSession.count({
        where: { status: "PENDING", expiresAt: { gt: new Date() } },
      }),
      this.database.uploadSession.count({
        where: {
          status: "COMPLETED",
          documentVersion: { approvedObjectKey: null },
        },
      }),
      this.database.uploadSession.findMany({
        where: {
          status: "COMPLETED",
          documentVersion: { approvedObjectKey: null },
        },
        select: { documentVersionId: true },
        orderBy: { id: "asc" },
        take: MAX_JOB_ID_CHECKS,
      }),
      this.jobs.getJobCounts(...QUEUE_STATES),
      this.workflowJobs.getJobCounts(...QUEUE_STATES),
    ]);
    let missingStableJobIds = 0;
    for (const session of sessions)
      if ((await this.jobs.getJob(session.documentVersionId)) === undefined)
        missingStableJobIds += 1;
    return {
      pendingUnexpiredUploads,
      completedUnapprovedUploads,
      checkedStableJobIds: sessions.length,
      missingStableJobIds,
      jobIdCheckTruncated: completedUnapprovedUploads > sessions.length,
      primaryQueue: boundedCounts(primaryQueue),
      workflowQueue: boundedCounts(workflowQueue),
      recoveryIdleProven: false,
    };
  }
}

function boundedCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    QUEUE_STATES.map((state) => [state, counts[state] ?? 0]),
  );
}
