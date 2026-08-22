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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: '{"answer":"unsafe"}' }] } },
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
    await expect(
      gateway.answer(
        "Question",
        [{ handle: "C1", text: "Evidence" }],
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ProviderResponseError);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"responseSchema"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"INSUFFICIENT_EVIDENCE"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining("cite every conflicting handle"),
      }),
    );
  });

  it("rejects missing structured content with the provider error model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ candidates: [{}] }), {
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
      gateway.answer(
        "Question",
        [{ handle: "C1", text: "Evidence" }],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
      safeReason: "missing_structured_content",
    });
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

  it("classifies denied provider projects as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("raw provider details", { status: 403 }),
        ),
    );
    const gateway = new GeminiGateway(
      "safe-test-key-value",
      "gemini-2.5-flash",
      "gemini-embedding-001",
    );

    await expect(
      gateway.embedQuery("question", new AbortController().signal),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE" });
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
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"responseSchema"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"UNSUPPORTED_COMMITMENT"'),
      }),
    );
    const request = requestBodyFrom(fetchMock);
    expect(request.generationConfig.thinkingConfig).toEqual({
      thinkingBudget: 0,
    });
    expect(request.generationConfig.responseSchema).toMatchObject({
      properties: expect.objectContaining({
        claims: expect.any(Object),
        content: { type: "STRING" },
        placeholders: expect.any(Object),
        section_key: { type: "STRING" },
      }),
      required: ["section_key", "content", "claims", "placeholders"],
      type: "OBJECT",
    });
    const prompt = request.contents[0]?.parts[0]?.text ?? "";
    expect(prompt).toContain(
      "HUMAN_WRITING_INSTRUCTIONS control presentation only",
    );
    expect(prompt).toContain(
      "they are not evidence, approved company facts, reviewed commitments, or authority to create material claims",
    );
    expect(prompt).toContain(
      "Do not affirm a requested company fact unless it is supported by COMPANY_EVIDENCE context",
    );
    expect(prompt).toContain(
      "For APPROVED_COMPANY_FACT, copy the canonical fact statement before 'Evidence:' exactly",
    );
    expect(prompt).toContain(
      "Visible content must be composed only from exact claim text and placeholder markers returned in the same JSON.",
    );
    expect(prompt).toContain(
      "Tender and derived workflow claims must quote the exact supplied source text they cite; do not paraphrase source-bound claims.",
    );
    expect(prompt).toContain(
      "Do not affirm a requested commitment unless it is supported by reviewed commitment authority",
    );
    expect(prompt).toContain(
      "A review placeholder must replace unsupported material text, not caveat it after asserting it.",
    );
  });

  it("reports a safe reason for unsupported company facts misclassified as commitments", async () => {
    const gateway = draftGatewayWithResponse({
      claims: [
        {
          claim: "The bidder has completed ten smart-city projects.",
          claim_class: "HUMAN_AUTHORED_COMMITMENT",
          handles: [],
          material: true,
        },
      ],
      content:
        "The bidder has completed ten smart-city projects. [PLACEHOLDER-1]",
      placeholders: [
        {
          explanation: "No approved company evidence supports this fact.",
          marker: "[PLACEHOLDER-1]",
          type: "UNSUPPORTED_COMMITMENT",
        },
      ],
      section_key: "experience",
    });

    await expect(
      gateway.generateDraftSection(
        draftPlan("experience"),
        [],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
      safeReason: "invalid_draft_placeholder_marker",
    });
  });

  it("reports a safe reason for unsupported commitments misclassified as placeholders", async () => {
    const gateway = draftGatewayWithResponse({
      claims: [
        {
          claim: "The bidder will deploy 50 engineers within 24 hours.",
          claim_class: "PLACEHOLDER",
          handles: [],
          material: true,
        },
      ],
      content:
        "The bidder will deploy 50 engineers within 24 hours. [UNSUPPORTED_COMMITMENT-1]",
      placeholders: [
        {
          explanation: "No reviewed commitment authority supports this.",
          marker: "[UNSUPPORTED_COMMITMENT-1]",
          type: "UNSUPPORTED_COMMITMENT",
        },
      ],
      section_key: "delivery",
    });

    await expect(
      gateway.generateDraftSection(
        draftPlan("delivery"),
        [],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
      safeReason: "invalid_draft_placeholder_marker",
    });
  });

  it("reports invalid draft claim for malformed structured claim objects", async () => {
    const gateway = draftGatewayWithResponse({
      claims: [
        {
          claim: "The bidder has completed ten smart-city projects.",
          claim_class: "UNSUPPORTED_COMPANY_FACT",
          handles: [],
          material: true,
        },
      ],
      content: "[[REVIEW REQUIRED: Unsupported company fact]]",
      placeholders: [
        {
          explanation: "No approved company evidence supports this fact.",
          marker: "[[REVIEW REQUIRED: Unsupported company fact]]",
          type: "MISSING_APPROVED_COMPANY_FACT",
        },
      ],
      section_key: "experience",
    });

    await expect(
      gateway.generateDraftSection(
        draftPlan("experience"),
        [],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
      safeReason: "invalid_draft_claim",
    });
  });
});

function draftGatewayWithResponse(payload: unknown): GeminiGateway {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(payload) }] } },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
  return new GeminiGateway(
    "safe-test-key-value",
    "gemini-2.5-flash",
    "gemini-embedding-001",
  );
}

function draftPlan(sectionKey: string): {
  readonly formattingGuidance: string;
  readonly heading: string;
  readonly instructions: null;
  readonly sectionKey: string;
} {
  return {
    formattingGuidance: "Use concise prose.",
    heading: "Draft",
    instructions: null,
    sectionKey,
  };
}

function requestBodyFrom(fetchMock: ReturnType<typeof vi.fn>): {
  readonly contents: readonly {
    readonly parts: readonly { readonly text: string }[];
  }[];
  readonly generationConfig: {
    readonly responseSchema: unknown;
    readonly thinkingConfig?: unknown;
  };
} {
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as {
    readonly contents: readonly {
      readonly parts: readonly { readonly text: string }[];
    }[];
    readonly generationConfig: {
      readonly responseSchema: unknown;
      readonly thinkingConfig?: unknown;
    };
  };
}
