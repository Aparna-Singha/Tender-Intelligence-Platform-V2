import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { EligibilityService } from "../src/eligibility/eligibility.service.js";

function serviceFor(database: {
  $transaction: ReturnType<typeof vi.fn>;
}): EligibilityService {
  const transaction = { ...database, $queryRaw: vi.fn().mockResolvedValue([]) };
  database.$transaction = vi.fn(
    (callback: ((tx: unknown) => Promise<unknown>) | unknown[]) =>
      typeof callback === "function" ? callback(transaction) : [],
  );
  return new EligibilityService(database as never, {} as never);
}

const input = {
  rationale: "Reviewed against the cited tender and company evidence.",
};
const supportedAssessmentFixture = {
  assessmentRun: { invalidatedAt: null, status: "COMPLETE" },
  currentState: "MISSING",
  reviewState: "UNREVIEWED",
  updatedAt: new Date("2026-11-07T00:00:00Z"),
  evidenceLinks: [
    {
      linkType: "DIRECT_SUPPORT",
      evidenceCitation: {
        documentChecksum: "checksum",
        documentId: "document",
        documentVersionId: "version",
        evidenceFactVersionId: "fact-version",
        invalidatedAt: null,
        validationStatus: "VALID",
      },
      evidenceFactVersion: {
        id: "fact-version",
        documentVersionId: "version",
        reviewState: "ACCEPTED",
        validUntil: null as Date | null,
        evidenceFact: {
          currentVersionId: "fact-version",
          documentId: "document",
          invalidatedAt: null,
          document: {
            currentVersionId: "version",
            currentVersion: { sha256: "checksum" },
            deletedAt: null,
            expiryDate: null as Date | null,
            status: "READY",
          },
        },
      },
    },
  ],
  proposedState: "VERIFIED",
  tenderCitation: { validationStatus: "VALID" },
};
function supportedAssessment(): typeof supportedAssessmentFixture {
  return structuredClone(supportedAssessmentFixture);
}

describe("eligibility VERIFIED transition", () => {
  it.each([
    { action: "MARK_VERIFIED", proposedState: "MISSING" },
    { action: "ACCEPT_PROPOSAL", proposedState: "VERIFIED" },
    {
      action: "RESOLVE_CONFLICT",
      chosen_state: "VERIFIED",
      proposedState: "CONFLICT",
    },
  ] as const)("rejects unsupported $action", async (action) => {
    const database = {
      eligibilityAssessment: {
        findFirst: vi.fn().mockResolvedValue({
          assessmentRun: { invalidatedAt: null, status: "COMPLETE" },
          evidenceLinks: [],
          proposedState: action.proposedState,
          tenderCitation: { validationStatus: "VALID" },
        }),
      },
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const service = serviceFor(database);
    await expect(
      service.reviewAssessment(
        "org",
        "tender",
        "run",
        "assessment",
        { ...input, ...action } as never,
        "reviewer",
        "request",
        true,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it.each([
    { action: "MARK_VERIFIED", proposedState: "MISSING" },
    { action: "ACCEPT_PROPOSAL", proposedState: "VERIFIED" },
    {
      action: "RESOLVE_CONFLICT",
      chosen_state: "VERIFIED",
      proposedState: "CONFLICT",
    },
  ] as const)(
    "requires finalisation permission for $action",
    async (action) => {
      const database = {
        eligibilityAssessment: {
          findFirst: vi.fn().mockResolvedValue({
            assessmentRun: { invalidatedAt: null, status: "COMPLETE" },
            evidenceLinks: [],
            proposedState: action.proposedState,
            tenderCitation: { validationStatus: "VALID" },
          }),
        },
        $transaction: vi.fn(),
      };
      const service = serviceFor(database);
      await expect(
        service.reviewAssessment(
          "org",
          "tender",
          "run",
          "assessment",
          { ...input, ...action } as never,
          "reviewer",
          "request",
          false,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it.each([
    [
      "unaccepted fact",
      (item: ReturnType<typeof supportedAssessment>) => {
        item.evidenceLinks[0]!.evidenceFactVersion.reviewState = "REJECTED";
      },
    ],
    [
      "invalid citation",
      (item: ReturnType<typeof supportedAssessment>) => {
        item.evidenceLinks[0]!.evidenceCitation.validationStatus = "INVALID";
      },
    ],
    [
      "replaced version",
      (item: ReturnType<typeof supportedAssessment>) => {
        item.evidenceLinks[0]!.evidenceFactVersion.evidenceFact.document.currentVersionId =
          "replacement";
      },
    ],
    [
      "expired document",
      (item: ReturnType<typeof supportedAssessment>) => {
        item.evidenceLinks[0]!.evidenceFactVersion.evidenceFact.document.expiryDate =
          new Date("2020-01-01");
      },
    ],
    [
      "stale fact",
      (item: ReturnType<typeof supportedAssessment>) => {
        item.evidenceLinks[0]!.evidenceFactVersion.evidenceFact.currentVersionId =
          "new-fact-version";
      },
    ],
    [
      "expired fact",
      (item: ReturnType<typeof supportedAssessment>) => {
        item.evidenceLinks[0]!.evidenceFactVersion.validUntil = new Date(
          "2020-01-01",
        );
      },
    ],
    [
      "context-only link",
      (item: ReturnType<typeof supportedAssessment>) => {
        item.evidenceLinks[0]!.linkType = "CONTEXT_ONLY";
      },
    ],
  ] as const)("rejects %s as direct support", async (_name, change) => {
    const assessment = supportedAssessment();
    change(assessment);
    const database = {
      eligibilityAssessment: {
        findFirst: vi.fn().mockResolvedValue(assessment),
      },
      $transaction: vi.fn(),
    };
    await expect(
      serviceFor(database).reviewAssessment(
        "org",
        "tender",
        "run",
        "assessment",
        { ...input, action: "ACCEPT_PROPOSAL" },
        "reviewer",
        "request",
        true,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it.each([
    { action: "MARK_VERIFIED", proposedState: "MISSING" },
    { action: "ACCEPT_PROPOSAL", proposedState: "VERIFIED" },
    {
      action: "RESOLVE_CONFLICT",
      chosen_state: "VERIFIED",
      proposedState: "CONFLICT",
    },
  ] as const)("preserves a supported $action transition", async (action) => {
    const assessment = supportedAssessment();
    assessment.proposedState = action.proposedState;
    const database = {
      eligibilityAssessment: {
        findFirst: vi.fn().mockResolvedValue(assessment),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      eligibilityAssessmentReview: {
        aggregate: vi.fn().mockResolvedValue({ _max: { reviewVersion: 0 } }),
        create: vi.fn().mockResolvedValue({ id: "review" }),
      },
      auditEvent: { create: vi.fn() },
      checklistGenerationRun: { updateMany: vi.fn() },
      checklistItem: { updateMany: vi.fn() },
      $transaction: vi.fn(),
    };
    database.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        typeof callback === "function" ? callback(database) : [],
    );
    await expect(
      serviceFor(database).reviewAssessment(
        "org",
        "tender",
        "run",
        "assessment",
        { ...input, ...action } as never,
        "reviewer",
        "request",
        true,
      ),
    ).resolves.toEqual({ id: "review" });
    expect(database.eligibilityAssessment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentState: "VERIFIED",
          finalisedByUserId: "reviewer",
        }),
      }),
    );
  });

  it("rejects an assessment changed by another reviewer", async () => {
    const database = {
      eligibilityAssessment: {
        findFirst: vi.fn().mockResolvedValue(supportedAssessment()),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      eligibilityAssessmentReview: { create: vi.fn() },
      $transaction: vi.fn(),
    };
    database.$transaction.mockImplementation(
      (callback: ((tx: unknown) => Promise<unknown>) | unknown[]) =>
        typeof callback === "function" ? callback(database) : [],
    );
    await expect(
      serviceFor(database).reviewAssessment(
        "org",
        "tender",
        "run",
        "assessment",
        { ...input, action: "MARK_VERIFIED" },
        "reviewer",
        "request",
        true,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.eligibilityAssessmentReview.create).not.toHaveBeenCalled();
  });

  it("treats the document expiry date as valid through that calendar day", async () => {
    const assessment = supportedAssessment();
    assessment.evidenceLinks[0]!.evidenceFactVersion.evidenceFact.document.expiryDate =
      new Date("2026-11-07");
    const database = {
      eligibilityAssessment: {
        findFirst: vi.fn().mockResolvedValue(assessment),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      eligibilityAssessmentReview: {
        aggregate: vi.fn().mockResolvedValue({ _max: { reviewVersion: 0 } }),
        create: vi.fn().mockResolvedValue({ id: "review" }),
      },
      auditEvent: { create: vi.fn() },
      checklistGenerationRun: { updateMany: vi.fn() },
      checklistItem: { updateMany: vi.fn() },
      $transaction: vi.fn(),
    };
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-07T18:29:59.999Z"));
      await expect(
        serviceFor(database).reviewAssessment(
          "org",
          "tender",
          "run",
          "assessment",
          { ...input, action: "MARK_VERIFIED" },
          "reviewer",
          "request",
          true,
        ),
      ).resolves.toEqual({ id: "review" });
      vi.setSystemTime(new Date("2026-11-07T18:30:00Z"));
      await expect(
        serviceFor(database).reviewAssessment(
          "org",
          "tender",
          "run",
          "assessment",
          { ...input, action: "MARK_VERIFIED" },
          "reviewer",
          "request",
          true,
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks source readiness inside the review transaction", async () => {
    const assessment = supportedAssessment();
    const database = {
      eligibilityAssessment: {
        findFirst: vi
          .fn()
          .mockImplementation(() => Promise.resolve(assessment)),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      eligibilityAssessmentReview: {
        aggregate: vi.fn().mockResolvedValue({ _max: { reviewVersion: 0 } }),
        create: vi.fn().mockResolvedValue({ id: "review" }),
      },
      auditEvent: { create: vi.fn() },
      checklistGenerationRun: { updateMany: vi.fn() },
      checklistItem: { updateMany: vi.fn() },
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    database.$transaction.mockImplementation(
      (callback: ((tx: unknown) => Promise<unknown>) | unknown[]) => {
        if (typeof callback !== "function") return [];
        assessment.evidenceLinks[0]!.evidenceFactVersion.evidenceFact.document.status =
          "FAILED";
        return callback(database);
      },
    );
    await expect(
      new EligibilityService(database as never, {} as never).reviewAssessment(
        "org",
        "tender",
        "run",
        "assessment",
        { ...input, action: "MARK_VERIFIED" },
        "reviewer",
        "request",
        true,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(database.eligibilityAssessmentReview.create).not.toHaveBeenCalled();
  });

  it("rejects a missing or invalidated assessment before writing", async () => {
    const database = {
      eligibilityAssessment: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    await expect(
      serviceFor(database).reviewAssessment(
        "other-org",
        "other-tender",
        "run",
        "assessment",
        { ...input, action: "MARK_VERIFIED" },
        "reviewer",
        "request",
        true,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });
});
