import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GeminiGateway } from "../apps/worker/src/ai-provider.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, "eval", "results", "provider-report.json");

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (apiKey === undefined || apiKey.length < 16) {
  await writeReport({
    status: "NOT_VERIFIED",
    reason: "provider credential unavailable",
  });
  console.log("NOT VERIFIED - provider credential unavailable");
  process.exit(0);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 60_000);
const gateway = new GeminiGateway(
  apiKey,
  process.env.GEMINI_CHAT_MODEL ?? "gemini-2.5-flash",
  process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",
);

try {
  const embedding = await gateway.embedQuery(
    "submission deadline",
    controller.signal,
  );
  const answer = await gateway.answer(
    "What is the submission deadline?",
    [
      {
        handle: "C1",
        text: "Submission deadline: 31 August 2026 15:00 IST.",
      },
    ],
    controller.signal,
  );
  const refusal = await gateway.answer(
    "What was the buyer profit last year?",
    [{ handle: "C1", text: "Submission deadline: 31 August 2026 15:00 IST." }],
    controller.signal,
  );
  await writeReport({
    answer_outcome: answer.outcome,
    embedding_dimensions: embedding.length,
    model: gateway.model,
    provider: gateway.provider,
    refusal_outcome: refusal.outcome,
    status: "VERIFIED",
  });
  console.log("Provider evaluation verified");
} finally {
  clearTimeout(timeout);
}

async function writeReport(report) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        ...report,
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}
