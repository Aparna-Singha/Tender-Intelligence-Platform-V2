import { describe, expect, it, vi } from "vitest";
import { ProviderResponseError } from "../src/ai-provider.js";
import {
  createProviderFallbackAnswer,
  RagProcessor,
} from "../src/rag-processor.js";

describe("RAG answer persistence after citation verification", () => {
  it("returns cited tender evidence when the answer provider is temporarily unavailable", () => {
    const result = createProviderFallbackAnswer(
      new ProviderResponseError("PROVIDER_DEPENDENCY_UNAVAILABLE"),
      [
        {
          handle: "C1",
          text: "Title: Overload relay and its accessories.",
        },
        {
          handle: "C2",
          text: "SUBMISSION_DEADLINE: 21-08-2026 09:00:00",
        },
      ],
    );

    expect(result).toMatchObject({
      outcome: "ANSWERED",
      citationClaims: [
        {
          evidence: "Title: Overload relay and its accessories.",
          handles: ["C1"],
        },
        {
          evidence: "SUBMISSION_DEADLINE: 21-08-2026 09:00:00",
          handles: ["C2"],
        },
      ],
    });
    expect(result?.answer).toContain("Overload relay and its accessories");
    expect(result?.answer).toContain("not an AI-generated answer");
  });

  it("does not mask cancellation or non-provider failures", () => {
    expect(
      createProviderFallbackAnswer(
        new ProviderResponseError("PROVIDER_REQUEST_ABORTED"),
        [{ handle: "C1", text: "Tender evidence" }],
      ),
    ).toBeNull();
    expect(
      createProviderFallbackAnswer(new Error("RAG_INDEX_CHANGED"), [
        { handle: "C1", text: "Tender evidence" },
      ]),
    ).toBeNull();
  });

  it.each([
    "PROVIDER_TIMEOUT",
    "PROVIDER_AUTH_FAILED",
    "PROVIDER_QUOTA_EXHAUSTED",
    "PROVIDER_SERVICE_UNAVAILABLE",
  ] as const)("labels %s fallback as retrieved excerpts", (code) => {
    const fallback = createProviderFallbackAnswer(
      new ProviderResponseError(code),
      [{ handle: "C1", text: "Required delivery within 30 days." }],
    );
    expect(fallback?.answer).toContain("not an AI-generated answer");
    expect(fallback?.citationClaims[0]?.handles).toEqual(["C1"]);
  });

  it("retries retrieval safely and saves the verified answer and citations", async () => {
    let status = "QUEUED";
    const run = {
      id: "answer",
      organisationId: "org",
      tenderId: "tender",
      tenderVersionId: "version",
      conversationId: "conversation",
      sourceMode: "TENDER_ONLY",
      indexRun: {
        status: "COMPLETE",
        invalidatedAt: null,
        tenderId: "tender",
        organisationId: "org",
        extractionRunId: "extraction",
      },
      questionMessage: { content: "Delivery?" },
    };
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          chunk_id: "chunk",
          content: "Deliver in 30 days.",
          content_checksum: "checksum",
          document_name: "Tender",
          page_number: 1,
          clause_label: "Delivery",
          source_class: "TENDER_METADATA",
          lexical_rank: 1n,
          vector_rank: 1n,
          fused_score: 1,
        },
      ]),
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(db)),
      ragAnswerRun: {
        findFirst: vi.fn(
          (query: { select?: unknown; where: { status?: string } }) =>
            Promise.resolve(
              query.select
                ? query.where.status === status
                  ? { id: run.id }
                  : null
                : { ...run, status },
            ),
        ),
        updateMany: vi.fn(({ data }: { data: { status: string } }) => {
          status = data.status;
          return Promise.resolve({ count: 1 });
        }),
        update: vi.fn(),
      },
      tenderVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ activeExtractionRunId: "extraction" }),
      },
      ragRetrievalRun: {
        upsert: vi.fn().mockResolvedValue({ id: "retrieval" }),
      },
      ragRetrievalHit: { deleteMany: vi.fn(), createMany: vi.fn() },
      ragMessage: {
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn().mockResolvedValue({ id: "message" }),
      },
      ragAnswerCitation: { create: vi.fn() },
      ragConversation: { update: vi.fn() },
    };
    const gateway = {
      embedQuery: vi.fn().mockResolvedValue([0]),
      answer: vi
        .fn()
        .mockRejectedValueOnce(new Error("PROVIDER_TIMEOUT"))
        .mockResolvedValue({
          outcome: "ANSWERED",
          answer: "Deliver in 30 days. [C1]",
          citationClaims: [
            {
              claim: "Deliver in 30 days.",
              evidence: "Deliver in 30 days.",
              handles: ["C1"],
            },
            {
              claim: "The delivery period is 30 days.",
              evidence: "Deliver in 30 days.",
              handles: ["C1"],
            },
          ],
        }),
    };
    const processor = new RagProcessor(
      db as never,
      gateway as never,
      gateway as never,
    );
    const job = {
      kind: "ANSWER" as const,
      answerRunId: "answer",
      organisationId: "org",
      requestId: "request",
    };
    await expect(
      processor.process(job, new AbortController().signal),
    ).rejects.toThrow("PROVIDER_TIMEOUT");
    await processor.process(job, new AbortController().signal);
    expect(db.ragRetrievalRun.upsert).toHaveBeenCalledTimes(2);
    const retrievalQuery = db.$queryRaw.mock.calls[0]?.[0] as {
      strings?: readonly string[];
    };
    expect(retrievalQuery.strings?.join(" ")).toContain(
      "source_class\"::text = 'TENDER_METADATA'",
    );
    expect(db.ragRetrievalHit.deleteMany).toHaveBeenCalledTimes(2);
    expect(db.ragMessage.create).toHaveBeenCalledTimes(1);
    expect(db.ragAnswerCitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageNumber: 1,
          clauseLabel: "Delivery",
          documentName: "Tender",
          handle: "C1",
        }),
      }),
    );
    expect(db.ragAnswerCitation.create).toHaveBeenCalledTimes(1);
    expect(db.ragAnswerRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETE",
          answerMessageId: "message",
        }),
      }),
    );
  });
});
