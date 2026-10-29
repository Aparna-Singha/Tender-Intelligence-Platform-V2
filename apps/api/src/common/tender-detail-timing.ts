import type { TenderDetailStage } from "@tender/observability";
import type { FastifyRequest } from "fastify";

import { metricRouteForRequest } from "./metric-routes.js";

export const tenderDetailRoute =
  "/organisations/:organisationId/tenders/:tenderId";

const measuredStages = new Set<TenderDetailStage>([
  "session_authentication",
  "organisation_authorization",
  "tender_primary_query",
  "processing_jobs_query",
  "decorator_parallel_queries",
  "decorator_draft_version_query",
  "response_mapping",
]);

interface TimingState {
  readonly startedAt: bigint;
  readonly stages: Map<TenderDetailStage, number>;
  handlerDoneAt?: bigint;
  onSendAt?: bigint;
}

export interface TenderDetailTimingSummary {
  readonly durationMs: number;
  readonly stagesMs: Readonly<Partial<Record<TenderDetailStage, number>>>;
}

export type TenderDetailStageRecorder = (
  stage: TenderDetailStage,
  durationMs: number,
) => void;

const timings = new WeakMap<FastifyRequest, TimingState>();

function elapsedMs(start: bigint, end: bigint): number {
  return Math.max(0, Number(end - start) / 1_000_000);
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export function beginTenderDetailTiming(
  request: FastifyRequest,
  enabled: boolean,
  startedAt: bigint = process.hrtime.bigint(),
): void {
  if (
    !enabled ||
    request.method !== "GET" ||
    metricRouteForRequest(request) !== tenderDetailRoute
  )
    return;
  timings.set(request, { startedAt, stages: new Map() });
}

export function tenderDetailStageRecorder(
  request: FastifyRequest,
): TenderDetailStageRecorder | undefined {
  if (!timings.has(request)) return undefined;
  return (stage, durationMs) => {
    if (!measuredStages.has(stage) || !Number.isFinite(durationMs)) return;
    const state = timings.get(request);
    if (state !== undefined)
      state.stages.set(
        stage,
        Math.max(0, durationMs) + (state.stages.get(stage) ?? 0),
      );
  };
}

export async function measureTenderDetailStage<T>(
  recorder: TenderDetailStageRecorder | undefined,
  stage: TenderDetailStage,
  action: () => Promise<T>,
  startedAt?: bigint,
): Promise<T> {
  if (recorder === undefined) return action();
  const start = startedAt ?? process.hrtime.bigint();
  try {
    return await action();
  } finally {
    recorder(stage, elapsedMs(start, process.hrtime.bigint()));
  }
}

export function measureTenderDetailSync<T>(
  recorder: TenderDetailStageRecorder | undefined,
  stage: TenderDetailStage,
  action: () => T,
): T {
  if (recorder === undefined) return action();
  const startedAt = process.hrtime.bigint();
  try {
    return action();
  } finally {
    recorder(stage, elapsedMs(startedAt, process.hrtime.bigint()));
  }
}

export function markTenderDetailHandlerDone(
  request: FastifyRequest,
  at: bigint = process.hrtime.bigint(),
): void {
  const state = timings.get(request);
  if (state !== undefined) state.handlerDoneAt = at;
}

export function markTenderDetailOnSend(
  request: FastifyRequest,
  at: bigint = process.hrtime.bigint(),
): void {
  const state = timings.get(request);
  if (state !== undefined) state.onSendAt = at;
}

export function finishTenderDetailTiming(
  request: FastifyRequest,
  endedAt: bigint = process.hrtime.bigint(),
): TenderDetailTimingSummary | null {
  const state = timings.get(request);
  if (state === undefined) return null;
  timings.delete(request);
  const durationMs = elapsedMs(state.startedAt, endedAt);
  const stagesMs = Object.fromEntries(state.stages) as Partial<
    Record<TenderDetailStage, number>
  >;
  if (state.handlerDoneAt !== undefined && state.onSendAt !== undefined)
    stagesMs.post_handler_pre_send = elapsedMs(
      state.handlerDoneAt,
      state.onSendAt,
    );
  if (state.onSendAt !== undefined)
    stagesMs.send_to_response = elapsedMs(state.onSendAt, endedAt);
  const measuredMs = Object.values(stagesMs).reduce(
    (sum, value) => sum + value,
    0,
  );
  stagesMs.unattributed = Math.max(0, durationMs - measuredMs);
  return {
    durationMs: rounded(durationMs),
    stagesMs: Object.fromEntries(
      Object.entries(stagesMs).map(([stage, value]) => [stage, rounded(value)]),
    ),
  };
}
