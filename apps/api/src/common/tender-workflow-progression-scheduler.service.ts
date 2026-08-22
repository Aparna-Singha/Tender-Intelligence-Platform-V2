import { Inject, Injectable } from "@nestjs/common";
import {
  TENDER_WORKFLOW_PROGRESS_JOB,
  type TenderWorkflowProgressJob,
} from "@tender/contracts";
import type { Queue } from "bullmq";

import { WORKFLOW_PROGRESS_QUEUE } from "../infrastructure.tokens.js";

@Injectable()
export class TenderWorkflowProgressionScheduler {
  public constructor(
    @Inject(WORKFLOW_PROGRESS_QUEUE)
    private readonly queue: Queue<TenderWorkflowProgressJob>,
  ) {}

  public async schedule(
    organisationId: string,
    tenderId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    await this.queue.add(
      TENDER_WORKFLOW_PROGRESS_JOB,
      { organisationId, requestId, tenderId, userId },
      {
        attempts: 5,
        backoff: { delay: 2_000, type: "exponential" },
        jobId: `${TENDER_WORKFLOW_PROGRESS_JOB}:${organisationId}:${tenderId}`,
        removeOnComplete: 100,
      },
    );
  }
}
