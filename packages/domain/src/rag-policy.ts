import { createHash } from "node:crypto";

export const RAG_CHUNK_POLICY_VERSION = "structure-aware-v1";
export const RAG_RETRIEVAL_POLICY_VERSION = "hybrid-rrf-v1";
export const RAG_ANSWER_POLICY_VERSION = "cited-human-controlled-v1";
export const RAG_FUSION_POLICY_VERSION = "reciprocal-rank-fusion-v1";
export const RAG_EMBEDDING_DIMENSIONS = 768;
export const RAG_MAX_QUESTION_CHARACTERS = 2_000;
export const RAG_MAX_CHUNK_CHARACTERS = 4_000;
export const RAG_MAX_CHUNK_TOKENS = 1_000;
export const RAG_CANDIDATE_LIMIT = 40;
export const RAG_CONTEXT_LIMIT = 8;

export const ragSourceModes = [
  "TENDER_ONLY",
  "TENDER_AND_APPROVED_COMPANY_EVIDENCE",
  "TENDER_AND_DERIVED_WORKFLOW_RECORDS",
  "FULL_AUTHORISED_TENDER_CONTEXT",
] as const;
export type RagSourceMode = (typeof ragSourceModes)[number];

export const ragSourceClasses = [
  "TENDER_PRIMARY",
  "TENDER_ANNEXURE",
  "TENDER_CORRIGENDUM",
  "TENDER_BOQ",
  "TENDER_CLARIFICATION",
  "STRUCTURED_REQUIREMENT",
  "STRUCTURED_FIELD",
  "COMPANY_EVIDENCE",
  "COMPANY_PROFILE",
  "ELIGIBILITY_ASSESSMENT",
  "CHECKLIST_ITEM",
  "RISK_FINDING",
  "TENDER_METADATA",
  "SYSTEM_POLICY",
] as const;
export type RagSourceClass = (typeof ragSourceClasses)[number];

const tenderClasses: readonly RagSourceClass[] = [
  "TENDER_PRIMARY",
  "TENDER_ANNEXURE",
  "TENDER_CORRIGENDUM",
  "TENDER_BOQ",
  "TENDER_CLARIFICATION",
  "STRUCTURED_REQUIREMENT",
  "STRUCTURED_FIELD",
  "TENDER_METADATA",
  "SYSTEM_POLICY",
];
const companyClasses: readonly RagSourceClass[] = [
  "COMPANY_EVIDENCE",
  "COMPANY_PROFILE",
];
const derivedClasses: readonly RagSourceClass[] = [
  "ELIGIBILITY_ASSESSMENT",
  "CHECKLIST_ITEM",
  "RISK_FINDING",
];

export function sourceClassesForMode(
  mode: RagSourceMode,
): readonly RagSourceClass[] {
  switch (mode) {
    case "TENDER_ONLY":
      return tenderClasses;
    case "TENDER_AND_APPROVED_COMPANY_EVIDENCE":
      return [...tenderClasses, ...companyClasses];
    case "TENDER_AND_DERIVED_WORKFLOW_RECORDS":
      return [...tenderClasses, ...derivedClasses];
    case "FULL_AUTHORISED_TENDER_CONTEXT":
      return [...tenderClasses, ...companyClasses, ...derivedClasses];
  }
}

export interface ChunkSource {
  readonly sourceClass: RagSourceClass;
  readonly sourceRecordId: string;
  readonly documentName: string;
  readonly pageNumber: number | null;
  readonly clauseLabel: string | null;
  readonly text: string;
}

export interface StructureAwareChunk extends ChunkSource {
  readonly checksum: string;
  readonly sequence: number;
  readonly tokenCount: number;
}

export function createStructureAwareChunks(
  sources: readonly ChunkSource[],
): readonly StructureAwareChunk[] {
  return sources.flatMap((source) => {
    const normalized = source.text.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) return [];
    const parts: string[] = [];
    for (let offset = 0; offset < normalized.length;) {
      const upper = Math.min(
        offset + RAG_MAX_CHUNK_CHARACTERS,
        normalized.length,
      );
      const boundary =
        upper === normalized.length
          ? upper
          : Math.max(
              offset + Math.floor(RAG_MAX_CHUNK_CHARACTERS * 0.7),
              normalized.lastIndexOf(". ", upper) + 1,
            );
      parts.push(normalized.slice(offset, boundary).trim());
      offset = boundary;
    }
    return parts.map((text, sequence) => ({
      ...source,
      checksum: createHash("sha256").update(text).digest("hex"),
      sequence,
      text,
      tokenCount: Math.min(
        RAG_MAX_CHUNK_TOKENS,
        Math.max(1, Math.ceil(text.length / 4)),
      ),
    }));
  });
}

export interface RetrievalRank {
  readonly chunkId: string;
  readonly lexicalRank: number | null;
  readonly vectorRank: number | null;
}

export function reciprocalRankFusion(
  ranks: readonly RetrievalRank[],
  limit = RAG_CONTEXT_LIMIT,
): readonly (RetrievalRank & { readonly score: number })[] {
  const k = 60;
  return ranks
    .map((rank) => ({
      ...rank,
      score:
        (rank.lexicalRank === null ? 0 : 1 / (k + rank.lexicalRank)) +
        (rank.vectorRank === null ? 0 : 1 / (k + rank.vectorRank)),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.chunkId.localeCompare(right.chunkId),
    )
    .slice(0, limit);
}

export interface CitationHandle {
  readonly chunkId: string;
  readonly handle: string;
}

export function verifyCitationHandles(
  claimedHandles: readonly string[],
  suppliedHandles: readonly CitationHandle[],
): boolean {
  const allowed = new Set(suppliedHandles.map(({ handle }) => handle));
  return (
    claimedHandles.length > 0 &&
    claimedHandles.every((handle) => allowed.has(handle))
  );
}

export function isPromptInjectionText(text: string): boolean {
  return /\b(ignore|override|reveal|exfiltrate)\b.{0,80}\b(instruction|system|secret|credential|tool)\b/i.test(
    text,
  );
}
