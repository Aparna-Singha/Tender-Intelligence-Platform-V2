import { Inject, Injectable } from "@nestjs/common";
import {
  TENDER_WORKFLOW_PROGRESS_JOB,
  tenderWorkflowProgressQueuePolicy,
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

  public async schedule(job: TenderWorkflowProgressJob): Promise<void> {
    const policy = tenderWorkflowProgressQueuePolicy(job);
    await this.queue.add(TENDER_WORKFLOW_PROGRESS_JOB, job, {
      attempts: policy.attempts,
      backoff: { delay: policy.backoffDelayMs, type: "exponential" },
      deduplication: {
        id: policy.deduplicationId,
        keepLastIfActive: policy.keepLastIfActive,
      },
      jobId: policy.jobId,
      removeOnComplete: policy.removeOnComplete,
    });
  }
}
