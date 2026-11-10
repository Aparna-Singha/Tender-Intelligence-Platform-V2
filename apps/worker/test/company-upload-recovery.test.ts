import { describe, expect, it, vi } from "vitest";
import {
  CompanyUploadRecovery,
  recoverCompanyUploads,
} from "../src/company-upload-recovery.js";

describe("committed company upload recovery", () => {
  it("queues only completed UPLOADED sessions with the stable version job ID", async () => {
    const database = {
      uploadSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "session-a",
            organisationId: "org-a",
            documentVersionId: "version-a",
            documentVersion: { versionNumber: 1, document: { versions: [] } },
          },
        ]),
      },
    };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    await expect(
      recoverCompanyUploads(database as never, queue as never),
    ).resolves.toBeUndefined();
    expect(database.uploadSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "COMPLETED",
          documentVersion: {
            approvedObjectKey: null,
            document: { deletedAt: null },
          },
        },
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      "process-company-document",
      expect.objectContaining({ documentVersionId: "version-a" }),
      expect.objectContaining({ jobId: "version-a", attempts: 3 }),
    );
  });

  it("propagates a queue outage so the next sweep can retry", async () => {
    const database = {
      uploadSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "session-a",
            organisationId: "org-a",
            documentVersionId: "version-a",
            documentVersion: { versionNumber: 1, document: { versions: [] } },
          },
        ]),
      },
    };
    const queue = {
      add: vi.fn().mockRejectedValue(new Error("queue unavailable")),
    };
    await expect(
      recoverCompanyUploads(database as never, queue as never),
    ).rejects.toThrow("queue unavailable");
    expect(database.uploadSession.findMany).toHaveBeenCalledOnce();
  });

  it("requeues V1 while V2 exists but has not passed scanning", async () => {
    const database = {
      uploadSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "old-session",
            organisationId: "org-a",
            documentVersionId: "version-1",
            documentVersion: { versionNumber: 1, document: { versions: [] } },
          },
        ]),
      },
    };
    const queue = { add: vi.fn() };
    await recoverCompanyUploads(database as never, queue as never);
    expect(queue.add).toHaveBeenCalledWith(
      "process-company-document",
      expect.objectContaining({ documentVersionId: "version-1" }),
      expect.objectContaining({ jobId: "version-1" }),
    );
  });

  it("does not requeue V1 after a higher version is approved", async () => {
    const database = {
      uploadSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "old-session",
            organisationId: "org-a",
            documentVersionId: "version-1",
            documentVersion: {
              versionNumber: 1,
              document: { versions: [{ versionNumber: 2 }] },
            },
          },
        ]),
      },
    };
    const queue = { add: vi.fn() };
    await recoverCompanyUploads(database as never, queue as never);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("ignores a terminally rejected version while scanning completed versions regardless of document status", async () => {
    const database = {
      uploadSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "session-a",
            organisationId: "org-a",
            documentVersionId: "version-a",
            documentVersion: {
              versionNumber: 1,
              extraction: { status: "REJECTED" },
              document: { versions: [] },
            },
          },
        ]),
      },
    };
    const queue = { add: vi.fn() };
    await recoverCompanyUploads(database as never, queue as never);
    expect(queue.add).not.toHaveBeenCalled();
    expect(database.uploadSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          documentVersion: {
            approvedObjectKey: null,
            document: { deletedAt: null },
          },
        }),
      }),
    );
  });

  it("does not overlap passes and waits for the active pass before stopping", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const database = {
      uploadSession: {
        findMany: vi.fn().mockImplementation(() => waiting.then(() => [])),
      },
    };
    const recovery = new CompanyUploadRecovery(
      database as never,
      { add: vi.fn() } as never,
      vi.fn(),
    );
    const first = recovery.run();
    const second = recovery.run();
    expect(second).toBe(first);
    const stopped = recovery.stop();
    let finished = false;
    void stopped.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    release?.();
    await stopped;
    await recovery.run();
    expect(database.uploadSession.findMany).toHaveBeenCalledOnce();
  });

  it("retries a failed sweep on the next call", async () => {
    const database = {
      uploadSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "session-a",
            organisationId: "org-a",
            documentVersionId: "version-a",
            documentVersion: {
              versionNumber: 1,
              extraction: null,
              document: { versions: [] },
            },
          },
        ]),
      },
    };
    const queue = {
      add: vi
        .fn()
        .mockRejectedValueOnce(new Error("queue unavailable"))
        .mockResolvedValue(undefined),
    };
    const onError = vi.fn();
    const recovery = new CompanyUploadRecovery(
      database as never,
      queue as never,
      onError,
    );
    await recovery.run();
    await recovery.run();
    expect(onError).toHaveBeenCalledOnce();
    expect(database.uploadSession.findMany).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});
