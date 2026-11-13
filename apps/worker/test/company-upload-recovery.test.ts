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

  it("cannot finish stopping while a database discovery call remains unresolved", async () => {
    let release: (() => void) | undefined;
    const discovery = new Promise<unknown[]>((resolve) => {
      release = () => resolve([]);
    });
    const database = {
      uploadSession: { findMany: vi.fn().mockReturnValue(discovery) },
    };
    const queue = { add: vi.fn() };
    const recovery = new CompanyUploadRecovery(
      database as never,
      queue as never,
      vi.fn(),
    );
    void recovery.run();
    const stop = recovery.stop();
    const outcome = await Promise.race([
      stop.then(() => "stopped"),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("still-waiting"), 15),
      ),
    ]);
    expect(outcome).toBe("still-waiting");
    expect(queue.add).not.toHaveBeenCalled();
    release?.();
    await expect(stop).resolves.toBeUndefined();
  });

  it("waits for a delayed queue insertion before closing its dependencies", async () => {
    let release: (() => void) | undefined;
    const insertion = new Promise<void>((resolve) => {
      release = resolve;
    });
    const database = {
      uploadSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "synthetic-session",
            organisationId: "synthetic-organisation",
            documentVersionId: "synthetic-version",
            documentVersion: { versionNumber: 1, document: { versions: [] } },
          },
        ]),
      },
    };
    const queue = { add: vi.fn().mockReturnValue(insertion) };
    const recovery = new CompanyUploadRecovery(
      database as never,
      queue as never,
      vi.fn(),
    );
    void recovery.run();
    await Promise.resolve();
    expect(queue.add).toHaveBeenCalledOnce();
    const stop = recovery.stop();
    const outcome = await Promise.race([
      stop.then(() => "stopped"),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("still-waiting"), 15),
      ),
    ]);
    expect(outcome).toBe("still-waiting");
    release?.();
    await expect(stop).resolves.toBeUndefined();
    expect(queue.add).toHaveBeenCalledOnce();
  });

  it("does not queue discovered uploads after shutdown begins; a restarted sweep can recover them", async () => {
    let release: (() => void) | undefined;
    const discovery = new Promise<unknown[]>((resolve) => {
      release = () =>
        resolve([
          {
            id: "synthetic-session",
            organisationId: "synthetic-organisation",
            documentVersionId: "synthetic-version",
            documentVersion: { versionNumber: 1, document: { versions: [] } },
          },
        ]);
    });
    const database = {
      uploadSession: { findMany: vi.fn().mockReturnValueOnce(discovery) },
    };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    const recovery = new CompanyUploadRecovery(
      database as never,
      queue as never,
      vi.fn(),
    );
    void recovery.run();
    const stopped = recovery.stop();
    release?.();
    await stopped;
    expect(queue.add).not.toHaveBeenCalled();

    database.uploadSession.findMany.mockResolvedValueOnce([
      {
        id: "synthetic-session",
        organisationId: "synthetic-organisation",
        documentVersionId: "synthetic-version",
        documentVersion: { versionNumber: 1, document: { versions: [] } },
      },
    ]);
    const restarted = new CompanyUploadRecovery(
      database as never,
      queue as never,
      vi.fn(),
    );
    await restarted.run();
    expect(queue.add).toHaveBeenCalledWith(
      "process-company-document",
      expect.objectContaining({ documentVersionId: "synthetic-version" }),
      expect.objectContaining({ jobId: "synthetic-version" }),
    );
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

  it("reconciles an ambiguous queue acknowledgement using the same stable job ID", async () => {
    const session = {
      id: "synthetic-session",
      organisationId: "synthetic-organisation",
      documentVersionId: "synthetic-version",
      documentVersion: {
        versionNumber: 1,
        extraction: null,
        document: { versions: [] },
      },
    };
    const database = {
      uploadSession: { findMany: vi.fn().mockResolvedValue([session]) },
    };
    const retainedJobs = new Set<string>();
    const queue = {
      add: vi
        .fn()
        .mockImplementation(
          (_name: string, _data: unknown, options: { jobId: string }) => {
            retainedJobs.add(options.jobId);
            if (queue.add.mock.calls.length === 1) {
              return Promise.reject(new Error("acknowledgement lost"));
            }
            return Promise.resolve();
          },
        ),
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
    expect(queue.add).toHaveBeenCalledTimes(2);
    for (const callNumber of [1, 2]) {
      expect(queue.add).toHaveBeenNthCalledWith(
        callNumber,
        "process-company-document",
        expect.objectContaining({ documentVersionId: "synthetic-version" }),
        expect.objectContaining({ jobId: "synthetic-version" }),
      );
    }
    expect(retainedJobs.size).toBe(1);

    // A completed-and-removed BullMQ job cannot be deduplicated by ID alone.
    // The authoritative approved version removes it from recovery discovery.
    database.uploadSession.findMany.mockResolvedValue([]);
    retainedJobs.clear();
    await recovery.run();
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it("skips the Redis acknowledgement barrier when no insertion was attempted", async () => {
    const recovery = new CompanyUploadRecovery(
      { uploadSession: { findMany: vi.fn().mockResolvedValue([]) } } as never,
      { add: vi.fn() } as never,
      vi.fn(),
    );
    await recovery.run();
    const confirm = vi.fn().mockRejectedValue(new Error("Redis unavailable"));
    await expect(
      recovery.stopAndConfirmInsertions(confirm),
    ).resolves.toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("skips the Redis acknowledgement barrier after a successful insertion", async () => {
    const recovery = new CompanyUploadRecovery(
      {
        uploadSession: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "synthetic-session",
              organisationId: "synthetic-organisation",
              documentVersionId: "synthetic-version",
              documentVersion: { versionNumber: 1, document: { versions: [] } },
            },
          ]),
        },
      } as never,
      { add: vi.fn().mockResolvedValue(undefined) } as never,
      vi.fn(),
    );
    await recovery.run();
    const confirm = vi.fn();
    await recovery.stopAndConfirmInsertions(confirm);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("requires a successful barrier after an ambiguous insertion failure", async () => {
    const recovery = new CompanyUploadRecovery(
      {
        uploadSession: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "synthetic-session",
              organisationId: "synthetic-organisation",
              documentVersionId: "synthetic-version",
              documentVersion: { versionNumber: 1, document: { versions: [] } },
            },
          ]),
        },
      } as never,
      {
        add: vi.fn().mockRejectedValue(new Error("acknowledgement lost")),
      } as never,
      vi.fn(),
    );
    await recovery.run();
    const confirm = vi.fn().mockRejectedValue(new Error("Redis unavailable"));
    await expect(recovery.stopAndConfirmInsertions(confirm)).rejects.toThrow();
    expect(confirm).toHaveBeenCalledOnce();
  });
});
