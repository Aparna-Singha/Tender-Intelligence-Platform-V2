import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export interface WorkflowConsumerControl {
  pause(): Promise<void>;
  resume(): void;
}

export interface MaintenanceStatus {
  admissionClosed: boolean;
  consumerPaused: boolean;
  transitioning: boolean;
  activeAcceptedRequests: number | null;
}

@Injectable()
export class MaintenanceService {
  private enabled = false;
  private transitioning = false;
  private consumerPaused = false;
  private consumer: WorkflowConsumerControl | null = null;
  private activeApplicationCount: (() => number) | null = null;

  public registerConsumer(consumer: WorkflowConsumerControl): void {
    this.consumer = consumer;
  }

  public registerDrainCounter(counter: () => number): void {
    this.activeApplicationCount = counter;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public status(): MaintenanceStatus {
    return {
      admissionClosed: this.enabled,
      consumerPaused: this.consumerPaused,
      transitioning: this.transitioning,
      activeAcceptedRequests: this.activeApplicationCount?.() ?? null,
    };
  }

  public async setEnabled(enabled: boolean): Promise<void> {
    if (this.transitioning)
      throw new ServiceUnavailableException(
        "Maintenance transition in progress",
      );
    if (this.enabled === enabled) {
      if (enabled && !this.consumerPaused)
        throw new ServiceUnavailableException("Workflow suspension unverified");
      return;
    }
    if (this.consumer === null || this.activeApplicationCount === null)
      throw new ServiceUnavailableException("Maintenance drain unavailable");
    this.transitioning = true;
    let pauseAttempted = false;
    if (enabled) this.enabled = true;
    try {
      if (enabled) {
        await this.waitForApplicationDrain();
        pauseAttempted = true;
        await this.pauseConsumerWithDeadline();
        this.consumerPaused = true;
      } else {
        if (!this.consumerPaused)
          throw new ServiceUnavailableException(
            "Workflow suspension unverified",
          );
        this.consumer.resume();
        this.consumerPaused = false;
      }
      this.enabled = enabled;
    } catch {
      // Drain failure is reversible before pausing begins. Once pausing has
      // started, its eventual outcome is unknown, so admission stays closed.
      this.enabled = enabled && !pauseAttempted ? false : true;
      throw new ServiceUnavailableException("Maintenance transition failed");
    } finally {
      this.transitioning = false;
    }
  }

  private async pauseConsumerWithDeadline(): Promise<void> {
    const pause = this.consumer!.pause();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pause,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("consumer_pause_timeout")),
            120_000,
          );
        }),
      ]);
    } catch {
      // BullMQ pause cannot be cancelled. If it settles after the deadline,
      // mark it paused so the operator can safely reverse maintenance.
      void pause.then(
        () => {
          this.consumerPaused = true;
        },
        () => undefined,
      );
      throw new ServiceUnavailableException("Workflow suspension unavailable");
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async waitForApplicationDrain(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (this.activeApplicationCount!() > 0) {
      if (Date.now() >= deadline)
        throw new ServiceUnavailableException("Application drain timed out");
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
}
