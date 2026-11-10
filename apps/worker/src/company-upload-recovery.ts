import type { Queue } from "bullmq";
import type { PrismaClient } from "@tender/database";

const BATCH_SIZE = 100;

/** Requeue committed uploads left without a scan job by an API crash or queue outage. */
export async function recoverCompanyUploads(
  database: PrismaClient,
  queue: Queue,
  afterId?: string,
): Promise<string | undefined> {
  const sessions = await database.uploadSession.findMany({
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
    select: {
      id: true,
      organisationId: true,
      documentVersionId: true,
      documentVersion: {
        select: {
          versionNumber: true,
          extraction: { select: { status: true } },
          document: {
            select: {
              versions: {
                where: { approvedObjectKey: { not: null } },
                orderBy: { versionNumber: "desc" },
                select: { versionNumber: true },
                take: 1,
              },
            },
          },
        },
      },
    },
    where: {
      status: "COMPLETED",
      documentVersion: {
        approvedObjectKey: null,
        document: { deletedAt: null },
      },
      ...(afterId ? { id: { gt: afterId } } : {}),
    },
  });
  for (const session of sessions) {
    if (
      ["REJECTED", "FAILED"].includes(
        session.documentVersion.extraction?.status ?? "",
      )
    )
      continue;
    if (
      (session.documentVersion.document.versions[0]?.versionNumber ?? 0) >
      session.documentVersion.versionNumber
    )
      continue;
    // BullMQ's stable job ID deduplicates concurrent API retries and sweeps.
    await queue.add(
      "process-company-document",
      {
        documentVersionId: session.documentVersionId,
        organisationId: session.organisationId,
        requestId: `recovery-${session.id}`,
      },
      { attempts: 3, jobId: session.documentVersionId, removeOnComplete: 100 },
    );
  }
  return sessions.length === BATCH_SIZE ? sessions.at(-1)?.id : undefined;
}

export class CompanyUploadRecovery {
  private cursor: string | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  public constructor(
    private readonly database: PrismaClient,
    private readonly queue: Queue,
    private readonly onError: (error: unknown) => void,
  ) {}

  public run(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        this.cursor = await recoverCompanyUploads(
          this.database,
          this.queue,
          this.cursor,
        );
      } catch (error: unknown) {
        this.onError(error);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    await this.running;
  }
}
