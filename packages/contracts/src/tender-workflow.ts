export const TENDER_WORKFLOW_PROGRESS_JOB = "progress-tender-workflow";

export interface TenderWorkflowProgressJob {
  readonly organisationId: string;
  readonly requestId: string;
  readonly tenderId: string;
  readonly userId: string;
}

export function tenderWorkflowProgressQueueName(queueName: string): string {
  return `${queueName}-workflow-progress`;
}
