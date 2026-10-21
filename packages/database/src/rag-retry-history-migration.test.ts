import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../prisma/migrations/20261021000100_rag_retry_history/migration.sql",
  ),
  "utf8",
);

describe("RAG retry history migration", () => {
  it("allows several attempts for one question and one child per attempt", () => {
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "rag_answer_runs_question_message_id_key"',
    );
    expect(migration).toContain('ADD COLUMN "retry_of_run_id" UUID');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "rag_answer_runs_retry_of_run_id_key"',
    );
    expect(migration).toContain('FOREIGN KEY ("retry_of_run_id")');
  });
});
