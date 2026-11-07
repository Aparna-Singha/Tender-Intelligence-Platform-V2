import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createPrismaClient, Prisma } from "@tender/database";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EligibilityService } from "../src/eligibility/eligibility.service.js";

const url = process.env.BIDVEDA_ATTACHMENT_TEST_DATABASE_URL;
const isolated = (() => {
  if (!url) return false;
  const parsed = new URL(url);
  return (
    parsed.hostname === "127.0.0.1" &&
    parsed.port === "5432" &&
    /^\/bidveda_attachment_rehearsal_[0-9_]+$/.test(parsed.pathname)
  );
})();

describe.skipIf(!isolated)("eligibility review on isolated PostgreSQL", () => {
  it.each(["citation", "context", "run-invalidated", "unverified"] as const)(
    "projects %s from persisted source state without rewriting history",
    async (change) => {
      const db = createPrismaClient(url!);
      try {
        await expect(
          db.$transaction(
            async (tx) => {
              const item = await fixture(tx);
              const service = transactionalService(tx);
              if (change !== "unverified")
                await service.reviewAssessment(
                  item.organisationId,
                  item.tenderId,
                  item.assessmentRunId,
                  item.id,
                  {
                    action: "MARK_VERIFIED",
                    rationale:
                      "Synthetic cited source checked in isolated PostgreSQL.",
                  },
                  item.assessmentRun.requestedByUserId,
                  "synthetic-currentness",
                  true,
                );
              const reviewsBefore = await tx.eligibilityAssessmentReview.count({
                where: { assessmentId: item.id },
              });
              if (change === "citation")
                await tx.companyEvidenceCitation.update({
                  where: { id: item.evidenceLinks[0]!.evidenceCitationId! },
                  data: { validationStatus: "INVALID" },
                });
              if (change === "context")
                await tx.eligibilityAssessmentEvidenceLink.update({
                  where: { id: item.evidenceLinks[0]!.id },
                  data: { linkType: "CONTEXT_ONLY" },
                });
              if (change === "run-invalidated")
                await tx.eligibilityAssessmentRun.update({
                  where: { id: item.assessmentRunId },
                  data: { status: "INVALIDATED", invalidatedAt: new Date() },
                });
              const matrix = (await service.matrix(
                item.organisationId,
                item.tenderId,
                item.assessmentRunId,
                { limit: 100, offset: 0 } as never,
              )) as {
                items: {
                  id: string;
                  currentEvidence: {
                    status: string;
                    reasonCodes: string[];
                  } | null;
                }[];
              };
              const verdict = matrix.items.find(
                (candidate) => candidate.id === item.id,
              )?.currentEvidence;
              if (change === "unverified") expect(verdict).toBeNull();
              else {
                expect(verdict?.status).toBe("REASSESSMENT_REQUIRED");
                expect(verdict?.reasonCodes).toContain(
                  {
                    citation: "CITATION_INVALID",
                    context: "DIRECT_SUPPORT_MISSING",
                    "run-invalidated": "RUN_INVALIDATED",
                  }[change],
                );
              }
              expect(
                await tx.eligibilityAssessmentReview.count({
                  where: { assessmentId: item.id },
                }),
              ).toBe(reviewsBefore);
              throw new Error("ROLLBACK_SYNTHETIC_CURRENTNESS");
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
              timeout: 10_000,
            },
          ),
        ).rejects.toThrow("ROLLBACK_SYNTHETIC_CURRENTNESS");
      } finally {
        await db.$disconnect();
      }
    },
  );

  it("does not disclose a matrix across organisation or tender boundaries", async () => {
    const db = createPrismaClient(url!);
    try {
      const item = await db.eligibilityAssessment.findFirstOrThrow({
        where: {
          reviewState: "UNREVIEWED",
          evidenceLinks: { some: { linkType: "DIRECT_SUPPORT" } },
        },
      });
      const service = new EligibilityService(db, {} as never);
      await expect(
        service.matrix(randomUUID(), item.tenderId, item.assessmentRunId, {
          limit: 10,
          offset: 0,
        } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.matrix(
          item.organisationId,
          randomUUID(),
          item.assessmentRunId,
          { limit: 10, offset: 0 } as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      await db.$disconnect();
    }
  });
  it.each([
    "replaced",
    "removed",
    "failed",
    "expired",
    "fact-superseded",
  ] as const)(
    "preserves historical review but exposes the stale %s display gap",
    async (change) => {
      const db = createPrismaClient(url!);
      try {
        await expect(
          db.$transaction(
            async (tx) => {
              const item = await fixture(tx);
              const version = item.evidenceLinks[0]!.evidenceFactVersion!;
              const service = transactionalService(tx);
              await service.reviewAssessment(
                item.organisationId,
                item.tenderId,
                item.assessmentRunId,
                item.id,
                {
                  action: "MARK_VERIFIED",
                  rationale:
                    "Synthetic cited source checked in isolated PostgreSQL.",
                },
                item.assessmentRun.requestedByUserId,
                "synthetic-history",
                true,
              );
              const reviewCount = await tx.eligibilityAssessmentReview.count({
                where: { assessmentId: item.id },
              });
              if (change === "replaced")
                await tx.document.update({
                  where: { id: version.evidenceFact.documentId },
                  data: { currentVersionId: null },
                });
              if (change === "removed")
                await tx.document.update({
                  where: { id: version.evidenceFact.documentId },
                  data: { deletedAt: new Date() },
                });
              if (change === "failed")
                await tx.document.update({
                  where: { id: version.evidenceFact.documentId },
                  data: { status: "FAILED" },
                });
              if (change === "expired")
                await tx.document.update({
                  where: { id: version.evidenceFact.documentId },
                  data: { expiryDate: new Date("2020-01-01") },
                });
              if (change === "fact-superseded")
                await tx.companyEvidenceFact.update({
                  where: { id: version.evidenceFactId },
                  data: { currentVersionId: null },
                });
              const current = await tx.eligibilityAssessment.findUniqueOrThrow({
                where: { id: item.id },
              });
              expect(current.currentState).toBe("VERIFIED");
              expect(current.invalidatedAt).toBeNull();
              const matrix = (await service.matrix(
                item.organisationId,
                item.tenderId,
                item.assessmentRunId,
                { limit: 100, offset: 0 } as never,
              )) as {
                items: {
                  id: string;
                  currentEvidence: {
                    status: string;
                    reasonCodes: string[];
                  } | null;
                }[];
              };
              const verdict = matrix.items.find(
                (candidate) => candidate.id === item.id,
              )?.currentEvidence;
              expect(verdict?.status).toBe("REASSESSMENT_REQUIRED");
              expect(verdict?.reasonCodes).toContain(
                {
                  replaced: "DOCUMENT_REPLACED",
                  removed: "DOCUMENT_DELETED",
                  failed: "DOCUMENT_NOT_READY",
                  expired: "DOCUMENT_EXPIRED",
                  "fact-superseded": "FACT_NOT_CURRENT",
                }[change],
              );
              expect(
                await tx.eligibilityAssessmentReview.count({
                  where: { assessmentId: item.id },
                }),
              ).toBe(reviewCount);
              await expect(
                service.reviewAssessment(
                  item.organisationId,
                  item.tenderId,
                  item.assessmentRunId,
                  item.id,
                  {
                    action: "MARK_VERIFIED",
                    rationale: "Synthetic re-review after source change.",
                  },
                  item.assessmentRun.requestedByUserId,
                  "synthetic-stale-review",
                  true,
                ),
              ).rejects.toBeInstanceOf(UnprocessableEntityException);
              throw new Error("ROLLBACK_SYNTHETIC_HISTORY");
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
              timeout: 10_000,
            },
          ),
        ).rejects.toThrow("ROLLBACK_SYNTHETIC_HISTORY");
      } finally {
        await db.$disconnect();
      }
    },
  );
  it.each([
    "current",
    "failed",
    "replaced",
    "expired",
    "context",
    "foreign",
    "foreign-tender",
  ] as const)(
    "checks %s source in the same serializable review transaction",
    async (caseName) => {
      const db = createPrismaClient(url!);
      try {
        if (caseName === "current") {
          let reviewed = false;
          await expect(
            db.$transaction(
              async (tx) => {
                const item = await fixture(tx);
                const service = transactionalService(tx);
                await service.reviewAssessment(
                  item.organisationId,
                  item.tenderId,
                  item.assessmentRunId,
                  item.id,
                  {
                    action: "MARK_VERIFIED",
                    rationale:
                      "Synthetic cited source checked in isolated PostgreSQL.",
                  },
                  item.assessmentRun.requestedByUserId,
                  "synthetic-review",
                  true,
                );
                const matrix = (await service.matrix(
                  item.organisationId,
                  item.tenderId,
                  item.assessmentRunId,
                  { limit: 100, offset: 0 } as never,
                )) as {
                  items: {
                    id: string;
                    currentEvidence: {
                      status: string;
                      reasonCodes: string[];
                    } | null;
                  }[];
                };
                expect(
                  matrix.items.find((candidate) => candidate.id === item.id)
                    ?.currentEvidence,
                ).toMatchObject({ status: "CURRENT", reasonCodes: [] });
                reviewed = true;
                throw new Error("ROLLBACK_SYNTHETIC_REVIEW");
              },
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            ),
          ).rejects.toThrow("ROLLBACK_SYNTHETIC_REVIEW");
          expect(reviewed).toBe(true);
          return;
        }
        await expect(
          db.$transaction(
            async (tx) => {
              const item = await fixture(tx);
              const link = item.evidenceLinks[0]!;
              const version = link.evidenceFactVersion!;
              if (caseName === "failed")
                await tx.document.update({
                  where: { id: version.evidenceFact.documentId },
                  data: { status: "FAILED" },
                });
              if (caseName === "replaced")
                await tx.document.update({
                  where: { id: version.evidenceFact.documentId },
                  data: { currentVersionId: null },
                });
              if (caseName === "expired")
                await tx.document.update({
                  where: { id: version.evidenceFact.documentId },
                  data: { expiryDate: new Date("2020-01-01") },
                });
              if (caseName === "context")
                await tx.eligibilityAssessmentEvidenceLink.update({
                  where: { id: link.id },
                  data: { linkType: "CONTEXT_ONLY" },
                });
              const service = transactionalService(tx);
              await service.reviewAssessment(
                caseName === "foreign" ? randomUUID() : item.organisationId,
                caseName === "foreign-tender" ? randomUUID() : item.tenderId,
                item.assessmentRunId,
                item.id,
                {
                  action: "MARK_VERIFIED",
                  rationale:
                    "Synthetic cited source checked in isolated PostgreSQL.",
                },
                item.assessmentRun.requestedByUserId,
                "synthetic-review",
                true,
              );
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          ),
        ).rejects.toBeInstanceOf(
          caseName === "foreign" || caseName === "foreign-tender"
            ? ConflictException
            : UnprocessableEntityException,
        );
      } finally {
        await db.$disconnect();
      }
    },
  );

  it.each(["document", "assessment", "review"] as const)(
    "holds the %s source while finalising a review",
    async (target) => {
      const db = createPrismaClient(url!);
      const concurrent = createPrismaClient(url!);
      let reachedWrite!: () => void;
      let resumeWrite!: () => void;
      const writing = new Promise<void>((resolve) => {
        reachedWrite = resolve;
      });
      const resumed = new Promise<void>((resolve) => {
        resumeWrite = resolve;
      });
      let earlyError: unknown;
      try {
        const review = db
          .$transaction(
            async (tx) => {
              const item = await fixture(tx);
              const service = transactionalService(tx, async () => {
                reachedWrite();
                await resumed;
              });
              try {
                await service.reviewAssessment(
                  item.organisationId,
                  item.tenderId,
                  item.assessmentRunId,
                  item.id,
                  {
                    action: "MARK_VERIFIED",
                    rationale:
                      "Synthetic cited source checked in isolated PostgreSQL.",
                  },
                  item.assessmentRun.requestedByUserId,
                  "synthetic-concurrent-review",
                  true,
                );
                throw new Error("ROLLBACK_SYNTHETIC_REVIEW");
              } finally {
                resumeWrite();
              }
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
              timeout: 10_000,
            },
          )
          .catch((error: unknown) => {
            earlyError = error;
            reachedWrite();
            return error;
          });
        await writing;
        if (earlyError)
          throw new Error("Review failed before lock barrier", {
            cause: earlyError,
          });
        const item = await concurrent.eligibilityAssessment.findFirstOrThrow({
          include: {
            assessmentRun: true,
            evidenceLinks: {
              include: {
                evidenceFactVersion: { include: { evidenceFact: true } },
              },
            },
          },
          where: {
            evidenceLinks: { some: { linkType: "DIRECT_SUPPORT" } },
            reviewState: "UNREVIEWED",
          },
        });
        const priorReviews = await concurrent.eligibilityAssessmentReview.count(
          {
            where: { assessmentId: item.id },
          },
        );
        await expect(
          concurrent.$transaction(async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
            if (target === "document") {
              const id =
                item.evidenceLinks[0]!.evidenceFactVersion!.evidenceFact
                  .documentId;
              await tx.$executeRaw`UPDATE documents SET status = status WHERE id = ${id}::uuid`;
            } else if (target === "assessment") {
              await tx.eligibilityAssessment.updateMany({
                where: { id: item.id },
                data: { currentState: item.currentState },
              });
            } else {
              const service = transactionalService(tx);
              await service.reviewAssessment(
                item.organisationId,
                item.tenderId,
                item.assessmentRunId,
                item.id,
                {
                  action: "MARK_VERIFIED",
                  rationale:
                    "Synthetic concurrent reviewer with cited evidence.",
                },
                item.assessmentRun.requestedByUserId,
                "synthetic-other-review",
                true,
              );
            }
          }),
        ).rejects.toThrow();
        resumeWrite();
        await expect(review).resolves.toMatchObject({
          message: "ROLLBACK_SYNTHETIC_REVIEW",
        });
        expect(
          await concurrent.eligibilityAssessmentReview.count({
            where: { assessmentId: item.id },
          }),
        ).toBe(priorReviews);
      } finally {
        resumeWrite?.();
        await db.$disconnect();
        await concurrent.$disconnect();
      }
    },
    20_000,
  );
});

type Transaction = Prisma.TransactionClient;
type AssessmentFixture = Prisma.EligibilityAssessmentGetPayload<{
  include: {
    assessmentRun: true;
    evidenceLinks: {
      include: { evidenceFactVersion: { include: { evidenceFact: true } } };
    };
  };
}>;
async function fixture(tx: Transaction): Promise<AssessmentFixture> {
  const item = await tx.eligibilityAssessment.findFirst({
    include: {
      assessmentRun: true,
      evidenceLinks: {
        include: { evidenceFactVersion: { include: { evidenceFact: true } } },
      },
    },
    where: {
      assessmentRun: { status: "COMPLETE", invalidatedAt: null },
      evidenceLinks: { some: { linkType: "DIRECT_SUPPORT" } },
      reviewState: "UNREVIEWED",
    },
  });
  expect(item).not.toBeNull();
  return item!;
}

function transactionalService(
  tx: Transaction,
  beforeReviewWrite?: () => Promise<void>,
): EligibilityService {
  const client = new Proxy(tx, {
    get(target, property, receiver): unknown {
      if (property === "$transaction")
        return async (
          action:
            ((inner: Transaction) => Promise<unknown>) | Promise<unknown>[],
        ) => {
          if (typeof action === "function") return action(client);
          const results: unknown[] = [];
          for (const query of action) results.push(await query);
          return results;
        };
      if (property === "eligibilityAssessment" && beforeReviewWrite)
        return new Proxy(tx.eligibilityAssessment, {
          get(delegate, method): unknown {
            if (method === "updateMany")
              return async (
                args: Parameters<typeof delegate.updateMany>[0],
              ) => {
                await beforeReviewWrite();
                return delegate.updateMany(args);
              };
            return Reflect.get(delegate, method) as unknown;
          },
        });
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return new EligibilityService(client as never, {} as never);
}
