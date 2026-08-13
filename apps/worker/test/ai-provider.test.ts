import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GeminiGateway,
  ProviderResponseError,
  ProviderUnavailableError,
} from "../src/ai-provider.js";

afterEach(() => vi.unstubAllGlobals());

describe("Gemini provider adapter", () => {
  it("fails clearly without a provider key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new GeminiGateway(
      undefined,
      "gemini-2.5-flash",
      "gemini-embedding-001",
    );
    await expect(
      gateway.embedDocuments(["evidence"], new AbortController().signal),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects embedding dimension mismatches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ embedding: { values: [0.1, 0.2] } }), {
          status: 200,
        }),
      ),
    );
    const gateway = new GeminiGateway(
      "safe-test-key-value",
      "gemini-2.5-flash",
      "gemini-embedding-001",
    );
    await expect(
      gateway.embedDocuments(["evidence"], new AbortController().signal),
    ).rejects.toMatchObject({
      code: "EMBEDDING_DIMENSION_MISMATCH",
    });
  });

  it("uses distinct embedding task types for documents and queries", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        () =>
          new Response(
            JSON.stringify({ embedding: { values: Array(768).fill(0.1) } }),
            { status: 200 },
          ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new GeminiGateway(
      "safe-test-key-value",
      "gemini-2.5-flash",
      "gemini-embedding-001",
    );

    await gateway.embedDocuments(["evidence"], new AbortController().signal);
    await gateway.embedQuery("question", new AbortController().signal);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"taskType":"RETRIEVAL_DOCUMENT"'),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"taskType":"RETRIEVAL_QUERY"'),
      }),
    );
  });

  it("rejects unknown or malformed structured output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: '{"answer":"unsafe"}' }] } },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const gateway = new GeminiGateway(
      "safe-test-key-value",
      "gemini-2.5-flash",
      "gemini-embedding-001",
    );
    await expect(
      gateway.answer(
        "Question",
        [{ handle: "C1", text: "Evidence" }],
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it("classifies rate limits without leaking provider bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("raw provider details", { status: 429 }),
        ),
    );
    const gateway = new GeminiGateway(
      "safe-test-key-value",
      "gemini-2.5-flash",
      "gemini-embedding-001",
    );

    await expect(
      gateway.embedQuery("question", new AbortController().signal),
    ).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
  });

  it("classifies provider 5xx as dependency unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("raw provider details", { status: 503 }),
        ),
    );
    const gateway = new GeminiGateway(
      "safe-test-key-value",
      "gemini-2.5-flash",
      "gemini-embedding-001",
    );

    await expect(
      gateway.embedQuery("question", new AbortController().signal),
    ).rejects.toMatchObject({ code: "PROVIDER_DEPENDENCY_UNAVAILABLE" });
  });

  it("classifies aborted provider requests safely", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")),
    );
    const gateway = new GeminiGateway(
      "safe-test-key-value",
      "gemini-2.5-flash",
      "gemini-embedding-001",
    );

    await expect(
      gateway.embedQuery("question", controller.signal),
    ).rejects.toMatchObject({ code: "PROVIDER_REQUEST_ABORTED" });
  });

  it("generates only structured source-constrained draft sections", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      claims: [
                        {
                          claim: "The tender requires ISO 9001.",
                          claim_class: "TENDER_SOURCE_STATEMENT",
                          handles: ["C1"],
                          material: true,
                        },
                      ],
                      content: "The tender requires ISO 9001. [C1]",
                      placeholders: [],
                      section_key: "technical",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new GeminiGateway(
      "safe-test-key-value",
      "gemini-2.5-flash",
      "gemini-embedding-001",
    );

    const generated = await gateway.generateDraftSection(
      {
        formattingGuidance: "Use concise prose.",
        heading: "Technical",
        instructions: null,
        sectionKey: "technical",
      },
      [
        {
          handle: "C1",
          sourceClass: "TENDER_SOURCE",
          text: "ISO 9001 is mandatory.",
        },
      ],
      new AbortController().signal,
    );

    expect(generated.claims[0]?.handles).toEqual(["C1"]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining(
          "Do not approve, export, submit, decide eligibility",
        ),
      }),
    );
  });
});
