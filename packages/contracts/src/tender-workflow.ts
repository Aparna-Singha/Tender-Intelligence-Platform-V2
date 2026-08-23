export const TENDER_WORKFLOW_PROGRESS_JOB = "progress-tender-workflow";
const TENDER_WORKFLOW_PROGRESS_ID_SEPARATOR = "__";

export type TenderWorkflowProgressTriggerType =
  | "CONTINUE_DECISION"
  | "ELIGIBILITY_COMPLETE"
  | "EXTRACTION_COMPLETE"
  | "SOURCE_READY";

export interface TenderWorkflowProgressJob {
  readonly organisationId: string;
  readonly requestId: string;
  readonly tenderId: string;
  readonly triggerId: string;
  readonly triggerType: TenderWorkflowProgressTriggerType;
  readonly userId: string;
}

export interface TenderWorkflowProgressQueueSettings {
  readonly attempts: number;
  readonly backoffDelayMs: number;
  readonly deduplicationId: string;
  readonly jobId: string;
  readonly keepLastIfActive: true;
  readonly removeOnComplete: number;
}

export function tenderWorkflowProgressQueueName(queueName: string): string {
  return `${queueName}-workflow-progress`;
}

export function tenderWorkflowProgressJobId(
  job: Pick<
    TenderWorkflowProgressJob,
    "organisationId" | "tenderId" | "triggerId" | "triggerType"
  >,
): string {
  return [
    TENDER_WORKFLOW_PROGRESS_JOB,
    job.organisationId,
    job.tenderId,
    job.triggerType,
    job.triggerId,
  ].join(TENDER_WORKFLOW_PROGRESS_ID_SEPARATOR);
}

export function tenderWorkflowProgressDeduplicationId(
  organisationId: string,
  tenderId: string,
): string {
  return [TENDER_WORKFLOW_PROGRESS_JOB, organisationId, tenderId].join(
    TENDER_WORKFLOW_PROGRESS_ID_SEPARATOR,
  );
}

export function tenderWorkflowProgressQueuePolicy(
  job: Pick<
    TenderWorkflowProgressJob,
    "organisationId" | "tenderId" | "triggerId" | "triggerType"
  >,
): TenderWorkflowProgressQueueSettings {
  return {
    attempts: 5,
    backoffDelayMs: 2_000,
    deduplicationId: tenderWorkflowProgressDeduplicationId(
      job.organisationId,
      job.tenderId,
    ),
    jobId: tenderWorkflowProgressJobId(job),
    keepLastIfActive: true,
    removeOnComplete: 100,
  };
}
