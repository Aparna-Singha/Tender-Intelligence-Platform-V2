import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";

const apiKey = process.env.GEMINI_API_KEY?.trim();
const host = "generativelanguage.googleapis.com";
const baseUrl = `https://${host}/v1beta`;
const candidates = [
  "gemini-2.5-flash",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
];
const configuredDraftModel = process.env.DRAFT_MODEL ?? "gemini-2.5-flash";
const generationCandidates =
  process.env.GEMINI_PREFLIGHT_ALL_MODELS === "true"
    ? candidates
    : [configuredDraftModel];

if (!apiKey) {
  console.log(JSON.stringify({ key: { loaded: false } }, null, 2));
  process.exitCode = 1;
} else {
  const result = {
    checkedAt: new Date().toISOString(),
    endpoint: baseUrl,
    key: {
      fingerprint: createHash("sha256")
        .update(apiKey)
        .digest("hex")
        .slice(0, 12),
      length: apiKey.length,
      loaded: true,
    },
    configured: {
      draftModel: configuredDraftModel,
      draftProvider: process.env.DRAFT_PROVIDER ?? null,
      embeddingModel:
        process.env.GEMINI_EMBEDDING_MODEL ??
        process.env.RAG_EMBEDDING_MODEL ??
        null,
      ragChatModel:
        process.env.GEMINI_CHAT_MODEL ?? process.env.RAG_CHAT_MODEL ?? null,
      ragProvider: process.env.RAG_PROVIDER ?? null,
    },
    dns: null,
    catalog: null,
    generation: [],
    structuredOutput: null,
    embedding: null,
  };

  try {
    result.dns = {
      addresses: await lookup(host, { all: true }),
      ok: true,
    };
  } catch (error) {
    result.dns = safeNetworkError(error);
  }

  const catalogResponse = await request("/models?pageSize=1000", {
    method: "GET",
  });
  const catalogModels = Array.isArray(catalogResponse.body?.models)
    ? catalogResponse.body.models
    : [];
  const availableNames = new Set(
    catalogModels
      .map((model) => model?.name)
      .filter((name) => typeof name === "string"),
  );
  result.catalog = {
    ...catalogResponse.meta,
    candidates: candidates.map((model) => ({
      available: availableNames.has(`models/${model}`),
      model,
      supportedGenerationMethods:
        catalogModels.find(({ name }) => name === `models/${model}`)
          ?.supportedGenerationMethods ?? [],
    })),
    modelCount: catalogModels.length,
  };

  for (const model of generationCandidates) {
    const listed = availableNames.has(`models/${model}`);
    if (!listed) {
      result.generation.push({
        available: false,
        model,
        skipped: "not_listed",
      });
      continue;
    }
    const response = await request(`/models/${model}:generateContent`, {
      body: {
        contents: [
          { parts: [{ text: "Reply with exactly: GEMINI_OK" }], role: "user" },
        ],
        generationConfig: {
          maxOutputTokens: 128,
          ...(model === "gemini-2.5-flash"
            ? { thinkingConfig: { thinkingBudget: 0 } }
            : {}),
          temperature: 0,
        },
      },
      method: "POST",
    });
    const text = response.body?.candidates?.[0]?.content?.parts?.[0]?.text;
    result.generation.push({
      ...response.meta,
      available: true,
      finishReason: response.body?.candidates?.[0]?.finishReason ?? null,
      model,
      output: typeof text === "string" ? text.trim() : null,
      passed: response.meta.ok && text?.trim() === "GEMINI_OK",
    });
  }

  const selected =
    result.generation.find(
      ({ model, passed }) => model === configuredDraftModel && passed,
    ) ?? result.generation.find(({ passed }) => passed);
  if (selected) {
    const response = await request(
      `/models/${selected.model}:generateContent`,
      {
        body: {
          contents: [
            {
              parts: [
                {
                  text: 'Return status "ok" and an empty claims array.',
                },
              ],
              role: "user",
            },
          ],
          generationConfig: {
            maxOutputTokens: 128,
            responseMimeType: "application/json",
            responseSchema: {
              properties: {
                claims: { items: { type: "STRING" }, type: "ARRAY" },
                status: { enum: ["ok"], type: "STRING" },
              },
              required: ["status", "claims"],
              type: "OBJECT",
            },
            temperature: 0,
          },
        },
        method: "POST",
      },
    );
    const text = response.body?.candidates?.[0]?.content?.parts?.[0]?.text;
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    result.structuredOutput = {
      ...response.meta,
      model: selected.model,
      parsed,
      passed:
        response.meta.ok &&
        parsed?.status === "ok" &&
        Array.isArray(parsed?.claims) &&
        parsed.claims.length === 0,
    };
  }

  const embeddingModel = result.configured.embeddingModel;
  if (embeddingModel) {
    const response = await request(`/models/${embeddingModel}:embedContent`, {
      body: {
        content: { parts: [{ text: "Tender provider preflight" }] },
        outputDimensionality: 768,
        taskType: "RETRIEVAL_QUERY",
      },
      method: "POST",
    });
    const values = response.body?.embedding?.values;
    result.embedding = {
      ...response.meta,
      dimensions: Array.isArray(values) ? values.length : null,
      finite:
        Array.isArray(values) &&
        values.every((value) => Number.isFinite(value)),
      model: embeddingModel,
      passed:
        response.meta.ok &&
        Array.isArray(values) &&
        values.length === 768 &&
        values.every((value) => Number.isFinite(value)),
    };
  }

  console.log(JSON.stringify(result, null, 2));
  if (
    result.dns?.ok !== true ||
    !selected ||
    result.structuredOutput?.passed !== true ||
    result.embedding?.passed !== true
  )
    process.exitCode = 1;
}

async function request(pathname, init) {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await response.text();
    let body = null;
    try {
      body = raw === "" ? null : JSON.parse(raw);
    } catch {}
    return {
      body,
      meta: {
        error: safeGoogleError(body, raw),
        googleRequestId:
          response.headers.get("x-request-id") ??
          response.headers.get("x-goog-request-id"),
        httpStatus: response.status,
        latencyMs: Math.round(performance.now() - started),
        ok: response.ok,
        retryAfter: response.headers.get("retry-after"),
      },
    };
  } catch (error) {
    return {
      body: null,
      meta: {
        error: safeNetworkError(error),
        googleRequestId: null,
        httpStatus: null,
        latencyMs: Math.round(performance.now() - started),
        ok: false,
        retryAfter: null,
      },
    };
  }
}

function safeGoogleError(body, raw) {
  if (body?.error && typeof body.error === "object") {
    return {
      code: body.error.code ?? null,
      message:
        typeof body.error.message === "string"
          ? body.error.message.slice(0, 500)
          : null,
      status: body.error.status ?? null,
    };
  }
  if (raw && body === null)
    return { code: null, message: "non_json_response", status: null };
  return null;
}

function safeNetworkError(error) {
  const cause = error && typeof error === "object" ? error.cause : null;
  return {
    code:
      (cause && typeof cause === "object" && "code" in cause
        ? cause.code
        : null) ?? null,
    message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    name: error instanceof Error ? error.name : "UnknownError",
    ok: false,
  };
}
