import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiGateway, ProviderUnavailableError } from "../src/ai-provider.js";

afterEach(() => vi.unstubAllGlobals());

describe("Gemini provider adapter", () => {
  it("fails clearly without a provider key", async () => {
    const gateway = new GeminiGateway(
      undefined,
      "gemini-2.5-flash",
      "gemini-embedding-001",
    );
    await expect(
      gateway.embedDocuments(["evidence"], new AbortController().signal),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
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
    ).rejects.toThrow("EMBEDDING_DIMENSION_MISMATCH");
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
    ).rejects.toThrow("INVALID_PROVIDER_RESPONSE");
  });
});
