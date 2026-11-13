export type ShutdownStage =
  | "RECOVERY_DRAIN"
  | "BULLMQ_WORKER_CLOSE"
  | "QUEUE_CLOSE"
  | "SERVER_CLOSE"
  | "REDIS_SHUTDOWN"
  | "PRISMA_SHUTDOWN";

export type ShutdownEvent =
  | {
      stage: "SHUTDOWN";
      event: "requested" | "completed" | "failed";
      durationMs: number;
    }
  | {
      stage: ShutdownStage;
      event: "started" | "completed" | "failed";
      durationMs: number;
      reason?: "timeout" | "rejected";
    };

export interface ShutdownDependencies {
  readonly stopScheduling: () => void;
  readonly recovery: () => Promise<unknown>;
  readonly worker: () => Promise<unknown>;
  readonly queues: () => Promise<unknown>;
  readonly servers: () => Promise<unknown>;
  readonly redis: () => Promise<unknown>;
  readonly database: () => Promise<unknown>;
}

const STAGE_TIMEOUT_MS: Readonly<Record<ShutdownStage, number>> = {
  RECOVERY_DRAIN: 15_000,
  BULLMQ_WORKER_CLOSE: 60_000,
  QUEUE_CLOSE: 10_000,
  SERVER_CLOSE: 10_000,
  REDIS_SHUTDOWN: 10_000,
  PRISMA_SHUTDOWN: 10_000,
};

/** A deadline reports a stuck operation; it never abandons work or closes its dependencies. */
export class WorkerShutdown {
  private running: Promise<boolean> | undefined;

  public constructor(
    private readonly dependencies: ShutdownDependencies,
    private readonly report: (event: ShutdownEvent) => void,
    private readonly timeouts = STAGE_TIMEOUT_MS,
  ) {}

  public run(): Promise<boolean> {
    if (this.running) return this.running;
    const started = Date.now();
    this.running = this.execute(started);
    return this.running;
  }

  private async execute(started: number): Promise<boolean> {
    this.report({ stage: "SHUTDOWN", event: "requested", durationMs: 0 });
    try {
      this.dependencies.stopScheduling();
      const stages: readonly [ShutdownStage, () => Promise<unknown>][] = [
        ["RECOVERY_DRAIN", this.dependencies.recovery],
        ["BULLMQ_WORKER_CLOSE", this.dependencies.worker],
        ["QUEUE_CLOSE", this.dependencies.queues],
        ["SERVER_CLOSE", this.dependencies.servers],
        ["REDIS_SHUTDOWN", this.dependencies.redis],
        ["PRISMA_SHUTDOWN", this.dependencies.database],
      ];
      let timedOut = false;
      for (const [stage, operation] of stages) {
        const stageStarted = Date.now();
        this.report({ stage, event: "started", durationMs: 0 });
        let timeout: NodeJS.Timeout | undefined;
        let exceeded = false;
        try {
          timeout = setTimeout(() => {
            exceeded = true;
            timedOut = true;
            this.report({
              stage,
              event: "failed",
              durationMs: Date.now() - stageStarted,
              reason: "timeout",
            });
          }, this.timeouts[stage]);
          await operation();
          this.report({
            stage,
            event: "completed",
            durationMs: Date.now() - stageStarted,
          });
        } catch {
          if (!exceeded) {
            this.report({
              stage,
              event: "failed",
              durationMs: Date.now() - stageStarted,
              reason: "rejected",
            });
          }
          this.report({
            stage: "SHUTDOWN",
            event: "failed",
            durationMs: Date.now() - started,
          });
          return false;
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      }
      this.report({
        stage: "SHUTDOWN",
        event: timedOut ? "failed" : "completed",
        durationMs: Date.now() - started,
      });
      return !timedOut;
    } catch {
      this.report({
        stage: "SHUTDOWN",
        event: "failed",
        durationMs: Date.now() - started,
      });
      return false;
    }
  }
}
