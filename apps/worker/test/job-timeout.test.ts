import { describe, expect, it, vi } from "vitest";
import { runWithTimeout } from "../src/job-timeout.js";

describe("document job timeout", () => {
  it("aborts work when the configured deadline expires", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const result = runWithTimeout(1_000, (signal) => {
      receivedSignal = signal;
      return new Promise<void>(() => undefined);
    });
    const rejection = expect(result).rejects.toThrow("Document job timed out");
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(receivedSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
