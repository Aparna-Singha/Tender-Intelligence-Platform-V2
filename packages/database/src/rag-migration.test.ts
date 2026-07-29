import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../prisma/migrations/20260729001000_tenant_rag_chatbot/migration.sql",
  ),
  "utf8",
);

describe("tenant RAG migration", () => {
  it("requires pgvector and pre-ranking tenant scope indexes", () => {
    expect(migration).toContain('"embedding" vector(768)');
    expect(migration).toContain("rag_chunks_tenant_scope_idx");
    expect(migration).toContain("rag_chunks_fts_idx");
    expect(migration).toContain("rag_chunks_embedding_idx");
  });

  it("stores immutable provenance, retrieval hits, and verified citations", () => {
    for (const table of [
      "rag_index_runs",
      "rag_chunks",
      "rag_conversations",
      "rag_messages",
      "rag_answer_runs",
      "rag_retrieval_runs",
      "rag_retrieval_hits",
      "rag_answer_citations",
      "rag_feedback",
    ])
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    expect(migration).toContain('"source_fingerprint" CHAR(64)');
    expect(migration).toContain("rag_index_runs_one_active_idx");
  });

  it("uses tenant foreign keys and bounded database constraints", () => {
    expect(
      migration.match(/"organisation_id" UUID NOT NULL/g)?.length,
    ).toBeGreaterThan(5);
    expect(migration).toContain('CHECK ("token_count" BETWEEN 1 AND 1200)');
    expect(migration).toContain(
      'CHECK (length("content") BETWEEN 1 AND 12000)',
    );
    expect(migration).toContain("rag_index_runs_tender_scope_fk");
    expect(migration).toContain("rag_chunks_index_scope_fk");
    expect(migration).toContain("rag_messages_conversation_scope_fk");
    expect(migration).toContain("rag_retrieval_answer_scope_fk");
  });
});
