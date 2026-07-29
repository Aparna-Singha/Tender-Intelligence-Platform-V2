import {
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RagService } from "../src/rag/rag.service.js";

const environment = {
  RAG_CHAT_MODEL: "gemini-2.5-flash",
  RAG_EMBEDDING_MODEL: "gemini-embedding-001",
  RAG_PROVIDER: "gemini",
};

describe("Phase 9 tenant and prerequisite boundaries", () => {
  it("does not reveal another organisation's answer", async () => {
    const database = {
      ragAnswerRun: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new RagService(
      database as never,
      {} as never,
      environment as never,
    );
    await expect(
      service.answerRun("organisation-b", "tender-a", "answer-a"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.ragAnswerRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "answer-a",
          organisationId: "organisation-b",
          tenderId: "tender-a",
        },
      }),
    );
  });

  it("does not queue an index without a current completed extraction", async () => {
    const database = {
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          activeEarlyRiskRun: null,
          activeEligibilityAssessmentRun: null,
          activeExtractionRun: null,
        }),
      },
    };
    const jobs = { add: vi.fn() };
    const service = new RagService(
      database as never,
      jobs as never,
      environment as never,
    );
    await expect(
      service.startIndex(
        "organisation",
        "tender",
        "version",
        "TENDER_ONLY",
        "idempotency",
        "user",
        "request",
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(jobs.add).not.toHaveBeenCalled();
  });
});
